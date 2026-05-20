import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createArtifactStore } from "../src/service/store/artifact-store.mjs";
import { createEventBusScaffold } from "../src/service/core/events/event-bus.mjs";
import { createTaskQueueScaffold } from "../src/service/core/queue/task-queue.mjs";
import { createInMemoryStoreScaffold } from "../src/service/core/store/memory-store.mjs";
import { runDagPlan } from "../src/service/dag/executor.mjs";
import { createNodeDispatcher } from "../src/service/dag/dispatch.mjs";
import { runDagLane } from "../src/service/dag/entrypoint.mjs";
import { planDag, replanDag } from "../src/service/dag/planner.mjs";
import { validateDagPlan } from "../src/service/dag/schema.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function makeRuntime(overrides = {}) {
  return {
    store: createInMemoryStoreScaffold(),
    eventBus: createEventBusScaffold(),
    queue: createTaskQueueScaffold(),
    artifactStore: createArtifactStore({ baseDir: path.join(repoRoot, ".tmp", "verify-dag-execution") }),
    actionToolRegistry: {
      list: () => [],
      call: async () => ({ success: true, observation: "ok", metadata: {} })
    },
    toolContext: {},
    configStore: { load: () => ({}), save: (value) => value, patch: (value) => value },
    ...overrides
  };
}

// ── runDagPlan: topo order, placeholder substitution, per-node status ─────

{
  const plan = {
    summary: "两步：s1 产生数字，s2 用它",
    nodes: [
      { id: "s1", kind: "action_tool", tool: "produce", params: { seed: 10 } },
      { id: "s2", kind: "action_tool", tool: "consume", params: { value: "{{s1.number}}" }, depends_on: ["s1"] }
    ]
  };
  const dispatched = [];
  const dispatch = async (node, params) => {
    dispatched.push({ id: node.id, params });
    if (node.id === "s1") return { number: 42, note: "seed was " + params.seed };
    if (node.id === "s2") return { echo: params.value };
  };
  const events = [];
  const snap = await runDagPlan({ plan, dispatchNode: dispatch, onEvent: (e) => events.push(e) });
  assert.equal(snap.status, "success", JSON.stringify(snap));
  assert.equal(dispatched.length, 2);
  assert.equal(dispatched[0].id, "s1");
  assert.equal(dispatched[1].id, "s2");
  // Placeholder resolved — solo placeholder preserves type (number).
  assert.equal(dispatched[1].params.value, 42);
  assert.equal(snap.results.s2.echo, 42);
  const names = events.map((e) => e.type);
  assert.ok(names.includes("plan_started"));
  assert.ok(names.includes("node_succeeded"));
  assert.ok(names.includes("plan_finished"));
}

// ── Failed node blocks downstream + respects on_failure=skip ─────────────

{
  const plan = {
    nodes: [
      { id: "a", kind: "action_tool", tool: "t", params: {}, on_failure: "skip" },
      { id: "b", kind: "action_tool", tool: "t", params: { x: "{{a.foo}}" }, depends_on: ["a"] },
      { id: "c", kind: "action_tool", tool: "t", params: {} } // independent
    ]
  };
  const dispatch = async (node) => {
    if (node.id === "a") throw new Error("nope");
    if (node.id === "c") return { ok: true };
    return {};
  };
  const snap = await runDagPlan({ plan, dispatchNode: dispatch });
  assert.equal(snap.statuses.a, "skipped");
  assert.equal(snap.statuses.b, "blocked");
  assert.equal(snap.statuses.c, "success");
  // skip means execution continues, so the overall status is success here.
  assert.equal(snap.status, "success");
}

// ── Retry policy via on_failure="retry:2" ────────────────────────────────

{
  let attempts = 0;
  const plan = {
    nodes: [
      { id: "flaky", kind: "action_tool", tool: "t", params: {}, on_failure: "retry:2" }
    ]
  };
  const dispatch = async () => {
    attempts += 1;
    if (attempts < 3) throw new Error("transient");
    return { ok: true };
  };
  const snap = await runDagPlan({ plan, dispatchNode: dispatch });
  assert.equal(snap.status, "success");
  assert.equal(attempts, 3);
}

// ── Replan requested surfaces in the snapshot ────────────────────────────

{
  const plan = {
    nodes: [
      { id: "z", kind: "action_tool", tool: "t", params: {}, on_failure: "replan" }
    ]
  };
  const dispatch = async () => { throw new Error("boom"); };
  const events = [];
  const snap = await runDagPlan({ plan, dispatchNode: dispatch, onEvent: (e) => events.push(e) });
  assert.equal(snap.status, "failed");
  assert.equal(snap.failedNodeId, "z");
  assert.equal(snap.failure.policy, "replan");
  assert.ok(events.some((e) => e.type === "replan_requested"));
}

// ── planDag: malformed LLM output is reported, not thrown ────────────────

{
  const r = await planDag({
    userCommand: "do stuff",
    runtime: { actionToolRegistry: { list: () => [{ id: "t", description: "" }] } },
    contextPacket: null,
    llm: async () => "this is not JSON"
  });
  assert.equal(r.plan, null);
  assert.equal(r.reason, "parse_failed");
}

// Valid LLM output passes validation.
{
  const fakePlan = {
    summary: "ping",
    nodes: [{ id: "s1", kind: "action_tool", tool: "notify", params: { title: "hi", body: "yo" } }]
  };
  const r = await planDag({
    userCommand: "notify me",
    runtime: { actionToolRegistry: { list: () => [{ id: "notify", description: "" }] } },
    contextPacket: null,
    llm: async () => JSON.stringify(fakePlan)
  });
  assert.ok(r.plan, `expected plan, got ${JSON.stringify(r)}`);
  assert.equal(r.plan.nodes.length, 1);
  assert.ok(r.validation?.ok);
}

// Schema-invalid plan (cycle) is rejected with details.
{
  const cyclic = {
    summary: "oops",
    nodes: [
      { id: "a", kind: "action_tool", tool: "t", params: {}, depends_on: ["b"] },
      { id: "b", kind: "action_tool", tool: "t", params: {}, depends_on: ["a"] }
    ]
  };
  const r = await planDag({
    userCommand: "cycle",
    runtime: { actionToolRegistry: { list: () => [] } },
    contextPacket: null,
    llm: async () => JSON.stringify(cyclic)
  });
  assert.equal(r.plan, null);
  assert.equal(r.reason, "invalid");
  assert.ok(r.validation.errors.some((e) => /cycle/i.test(e)));
}

// No provider → null reason.
{
  const r = await planDag({
    userCommand: "x",
    runtime: { actionToolRegistry: { list: () => [] } },
    contextPacket: null,
    llm: async () => null
  });
  assert.equal(r.plan, null);
  assert.equal(r.reason, "no_provider");
}

// ── createNodeDispatcher: action_tool kind routes through registry ───────

{
  const calls = [];
  const runtime = {
    actionToolRegistry: {
      call: async (toolId, args) => {
        calls.push({ toolId, args });
        return { success: true, observation: `ok-${toolId}`, metadata: { tool_id: toolId } };
      }
    },
    toolContext: {}
  };
  const dispatch = createNodeDispatcher({ runtime });
  const out = await dispatch({ kind: "action_tool", tool: "notify", id: "n1" }, { title: "hi" }, {});
  assert.equal(out.tool_id, "notify");
  assert.equal(out.observation, "ok-notify");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, { title: "hi" });
}

// Action-tool returning success=false surfaces as thrown error.
{
  const runtime = {
    actionToolRegistry: {
      call: async () => ({ success: false, observation: "disk full" })
    },
    toolContext: {}
  };
  const dispatch = createNodeDispatcher({ runtime });
  await assert.rejects(
    () => dispatch({ kind: "action_tool", tool: "write", id: "w1" }, {}, {}),
    (err) => /disk full/.test(err.message)
  );
}

// Unknown kind throws clearly.
{
  const dispatch = createNodeDispatcher({ runtime: {} });
  await assert.rejects(
    () => dispatch({ kind: "teleport", id: "t1" }, {}, {}),
    (err) => /unknown node kind/i.test(err.message)
  );
}

// Skill kind is reserved for Phase 6.
{
  const dispatch = createNodeDispatcher({ runtime: {} });
  await assert.rejects(
    () => dispatch({ kind: "skill", skill: "code-review", id: "s1" }, {}, {}),
    (err) => /not yet implemented/i.test(err.message)
  );
}

// ── seededResults: replan can reference upstream nodes from a prior run ──

{
  const plan = {
    nodes: [
      {
        id: "new1",
        kind: "agent_loop",
        params: { userCommand: "use {{old_s.result.text}}" }
      }
    ]
  };
  // Without seeded context the placeholder is unresolved.
  const bad = validateDagPlan(plan);
  assert.equal(bad.ok, false);

  const good = validateDagPlan(plan, { knownExternalIds: ["old_s"] });
  assert.equal(good.ok, true, `seeded external ids should validate: ${JSON.stringify(good.errors)}`);

  const snap = await runDagPlan({
    plan,
    seededResults: { old_s: { result: { text: "hello" } } },
    dispatchNode: async (node, params) => ({ echoed: params.userCommand })
  });
  assert.equal(snap.status, "success");
  assert.equal(snap.results.new1.echoed, "use hello");
}

// ── replanDag: parses and validates the replan LLM output, rejects cycles

{
  const originalPlan = {
    summary: "first",
    nodes: [{ id: "a", kind: "action_tool", tool: "t", params: {} }]
  };
  const replanned = {
    summary: "recover",
    nodes: [
      { id: "r1", kind: "agent_loop", params: { userCommand: "apologise to user" } }
    ]
  };
  const r = await replanDag({
    originalPlan,
    completedResults: {},
    failedNodeId: "a",
    failureMessage: "boom",
    userCommand: "original",
    runtime: { actionToolRegistry: { list: () => [] } },
    llm: async () => JSON.stringify(replanned)
  });
  assert.ok(r.plan, `replan should produce a plan, got ${JSON.stringify(r)}`);
  assert.equal(r.plan.nodes.length, 1);
}

// replanDag accepts a plan whose placeholders point at completed upstream
// nodes, because it validates with knownExternalIds = keys of completedResults.
{
  const replanned = {
    summary: "reuse upstream",
    nodes: [
      {
        id: "r1",
        kind: "agent_loop",
        params: { userCommand: "summarise {{src.text}}" }
      }
    ]
  };
  const r = await replanDag({
    originalPlan: { summary: "first", nodes: [{ id: "src", kind: "action_tool", tool: "t", params: {} }] },
    completedResults: { src: { text: "upstream data" } },
    failedNodeId: "later_node_id",
    failureMessage: "downstream error",
    userCommand: "original",
    runtime: { actionToolRegistry: { list: () => [] } },
    llm: async () => JSON.stringify(replanned)
  });
  assert.ok(r.plan, `replan should accept placeholder pointing at completed node, got: ${JSON.stringify(r)}`);
}

// ── runDagLane: exhausted replan attempts fall back to single-turn lane ──

{
  const entrypoint = readFileSync(new URL("../src/service/dag/entrypoint.mjs", import.meta.url), "utf8");
  const contextSubmission = readFileSync(new URL("../src/service/core/context-submission.mjs", import.meta.url), "utf8");
  assert.match(entrypoint, /fallback_single_turn/u, "DAG lane must emit an explicit fallback event");
  assert.match(contextSubmission, /dagResult\?\.fallbackSingleTurn/u, "context-submission must detect DAG fallback");
  assert.match(contextSubmission, /parentTaskId\s*=\s*dagResult\.parentTask\.task_id/u,
    "single-turn fallback should be linked to the failed DAG parent task");

  const oldFetch = globalThis.fetch;
  const oldEnv = {
    UCA_CONFIG_PATH: process.env.UCA_CONFIG_PATH,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    UCA_FAST_MODEL: process.env.UCA_FAST_MODEL
  };
  const plans = [
    {
      summary: "initial failing plan",
      nodes: [{ id: "fail_a", kind: "action_tool", tool: "always_fail", params: {}, on_failure: "replan" }]
    },
    {
      summary: "replan failing plan 1",
      nodes: [{ id: "fail_b", kind: "action_tool", tool: "always_fail", params: {}, on_failure: "replan" }]
    },
    {
      summary: "replan failing plan 2",
      nodes: [{ id: "fail_c", kind: "action_tool", tool: "always_fail", params: {}, on_failure: "replan" }]
    }
  ];
  let fetchCount = 0;
  try {
    process.env.UCA_CONFIG_PATH = path.join(repoRoot, ".tmp", "verify-dag-execution", "missing-runtime.json");
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_BASE_URL = "https://planner.test/v1";
    process.env.UCA_FAST_MODEL = "gpt-test";
    globalThis.fetch = async () => {
      const plan = plans[Math.min(fetchCount, plans.length - 1)];
      fetchCount += 1;
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(plan) } }]
        })
      };
    };

    const runtime = makeRuntime({
      actionToolRegistry: {
        list: () => [{ id: "always_fail", description: "test failure tool" }],
        call: async () => ({ success: false, observation: "intentional DAG node failure" })
      }
    });
    const result = await runDagLane({
      runtime,
      userCommand: "查多个来源并生成结果",
      contextPacket: { source_type: "test", text: "" },
      executionMode: "interactive"
    });
    assert.equal(result.fallbackSingleTurn, true, `expected fallback result, got ${JSON.stringify(result)}`);
    assert.equal(result.planReason, "max_replan_attempts_exhausted");
    assert.ok(result.parentTask?.task_id, "fallback should return the failed DAG parent task");
    const task = runtime.store.getTask(result.parentTask.task_id);
    assert.equal(task.status, "failed");
    assert.equal(task.failure_category, "model_call_error");
    const eventTypes = runtime.store.getTaskEvents(task.task_id).map((event) => event.event_type);
    assert.ok(eventTypes.includes("dag.fallback_single_turn"), `missing fallback event: ${eventTypes.join(",")}`);
    assert.ok(eventTypes.filter((type) => type === "dag.replan_attempt").length >= 2,
      "DAG lane should try replans before falling back");
  } finally {
    globalThis.fetch = oldFetch;
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

console.log("DAG execution layer (planner + executor + dispatch + replan) verification passed.");
