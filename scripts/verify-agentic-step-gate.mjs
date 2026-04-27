#!/usr/bin/env node
/**
 * UCA-077 P4-RQ §19 J1: agentic per-iteration parity with tool_using.
 *
 * Pre-J1 the agentic planner ran for the full maxIterations even when
 * the same tool failed repeatedly OR when the success contract was
 * unreachable from the current state. tool_using charges an error
 * budget after each tool result (tool_failure, empty_search_result)
 * and runs validateStepGate to catch same-tool failure streaks /
 * iteration-ceiling abort. agentic now does the same.
 *
 * J1 surface:
 *   - planner result gains `phase_gate` (populated when the gate
 *     aborts/escalates) and `error_budget` (populated when the budget
 *     exhausts).
 *   - planner result.downgraded === true on either early exit.
 *   - planner.finalText is prepended with a `[UCA] 阶段提前结束: …`
 *     diagnostic line so the user sees what happened.
 *   - onEvent receives a `phase_gate_signal` event after every tool
 *     call (parity with tool_using's emitTaskEvent).
 *
 * Run: node scripts/verify-agentic-step-gate.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runAgenticPlanner } from "../src/service/executors/agentic/planner.mjs";
import { createActionToolRegistry } from "../src/service/action_tools/registry.mjs";
import { BUILTIN_ACTION_TOOLS } from "../src/service/action_tools/tools/index.mjs";

let pass = 0;
let fail = 0;
async function it(label, fn) {
  try {
    await fn();
    process.stdout.write(`PASS  ${label}\n`);
    pass += 1;
  } catch (err) {
    process.stdout.write(`FAIL  ${label}\n  ${err.message}\n`);
    fail += 1;
  }
}

function loadFile(rel) {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}

/**
 * Sequence-driven adapter: returns each entry of `responses` in turn.
 * Each entry is `{ text, tool_calls }`. After the sequence is
 * exhausted, returns plain text "(end of sequence)" so the planner
 * exits cleanly.
 */
function makeSequenceAdapter(responses) {
  let i = 0;
  return {
    kind: "openai",
    model: "test",
    transport: "https",
    describe() { return null; },
    async generate() {
      if (i >= responses.length) {
        return { text: "(end of sequence)", tool_calls: [] };
      }
      const r = responses[i];
      i += 1;
      return { text: r.text ?? "", tool_calls: r.tool_calls ?? [] };
    }
  };
}

/** Failing tool registry — every tool returns success: false. */
function makeAllFailingRuntime() {
  const tools = BUILTIN_ACTION_TOOLS.map((tool) => ({
    ...tool,
    async execute(_args) {
      return {
        success: false,
        observation: `Tool ${tool.id} failed deterministically.`,
        metadata: { tool_id: tool.id },
        error: "deterministic_failure",
        artifact_paths: []
      };
    }
  }));
  return { actionToolRegistry: createActionToolRegistry(tools), toolContext: {} };
}

/** Empty-search runtime: web_search_fetch succeeds but returns nothing of substance. */
function makeEmptySearchRuntime() {
  const tools = BUILTIN_ACTION_TOOLS.map((tool) => tool.id === "web_search_fetch"
    ? {
        ...tool,
        async execute(_args) {
          return {
            success: true,
            observation: "(empty)",  // < 32 chars, no substance
            metadata: { tool_id: "web_search_fetch", results: [] },
            artifact_paths: []
          };
        }
      }
    : tool);
  return { actionToolRegistry: createActionToolRegistry(tools), toolContext: {} };
}

// ── 1. Source-level lock-in ────────────────────────────────────────
await it("planner imports validateStepGate + chargeBudget + groupsOfTool", () => {
  const planner = loadFile("../src/service/executors/agentic/planner.mjs");
  assert.match(planner, /import \{[^}]*\bvalidateStepGate\b[^}]*\} from "\.\.\/\.\.\/core\/policy\/success-contract-validator\.mjs"/,
    "planner must import validateStepGate");
  assert.match(planner, /from "\.\.\/\.\.\/core\/runtime\/error-budget\.mjs"/,
    "planner must import from error-budget.mjs");
  assert.match(planner, /\bchargeBudget\b/,
    "planner must use chargeBudget");
  assert.match(planner, /\bcreateErrorBudget\b/,
    "planner must initialise the budget via createErrorBudget");
  assert.match(planner, /\bgroupsOfTool\b/,
    "planner must use groupsOfTool to detect external_web_read calls");
  assert.match(planner, /\bsuggestRunbookForStepGate\b/,
    "planner must call suggestRunbookForStepGate");
});

// ── 2. Tool-failure budget exhaustion ──────────────────────────────
await it("error_budget: 3 same-tool failures → exhausts tool_failure budget → early exit", async () => {
  // Default budget is max_tool_failures=2, so 3 failures forces
  // exhaustion. Adapter requests launch_app each iteration; tool
  // returns failure each time. The validateStepGate would also
  // escalate (same-tool streak), but the budget exhaustion should
  // fire first (it's checked before the gate within the same
  // tool-call block).
  const events = [];
  const result = await runAgenticPlanner({
    task: { task_id: "t1", user_command: "Try a thing" },
    runtime: makeAllFailingRuntime(),
    adapterOverride: makeSequenceAdapter([
      { tool_calls: [{ id: "c1", name: "launch_app", arguments: { app: "x" } }] },
      { tool_calls: [{ id: "c2", name: "launch_app", arguments: { app: "x" } }] },
      { tool_calls: [{ id: "c3", name: "launch_app", arguments: { app: "x" } }] },
      { text: "I tried." }
    ]),
    onEvent: (e) => events.push(e),
    maxIterations: 8
  });
  // Either the budget exhausted or the step gate escalated — both
  // are valid early-exit reasons; we accept either, but assert at
  // least one of the diagnostic objects is populated.
  assert.equal(result.downgraded, true);
  assert.ok(result.error_budget != null || result.phase_gate != null,
    `expected error_budget or phase_gate to be populated; got ${JSON.stringify({eb: result.error_budget, pg: result.phase_gate})}`);
  // The first one to fire (J1 ordering: budget before gate) is
  // typically error_budget. Lock that in by name when present.
  if (result.error_budget) {
    assert.equal(result.error_budget.event, "tool_failure",
      `error_budget event should be tool_failure; got ${result.error_budget.event}`);
    assert.match(result.finalText, /阶段提前结束.*error_budget exhausted/,
      "finalText must surface the error_budget early-exit diagnostic");
  } else if (result.phase_gate) {
    assert.equal(result.phase_gate.next_action, "escalate",
      `phase_gate should escalate on same-tool streak; got ${result.phase_gate.next_action}`);
    assert.match(result.finalText, /阶段提前结束.*phase_gate escalate/);
  }
});

// ── 3. Empty external_web_read budget exhaustion ──────────────────
await it("error_budget: empty external_web_read → exhausts empty_search_result budget on first hit", async () => {
  // Default budget is max_empty_search_results=1, so a single empty
  // result exhausts. The adapter calls web_search_fetch once; the
  // tool returns success=true with no substance.
  const result = await runAgenticPlanner({
    task: { task_id: "t2", user_command: "Find something online" },
    runtime: makeEmptySearchRuntime(),
    adapterOverride: makeSequenceAdapter([
      { tool_calls: [{ id: "c1", name: "web_search_fetch", arguments: { query: "x" } }] },
      { text: "Nothing found." }
    ]),
    maxIterations: 8
  });
  assert.equal(result.downgraded, true);
  assert.ok(result.error_budget,
    `error_budget must be populated; got ${JSON.stringify(result)}`);
  assert.equal(result.error_budget.event, "empty_search_result",
    `error_budget event should be empty_search_result; got ${result.error_budget.event}`);
  assert.match(result.finalText, /empty_search_result/);
});

// ── 4. phase_gate signal emitted on every tool call ───────────────
await it("phase_gate_signal: emitted via onEvent after every tool call", async () => {
  const events = [];
  await runAgenticPlanner({
    task: { task_id: "t3", user_command: "Run a tool" },
    runtime: makeAllFailingRuntime(),
    adapterOverride: makeSequenceAdapter([
      { tool_calls: [{ id: "c1", name: "launch_app", arguments: { app: "x" } }] },
      { text: "Done trying." }
    ]),
    onEvent: (e) => events.push(e),
    maxIterations: 4
  });
  const gateEvents = events.filter((e) => e.event_type === "phase_gate_signal");
  assert.ok(gateEvents.length >= 1,
    `phase_gate_signal must be emitted at least once; got ${gateEvents.length}`);
  const gate = gateEvents[0];
  assert.ok(gate.payload && typeof gate.payload === "object");
  assert.ok(typeof gate.payload.iteration === "number");
  assert.ok(typeof gate.payload.next_action === "string",
    "phase_gate_signal must carry next_action");
});

// ── 5. Success path: no early exit, no diagnostics ────────────────
await it("success path: tool succeeds, contract satisfied → no phase_gate / error_budget on result", async () => {
  // Successful single-tool flow: web_search_fetch returns substantive
  // results, no required policy groups, contract trivially satisfied.
  const tools = BUILTIN_ACTION_TOOLS.map((tool) => tool.id === "web_search_fetch"
    ? {
        ...tool,
        async execute(args) {
          return {
            success: true,
            observation: "Found three relevant articles covering today's AI news across publishers.",
            metadata: {
              tool_id: "web_search_fetch",
              results: [
                { url: "https://nytimes.com/a", title: "A" },
                { url: "https://reuters.com/b", title: "B" }
              ]
            },
            artifact_paths: []
          };
        }
      }
    : tool);
  const runtime = { actionToolRegistry: createActionToolRegistry(tools), toolContext: {} };

  const result = await runAgenticPlanner({
    task: { task_id: "t4", user_command: "Summarise today's AI news" },
    runtime,
    adapterOverride: makeSequenceAdapter([
      { tool_calls: [{ id: "c1", name: "web_search_fetch", arguments: { query: "ai" } }] },
      { text: "Here is the summary across three publishers." }
    ]),
    maxIterations: 4
  });
  assert.equal(result.downgraded, false,
    `should not be downgraded; full result: ${JSON.stringify(result)}`);
  assert.equal(result.phase_gate, null,
    "phase_gate must be null on success");
  assert.equal(result.error_budget, null,
    "error_budget must be null on success");
});

// ── 6. Iteration ceiling abort via step gate ──────────────────────
await it("phase_gate abort: maxIterations reached without satisfying contract → abort", async () => {
  // Force an unsatisfiable contract: required external_web_read but
  // no tool ever runs successfully against it. After maxIterations-1
  // tool failures the gate aborts (the budget would also exhaust on
  // failure #3, but at maxIterations=2 only 1 failure occurs and the
  // gate's iteration-ceiling branch fires instead).
  const result = await runAgenticPlanner({
    task: {
      task_id: "t5",
      user_command: "research news",
      task_spec: {
        success_contract: { required_policy_groups: ["external_web_read"] },
        tool_policy: { policy_groups: { external_web_read: { mode: "required" } } }
      }
    },
    runtime: makeAllFailingRuntime(),
    adapterOverride: makeSequenceAdapter([
      { tool_calls: [{ id: "c1", name: "launch_app", arguments: { app: "x" } }] },
      { tool_calls: [{ id: "c2", name: "launch_app", arguments: { app: "x" } }] }
    ]),
    maxIterations: 2  // forces the iteration-ceiling abort branch
  });
  assert.equal(result.downgraded, true);
  // Either the gate aborted/escalated (preferred — it's the parity
  // outcome) OR the budget exhausted on the second tool_failure.
  // Both are valid; assert at least one fired.
  assert.ok(result.phase_gate || result.error_budget,
    `at least one early-exit diagnostic must fire; got ${JSON.stringify({pg: result.phase_gate, eb: result.error_budget})}`);
});

// ── 7. Legacy compat: no task_spec → only budget can fire ────────
await it("legacy compat: no task_spec, single tool failure → no early-exit (budget not exhausted)", async () => {
  // One tool failure consumes 1/2 of the tool_failure budget; not
  // exhausted. validateStepGate against null task_spec returns
  // satisfied (no required groups), so no abort/escalate. Planner
  // continues to its synthesis turn.
  const result = await runAgenticPlanner({
    task: { task_id: "t6", user_command: "do a thing" },
    runtime: makeAllFailingRuntime(),
    adapterOverride: makeSequenceAdapter([
      { tool_calls: [{ id: "c1", name: "launch_app", arguments: { app: "x" } }] },
      { text: "Tried; it failed but that's okay." }
    ]),
    maxIterations: 4
  });
  // Single failure shouldn't trigger early exit on its own.
  assert.equal(result.error_budget, null,
    `single failure must not exhaust budget; got ${JSON.stringify(result.error_budget)}`);
  assert.equal(result.phase_gate, null,
    "no task_spec means no contract violations to drive abort");
});

// ── 8. J2: preflight web_search_fetch participates in the controls ─
await it("J2: preflight empty external_web_read → fires empty_search_result budget on the preflight site", async () => {
  // needs_current_web_data=true triggers the preflight web_search_fetch.
  // The mock tool returns success=true with no substance — pre-J2 this
  // was invisible to the budget; post-J2 it charges
  // empty_search_result. Default max_empty_search_results=1, so the
  // single preflight call exhausts the budget immediately and the
  // planner skips the main loop.
  const events = [];
  const result = await runAgenticPlanner({
    task: {
      task_id: "j2-1",
      user_command: "research today's AI news",
      task_spec: { needs_current_web_data: true }
    },
    runtime: makeEmptySearchRuntime(),
    adapterOverride: makeSequenceAdapter([
      { text: "Synthesised from preflight." }
    ]),
    onEvent: (e) => events.push(e),
    maxIterations: 6
  });
  assert.equal(result.downgraded, true,
    "preflight empty result must trigger early-exit downgrade");
  assert.ok(result.error_budget,
    `error_budget must be populated; got ${JSON.stringify(result.error_budget)}`);
  assert.equal(result.error_budget.event, "empty_search_result");
  assert.equal(result.error_budget.preflight, true,
    "error_budget must record preflight=true");
  // When the budget exhausts, parity with tool_using is to emit
  // `error_budget_signal` (NOT phase_gate_signal — same as
  // tool_using/agent-loop:1242). Lock that in.
  const preflightBudgetEvent = events.find((e) =>
    e.event_type === "error_budget_signal" && e.payload?.preflight === true);
  assert.ok(preflightBudgetEvent,
    "error_budget_signal with preflight=true must be emitted when preflight budget exhausts");
  assert.equal(preflightBudgetEvent.payload.event, "empty_search_result");
});

await it("J2: preflight that returns substance still emits phase_gate_signal with preflight=true", async () => {
  // Successful preflight (substantive results) → budget not charged,
  // step gate runs, phase_gate_signal carries preflight=true. Then
  // the main loop runs normally and the planner returns success.
  const tools = BUILTIN_ACTION_TOOLS.map((tool) => tool.id === "web_search_fetch"
    ? {
        ...tool,
        async execute() {
          return {
            success: true,
            observation: "Substantial preflight result with multiple sources covering the topic in depth.",
            metadata: {
              tool_id: "web_search_fetch",
              results: [
                { url: "https://nytimes.com/a", title: "A" },
                { url: "https://reuters.com/b", title: "B" }
              ]
            },
            artifact_paths: []
          };
        }
      }
    : tool);
  const runtime = { actionToolRegistry: createActionToolRegistry(tools), toolContext: {} };
  const events = [];
  await runAgenticPlanner({
    task: {
      task_id: "j2-1b",
      user_command: "research current AI news",
      task_spec: { needs_current_web_data: true }
    },
    runtime,
    adapterOverride: makeSequenceAdapter([
      { text: "Synthesised from preflight." }
    ]),
    onEvent: (e) => events.push(e),
    maxIterations: 4
  });
  const preflightGateEvent = events.find((e) =>
    e.event_type === "phase_gate_signal" && e.payload?.preflight === true);
  assert.ok(preflightGateEvent,
    "phase_gate_signal with preflight=true must fire when preflight has substance (no budget charge)");
});

await it("J2: preflight failure counts toward tool_failure budget", async () => {
  // needs_current_web_data=true triggers preflight; the failing
  // runtime makes web_search_fetch return success=false.
  // Pre-J2 this didn't count; post-J2 it charges 1/2 of
  // max_tool_failures. The main loop then runs (budget not yet
  // exhausted at 1/2), and the first main-loop tool_failure pushes it
  // to 2/2 — exhausted, early exit. We assert the snapshot reflects
  // the cumulative count.
  const result = await runAgenticPlanner({
    task: {
      task_id: "j2-2",
      user_command: "search current AI news",
      task_spec: { needs_current_web_data: true }
    },
    runtime: makeAllFailingRuntime(),
    adapterOverride: makeSequenceAdapter([
      // Main loop: one more failed tool call → budget exhausts at 2/2.
      { tool_calls: [{ id: "c1", name: "launch_app", arguments: { app: "x" } }] },
      { text: "Stopped." }
    ]),
    maxIterations: 6
  });
  assert.equal(result.downgraded, true);
  // Either error_budget or phase_gate fired — accept either, but
  // assert the budget snapshot shows ≥ 2 tool_failures consumed
  // (preflight failure + main loop failure both counted).
  if (result.error_budget) {
    assert.equal(result.error_budget.event, "tool_failure",
      `expected tool_failure; got ${result.error_budget.event}`);
    assert.ok(result.error_budget.snapshot.consumed_tool_failures >= 2,
      `snapshot must show ≥ 2 tool_failures (preflight + main); got ${result.error_budget.snapshot.consumed_tool_failures}`);
  } else if (result.phase_gate) {
    // The step gate may escalate before the budget exhausts depending
    // on streak detection; that's also acceptable.
    assert.ok(["abort", "escalate"].includes(result.phase_gate.next_action));
  } else {
    throw new Error(`expected at least one of error_budget / phase_gate to fire; got ${JSON.stringify(result)}`);
  }
});

// ── 9. J2: execution_constraints.error_budget override is honoured ─
await it("J2: execution_constraints.error_budget override widens the budget", async () => {
  // Default max_empty_search_results=1, so 2 empties would normally
  // exhaust. Override to 5 — three empty_search_result events should
  // consume 3/5 (NOT exhaust). The planner is then allowed to keep
  // iterating; we only assert no early-exit-via-budget fires.
  //
  // We also widen max_tool_failures and max_replan_rounds defensively
  // so unrelated event types can't confuse the assertion.
  const result = await runAgenticPlanner({
    task: {
      task_id: "j2-3",
      user_command: "thoroughly research AI news",
      task_spec: {
        needs_current_web_data: true,
        execution_constraints: {
          error_budget: {
            max_empty_search_results: 5,
            max_tool_failures: 10,
            max_replan_rounds: 10,
            max_no_file_change_runs: 10
          }
        }
      }
    },
    runtime: makeEmptySearchRuntime(),
    adapterOverride: makeSequenceAdapter([
      // Preflight has already fired on iteration 0; here we add two
      // more empty web_search_fetch calls in subsequent iterations.
      { tool_calls: [{ id: "c1", name: "web_search_fetch", arguments: { query: "x" } }] },
      { tool_calls: [{ id: "c2", name: "web_search_fetch", arguments: { query: "y" } }] },
      { text: "Couldn't find anything across multiple queries." }
    ]),
    maxIterations: 6
  });
  // With override: 3 empties → 3/5 consumed → budget NOT exhausted.
  // The post-loop SuccessContract may still fire (no required_policy
  // _groups configured here so it shouldn't), but error_budget
  // specifically must not be set as the early-exit reason.
  assert.equal(result.error_budget, null,
    `error_budget must NOT trigger early-exit when override widens cap; got ${JSON.stringify(result.error_budget)}`);
  assert.equal(result.phase_gate, null,
    "no contract → no phase_gate abort either");
});

await it("J2: execution_constraints.error_budget tightens — single failure exhausts when max=1", async () => {
  // Override max_tool_failures to 1 (default 2). A single failure now
  // exhausts immediately. Lock-in that the override is read on the
  // tightening direction too, not just widening.
  const result = await runAgenticPlanner({
    task: {
      task_id: "j2-4",
      user_command: "do something",
      task_spec: {
        execution_constraints: {
          error_budget: {
            max_tool_failures: 1
          }
        }
      }
    },
    runtime: makeAllFailingRuntime(),
    adapterOverride: makeSequenceAdapter([
      { tool_calls: [{ id: "c1", name: "launch_app", arguments: { app: "x" } }] },
      { text: "Tried." }
    ]),
    maxIterations: 4
  });
  assert.equal(result.downgraded, true);
  assert.ok(result.error_budget,
    `error_budget must fire after a single failure when max=1; got ${JSON.stringify(result)}`);
  assert.equal(result.error_budget.event, "tool_failure");
  assert.equal(result.error_budget.snapshot.max_tool_failures, 1,
    "snapshot must reflect the tightened cap");
});

// ── 10. J2 source-level lock-in ──────────────────────────────────
await it("J2 source: planner uses the shared helper for preflight AND main loop", () => {
  const planner = loadFile("../src/service/executors/agentic/planner.mjs");
  assert.match(planner, /function processAgenticToolResultForControls/,
    "planner must define the shared helper");
  // Helper is called at TWO sites: preflight and main loop. The
  // preflight site passes preflight: true; the main loop passes
  // preflight: false. Match both.
  assert.match(planner, /processAgenticToolResultForControls\([\s\S]*?preflight: true/,
    "preflight site must invoke the helper with preflight: true");
  assert.match(planner, /processAgenticToolResultForControls\([\s\S]*?preflight: false/,
    "main loop site must invoke the helper with preflight: false");
  // execution_constraints.error_budget override must be threaded into
  // createErrorBudget.
  assert.match(planner, /createErrorBudget\(\s*task\?\.task_spec\?\.execution_constraints\?\.error_budget/,
    "planner must initialise the budget from task_spec.execution_constraints.error_budget");
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
