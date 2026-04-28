import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateDagPlan, iterPlaceholderRefs, NODE_KINDS } from "../src/service/dag/schema.mjs";
import { resolveParams, PlaceholderUnresolvedError } from "../src/service/dag/placeholder.mjs";
import { triage, scoreComplexity } from "../src/service/core/intent/triage.mjs";
import { createInMemoryStoreScaffold } from "../src/service/core/store/memory-store.mjs";
import { createEventBusScaffold } from "../src/service/core/events/event-bus.mjs";
import { createTaskQueueScaffold } from "../src/service/core/queue/task-queue.mjs";
import { createArtifactStore } from "../src/service/store/artifact-store.mjs";
import { createSchedulerRuntime } from "../src/service/scheduler/engine.mjs";
import { createSecurityBroker } from "../src/service/security/broker.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// ── schema.mjs ─────────────────────────────────────────────────────────────

// NODE_KINDS covers the five kinds the design doc describes.
assert.deepEqual(new Set(NODE_KINDS), new Set(["mcp_tool", "action_tool", "workflow", "skill", "agent_loop"]));

// Valid minimal plan.
{
  const plan = {
    nodes: [
      { id: "s1", kind: "action_tool", tool: "notify", params: { title: "hi", body: "there" } }
    ]
  };
  const r = validateDagPlan(plan);
  assert.equal(r.ok, true, `valid plan rejected: ${JSON.stringify(r.errors)}`);
  assert.deepEqual(r.edges, []);
}

// Dependency + placeholder happy path.
{
  const plan = {
    nodes: [
      { id: "s1", kind: "mcp_tool", tool: "weather.current", params: { city: "上海" } },
      { id: "s2", kind: "mcp_tool", tool: "weather.current", params: { city: "北京" } },
      { id: "s3", kind: "agent_loop", params: { userCommand: "对比 {{s1}} 和 {{s2}}" }, depends_on: ["s1", "s2"] }
    ]
  };
  const r = validateDagPlan(plan);
  assert.equal(r.ok, true, `complex valid plan rejected: ${JSON.stringify(r.errors)}`);
  assert.equal(r.edges.length, 2);
}

// Cycle detection.
{
  const plan = {
    nodes: [
      { id: "a", kind: "action_tool", tool: "notify", params: {}, depends_on: ["b"] },
      { id: "b", kind: "action_tool", tool: "notify", params: {}, depends_on: ["a"] }
    ]
  };
  const r = validateDagPlan(plan);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /cycle/i.test(e)), `expected cycle error, got: ${JSON.stringify(r.errors)}`);
}

// Missing required field per kind.
{
  const r = validateDagPlan({
    nodes: [{ id: "x", kind: "workflow", params: {} }]
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /workflowId/.test(e)));
}

// Unknown kind.
{
  const r = validateDagPlan({
    nodes: [{ id: "x", kind: "espresso", params: {} }]
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /unknown kind/i.test(e)));
}

// Dangling depends_on.
{
  const r = validateDagPlan({
    nodes: [{ id: "x", kind: "action_tool", tool: "notify", params: {}, depends_on: ["ghost"] }]
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /depends_on.*ghost/.test(e)));
}

// Placeholder referencing unknown node.
{
  const r = validateDagPlan({
    nodes: [{ id: "x", kind: "agent_loop", params: { userCommand: "use {{ghost.value}}" } }]
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /placeholder.*ghost/.test(e)));
}

// serial_per_session requires session_key.
{
  const r = validateDagPlan({
    nodes: [{ id: "x", kind: "skill", skill: "code-review", params: {}, concurrency: "serial_per_session" }]
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /session_key/.test(e)));
}

// iterPlaceholderRefs picks up every reference.
{
  const refs = [...iterPlaceholderRefs({
    a: "{{s1.items[0].name}}",
    b: ["{{s2}}", { c: "prefix {{s3.x}} suffix" }]
  })];
  assert.equal(refs.length, 3);
  assert.equal(refs[0].nodeId, "s1");
  assert.equal(refs[1].nodeId, "s2");
  assert.equal(refs[2].nodeId, "s3");
}

// ── placeholder.mjs ────────────────────────────────────────────────────────

// Solo placeholder preserves non-string types.
{
  const results = { weather: { temp: 17, condition: "sunny" } };
  const resolved = resolveParams({ current: "{{weather}}" }, results);
  assert.deepEqual(resolved.current, { temp: 17, condition: "sunny" });
}

// Dotted path and string interpolation.
{
  const results = { weather: { temp: 17, city: "Raleigh" } };
  const resolved = resolveParams(
    { line: "{{weather.city}} is {{weather.temp}}°C now" },
    results
  );
  assert.equal(resolved.line, "Raleigh is 17°C now");
}

// Array index path.
{
  const results = { files: { items: [{ name: "a.txt" }, { name: "b.txt" }] } };
  const resolved = resolveParams({ pick: "{{files.items[1].name}}" }, results);
  assert.equal(resolved.pick, "b.txt");
}

// Non-string types pass through.
{
  const resolved = resolveParams({ n: 42, flag: true, list: [1, 2, 3] }, {});
  assert.deepEqual(resolved, { n: 42, flag: true, list: [1, 2, 3] });
}

// Unresolved reference → typed error with nodeId.
{
  assert.throws(
    () => resolveParams({ x: "{{missing.foo}}" }, { other: {} }),
    (err) => err instanceof PlaceholderUnresolvedError && err.nodeId === "missing"
  );
}

// Descending into null/undefined yields a clear error.
{
  assert.throws(
    () => resolveParams({ x: "{{s.key}}" }, { s: null }),
    (err) => err instanceof PlaceholderUnresolvedError
  );
}

// ── triage.mjs ─────────────────────────────────────────────────────────────

function makeRuntime() {
  const runtime = {
    store: createInMemoryStoreScaffold(),
    eventBus: createEventBusScaffold(),
    queue: createTaskQueueScaffold(),
    artifactStore: createArtifactStore({ baseDir: path.join(repoRoot, ".tmp", "verify-dag-foundation") }),
    actionToolRegistry: { list: () => [], get: () => null, call: async () => ({ success: false }) },
    toolContext: {},
    configStore: { load: () => ({}), save: () => ({}), patch: (p) => p }
  };
  runtime.securityBroker = createSecurityBroker({ runtime, config: {} });
  runtime.scheduler = createSchedulerRuntime({ runtime });
  return runtime;
}

// scoreComplexity is pure and deterministic.
assert.equal(scoreComplexity(""), 0);
assert.ok(scoreComplexity("打开 outlook") < 0.3, `simple command should score low`);
assert.ok(scoreComplexity("打开桌面所有图片") >= 0.2, `quantifier contributes`);
assert.ok(scoreComplexity("查上海、北京、成都三地天气，然后生成 ppt") >= 0.5, `multi-clause + connective`);

// Fast-path bypass is retired: even deterministic URL/app requests enter the
// single-turn AI agent so the model sees the same tool contract as every other task.
{
  const runtime = makeRuntime();
  const r = await triage({
    runtime,
    userCommand: "打开 https://example.com",
    fastPath: () => ({ tier: 0, tool: "open_url", args: { url: "https://example.com" } }),
    handleAsPlan: async () => null
  });
  assert.equal(r.lane, "single_turn");
  assert.equal(r.userCommand, "打开 https://example.com");
}

// Schedule lane is driven by SemanticRouter interpretation.
{
  const runtime = makeRuntime();
  const r = await triage({
    runtime,
    userCommand: "5 分钟后发美股汇总",
    preflight: async ({ contextPacket }) => ({
      ...(contextPacket ?? {}),
      semantic_router_decision: {
        interpretation: "schedule",
        schedule_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        residual_command: "发美股汇总"
      }
    })
  });
  assert.equal(r.lane, "schedule");
  assert.equal(r.task.sub_status, "scheduled");
  assert.equal(r.schedule.action_params.userCommand, "发美股汇总");
}

// Clarify lane is driven by SemanticRouter interpretation.
{
  const runtime = makeRuntime();
  const r = await triage({
    runtime,
    userCommand: "5 分钟后帮我做点事",
    preflight: async ({ contextPacket }) => ({
      ...(contextPacket ?? {}),
      semantic_router_decision: {
        interpretation: "needs_clarification",
        clarification_question: "请问你想做什么？"
      }
    })
  });
  assert.equal(r.lane, "clarify");
  assert.ok(r.message?.includes("做什么"));
}

// Immediate SR decisions are carried forward to the single_turn packet.
{
  const runtime = makeRuntime();
  const r = await triage({
    runtime,
    userCommand: "原命令",
    preflight: async ({ contextPacket }) => ({
      ...(contextPacket ?? {}),
      semantic_router_decision: {
        interpretation: "immediate",
        expected_output: "direct_answer"
      }
    })
  });
  assert.equal(r.lane, "single_turn");
  assert.equal(r.userCommand, "原命令");
  assert.equal(r.contextPacket.semantic_router_decision.expected_output, "direct_answer");
}

// Complexity over threshold still lands on single_turn while DAG gate is off.
{
  const runtime = makeRuntime(); // no featureFlags.dagPlanner
  const r = await triage({
    runtime,
    userCommand: "查上海、北京、成都三地天气，然后生成 ppt，接着发给 a@b.com",
    fastPath: () => null,
    handleAsPlan: async () => null
  });
  assert.equal(r.lane, "single_turn", "DAG gate off: high-complexity still routes to agent-loop");
  assert.equal(r.intendedLane, "dag_planner", "but the triage result flags that it would have escalated");
}

// With DAG gate flipped on, the same command escalates.
{
  const runtime = makeRuntime();
  runtime.featureFlags = { dagPlanner: true };
  const r = await triage({
    runtime,
    userCommand: "查上海、北京、成都三地天气，然后生成 ppt，接着发给 a@b.com",
    fastPath: () => null,
    handleAsPlan: async () => null
  });
  assert.equal(r.lane, "dag_planner");
}

// Low-complexity default: single_turn.
{
  const runtime = makeRuntime();
  const r = await triage({
    runtime,
    userCommand: "打开 outlook",
    fastPath: () => null,
    handleAsPlan: async () => null
  });
  assert.equal(r.lane, "single_turn");
}

console.log("DAG foundation (schema + placeholder + triage) verification passed.");
