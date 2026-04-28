/**
 * Verify 83.1 — Prose-trap retry in the tool_using agent loop.
 *
 * Scenario: a user submits an action-shaped command ("帮我打开微信"). The LLM
 * replies with prose ("好的，我来帮你打开微信") but does NOT emit a tool_call.
 * Before this fix, the loop exited with type:"final" on the first prose; the
 * user got a promise that was never kept. After the fix, a synthetic turn is
 * injected pointing out the missing tool_call, and the planner is run again.
 *
 * We validate three scenarios:
 *   1. Action command + LLM returns prose twice  → still final, no infinite loop
 *   2. Action command + LLM returns prose then tool_call → tool actually runs
 *   3. Question command + LLM returns prose → no retry, direct final (retry is
 *      correctly skipped for pure Q&A)
 */

import { readFileSync } from "node:fs";

import { runToolAgentLoop } from "../src/service/executors/tool_using/agent-loop.mjs";

function assert(cond, message) {
  if (!cond) {
    console.error("FAIL:", message);
    process.exit(1);
  }
}

// Minimal runtime stub — the loop only needs a handful of surfaces.
function createStubRuntime({ toolRegistry, emittedEvents }) {
  return {
    actionToolRegistry: toolRegistry,
    toolContext: {},
    connectorCatalog: null,
    store: {
      appendAuditLog: () => {},
      getTask: () => null,
      updateTask: () => {}
    },
    securityBroker: { authorizeToolCall: () => ({ allowed: true, reason: null }) },
    emitTaskEvent: (taskIdOrEvent, eventType, payload) => {
      // The loop calls both runtime.emitTaskEvent(eventType, payload) AND
      // runtime.emitTaskEvent(taskId, eventType, payload) in different
      // places. Accept both shapes.
      if (typeof eventType === "string") {
        emittedEvents.push({ taskId: taskIdOrEvent, eventType, payload });
      } else {
        emittedEvents.push({ eventType: taskIdOrEvent, payload: eventType });
      }
    }
  };
}

function makeTask(userCommand, taskSpec = {}) {
  return {
    task_id: `t_${Math.random().toString(36).slice(2, 9)}`,
    user_command: userCommand,
    context_packet: { text: "" },
    route: { executor: "tool_using" },
    task_spec: taskSpec,
    __runtime: null
  };
}

const TOOL_REQUIRED_SPEC = {
  goal: "launch_and_act",
  success_contract: {
    tool_called: true,
    required_tool_names: ["launch_app"]
  }
};

// Fake tool registry matching the real surface: list() / get(id) / call(id, args, ctx).
function makeToolRegistry() {
  const calls = [];
  const launchTool = {
    id: "launch_app",
    description: "Open an app by name",
    parameters: { type: "object", properties: { name: { type: "string" } } }
  };
  return {
    list: () => [launchTool],
    get: (id) => (id === "launch_app" ? launchTool : null),
    call: async (id, args) => {
      if (id !== "launch_app") return { success: false, observation: "unknown tool" };
      calls.push(args);
      return { success: true, observation: `launched ${args.name}` };
    },
    evaluate: () => ({ risk_level: "low", requires_confirmation: false }),
    calls
  };
}

// Planner stub: returns a scripted sequence of decisions. We drive the test
// by specifying exactly what each planner call should produce.
function makeScriptedPlanner(script) {
  let idx = 0;
  const calls = [];
  return {
    planner: async ({ task, transcript, iteration }) => {
      calls.push({ taskId: task.task_id, iteration, transcriptLen: transcript.length });
      const next = script[idx] ?? script[script.length - 1];
      idx += 1;
      return typeof next === "function" ? next({ transcript, iteration }) : next;
    },
    calls
  };
}

/* ── Scenario 1: prose + prose → one retry, then genuine final ── */
async function scenario1() {
  const registry = makeToolRegistry();
  const events = [];
  const runtime = createStubRuntime({ toolRegistry: registry, emittedEvents: events });
  const { planner, calls } = makeScriptedPlanner([
    { type: "final", text: "好的，我来帮你打开微信。" },
    { type: "final", text: "抱歉，我无法直接打开应用。" }
  ]);
  // NOT "打开微信" — that matches the tier0 fast-path and bypasses the planner
  // entirely. We want an action-shaped command that takes the LLM route.
  const task = makeTask("帮我给 bob@example.com 发一封关于下周进度的邮件", TOOL_REQUIRED_SPEC);
  task.__runtime = runtime;

  const result = await runToolAgentLoop({
    task,
    runtime,
    planner,
    maxIterations: 5
  });

  assert(result.status === "success", "s1: expected status=success");
  // Planner should be called TWICE (initial + retry), not 5 times (no infinite loop).
  assert(calls.length === 2, `s1: planner called ${calls.length} times, expected 2`);
  // A prose_trap_retry transcript entry should have been injected.
  const retryEntries = result.transcript.filter((e) => e.type === "prose_trap_retry");
  assert(retryEntries.length === 1, `s1: expected 1 prose_trap_retry entry, got ${retryEntries.length}`);
  // Emitted event for observability.
  const retryEvents = events.filter((e) => e.eventType === "prose_trap_retry");
  assert(retryEvents.length === 1, "s1: expected 1 prose_trap_retry event");
  // No tool ran.
  assert(registry.calls.length === 0, "s1: no tool should have run");
  // Final text should be the second (real) reply, not the first.
  assert(
    result.final_text.includes("无法") || result.final_text.includes("抱歉"),
    `s1: final_text should be the second reply, got ${JSON.stringify(result.final_text)}`
  );
  console.log("  ✓ scenario 1: prose+prose → retry once then accept final");
}

/* ── Scenario 2: prose, then LLM finally emits a tool_call ── */
async function scenario2() {
  const registry = makeToolRegistry();
  const events = [];
  const runtime = createStubRuntime({ toolRegistry: registry, emittedEvents: events });
  const { planner, calls } = makeScriptedPlanner([
    { type: "final", text: "好的，正在帮你打开微信。" },
    { type: "tool_call", tool: "launch_app", args: { name: "微信" } },
    { type: "final", text: "已打开。" }
  ]);
  // NOT "打开微信" — that matches the tier0 fast-path and bypasses the planner
  // entirely. We want an action-shaped command that takes the LLM route.
  const task = makeTask("帮我给 bob@example.com 发一封关于下周进度的邮件", TOOL_REQUIRED_SPEC);
  task.__runtime = runtime;

  const result = await runToolAgentLoop({
    task,
    runtime,
    planner,
    maxIterations: 5
  });

  assert(result.status === "success", "s2: expected status=success");
  assert(calls.length === 3, `s2: planner called ${calls.length} times, expected 3`);
  // Tool must have executed.
  assert(registry.calls.length === 1, `s2: expected 1 tool call, got ${registry.calls.length}`);
  // The loop may apply repairToolArgs, so we don't assert the exact args shape —
  // the important thing for this test is that the tool actually ran rather
  // than the loop bailing out on prose. See scenario 1 for the no-tool-ran
  // counterpart assertion.
  console.log("  ✓ scenario 2: prose then tool_call → tool actually runs");
}

/* ── Scenario 3: pure question → no retry even on prose ── */
async function scenario3() {
  const registry = makeToolRegistry();
  const events = [];
  const runtime = createStubRuntime({ toolRegistry: registry, emittedEvents: events });
  const { planner, calls } = makeScriptedPlanner([
    { type: "final", text: "微信是腾讯开发的一款即时通讯软件。" }
  ]);
  const task = makeTask("什么是微信？");
  task.__runtime = runtime;

  const result = await runToolAgentLoop({
    task,
    runtime,
    planner,
    maxIterations: 5
  });

  assert(result.status === "success", "s3: expected status=success");
  // Planner should be called ONCE — question shouldn't trigger retry.
  assert(calls.length === 1, `s3: planner called ${calls.length} times, expected 1 (no retry on questions)`);
  const retryEntries = result.transcript.filter((e) => e.type === "prose_trap_retry");
  assert(retryEntries.length === 0, "s3: question should not trigger prose_trap_retry");
  console.log("  ✓ scenario 3: question command → no retry, direct final");
}

/* ── Scenario 4: scaffold preserves phase-gate partial_success ── */
function scenario4() {
  const agentLoopSrc = readFileSync(
    new URL("../src/service/executors/tool_using/agent-loop.mjs", import.meta.url),
    "utf8"
  );
  assert(
    /result\.status\s*===\s*["']partial_success["']/.test(agentLoopSrc),
    "s4: createToolUsingExecutorScaffold must branch on result.status === partial_success"
  );
  assert(
    /event_type:\s*["']partial_success["'][\s\S]{0,300}phase_gate/.test(agentLoopSrc),
    "s4: scaffold partial_success event must carry phase_gate metadata"
  );
  // Both gate metadata keys must travel together so the SSE consumer
  // sees the full envelope regardless of which gate fired.
  assert(
    /event_type:\s*["']partial_success["'][\s\S]{0,300}error_budget/.test(agentLoopSrc),
    "s4: scaffold partial_success event must carry error_budget metadata"
  );

  const eventBusSrc = readFileSync(
    new URL("../src/service/core/events/event-bus.mjs", import.meta.url),
    "utf8"
  );
  assert(
    eventBusSrc.includes('"phase_gate_signal"'),
    "s4: phase_gate_signal must be part of the public EVENT_TYPES contract"
  );
  assert(
    eventBusSrc.includes('"error_budget_signal"'),
    "s4: error_budget_signal must be part of the public EVENT_TYPES contract"
  );
  console.log("  ✓ scenario 4: scaffold preserves phase-gate + error-budget partial_success envelope");
}

/* ── Scenario 5: error-budget exhaustion on repeated tool_failure ── */
async function scenario5() {
  const events = [];
  // A registry where every call to launch_app returns success=false.
  // Drives the tool_failure counter (max=2) to exhaustion in 2 turns.
  const failingRegistry = {
    list: () => [{
      id: "launch_app",
      description: "Open an app by name",
      parameters: { type: "object", properties: { name: { type: "string" } } }
    }],
    get: (id) => (id === "launch_app"
      ? { id: "launch_app", parameters: { type: "object", properties: { name: { type: "string" } } } }
      : null),
    call: async () => ({ success: false, observation: "permission denied", error: "EACCES" }),
    evaluate: () => ({ risk_level: "low", requires_confirmation: false }),
    calls: []
  };
  const runtime = createStubRuntime({ toolRegistry: failingRegistry, emittedEvents: events });
  // Always-tool_call planner — args differ each turn to avoid the
  // seenCalls dedupe (which would short-circuit to success).
  const { planner, calls } = makeScriptedPlanner([
    { type: "tool_call", tool: "launch_app", args: { name: "微信" } },
    { type: "tool_call", tool: "launch_app", args: { name: "QQ" } },
    { type: "tool_call", tool: "launch_app", args: { name: "钉钉" } }
  ]);
  const task = makeTask("帮我给 bob@example.com 发一封关于下周进度的邮件");
  task.__runtime = runtime;

  const result = await runToolAgentLoop({
    task,
    runtime,
    planner,
    maxIterations: 8
  });

  assert(result.status === "partial_success", `s5: expected status=partial_success, got ${result.status}`);
  assert(result.error_budget != null, "s5: error_budget metadata must be present");
  assert(result.error_budget.event === "tool_failure", `s5: expected event=tool_failure, got ${result.error_budget.event}`);
  assert(result.error_budget.snapshot.consumed_tool_failures === 2, "s5: tool_failure consumed should be 2");
  // Loop should bail on iteration 1 (charge 1 absorbed; charge 2 exhausts), not run all 8.
  assert(calls.length === 2, `s5: planner expected 2 calls (1 absorbed + 1 exhaust), got ${calls.length}`);
  // SSE event for observability.
  const budgetEvents = events.filter((e) => e.eventType === "error_budget_signal");
  assert(budgetEvents.length === 1, `s5: expected 1 error_budget_signal, got ${budgetEvents.length}`);
  console.log("  ✓ scenario 5: repeated tool_failure → error budget exhausts at 2/2 with metadata");
}

async function main() {
  console.log("verify-prose-trap:");
  await scenario1();
  await scenario2();
  await scenario3();
  scenario4();
  await scenario5();
  console.log("Prose-trap retry verification passed.");
}

main().catch((err) => {
  console.error("verify-prose-trap crashed:", err);
  process.exit(1);
});
