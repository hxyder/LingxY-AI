import assert from "node:assert/strict";
import test from "node:test";

import { createErrorBudget } from "../../src/service/core/runtime/error-budget.mjs";
import { processAgenticToolResultForControls } from "../../src/service/executors/agentic/tool-result-controls.mjs";

function runControl(overrides = {}) {
  const events = [];
  const result = processAgenticToolResultForControls({
    call: { name: "launch_app" },
    result: { success: true, observation: "Opened the requested app successfully." },
    transcript: [
      {
        role: "tool",
        name: "launch_app",
        success: true,
        observation: "Opened the requested app successfully."
      }
    ],
    errorBudget: createErrorBudget(),
    iteration: 0,
    maxIterations: 8,
    taskSpec: undefined,
    onEvent: (event) => events.push(event),
    preflight: false,
    ...overrides
  });
  return { ...result, events };
}

test("agentic tool-result controls exhaust tool failure budget with a structured early exit", () => {
  const { errorBudget, earlyExit, events } = runControl({
    call: { name: "launch_app" },
    result: { success: false, observation: "launch failed" },
    transcript: [
      { role: "tool", name: "launch_app", success: false, observation: "launch failed" }
    ],
    errorBudget: createErrorBudget({ max_tool_failures: 1 })
  });

  assert.equal(errorBudget.consumed_tool_failures, 1);
  assert.equal(earlyExit.kind, "error_budget_exhausted");
  assert.equal(earlyExit.error_budget.event, "tool_failure");
  assert.equal(earlyExit.error_budget.snapshot.max_tool_failures, 1);
  assert.deepEqual(events.map((event) => event.event_type), ["log", "error_budget_signal"]);
});

test("agentic tool-result controls treat empty external reads as budget events", () => {
  const { errorBudget, earlyExit, events } = runControl({
    call: { name: "web_search_fetch" },
    result: { success: true, observation: "(empty)", metadata: { results: [] } },
    transcript: [
      {
        role: "tool",
        name: "web_search_fetch",
        success: true,
        observation: "(empty)",
        metadata: { results: [] }
      }
    ],
    errorBudget: createErrorBudget({ max_empty_search_results: 1 }),
    preflight: true
  });

  assert.equal(errorBudget.consumed_empty_search_results, 1);
  assert.equal(earlyExit.kind, "error_budget_exhausted");
  assert.equal(earlyExit.error_budget.event, "empty_search_result");
  assert.equal(events[1].payload.preflight, true);
});

test("agentic tool-result controls emit phase gate signals when budget continues", () => {
  const { earlyExit, events } = runControl({
    taskSpec: {
      success_contract: {
        required_policy_groups: ["external_web_read"],
        required_tool_names: []
      }
    }
  });

  assert.equal(earlyExit, null);
  const phaseEvent = events.find((event) => event.event_type === "phase_gate_signal");
  assert.ok(phaseEvent);
  assert.equal(phaseEvent.payload.next_action, "continue");
  assert.equal(phaseEvent.payload.satisfied, false);
  assert.ok(phaseEvent.payload.violation_kinds.includes("external_web_read_required_not_called"));
});

test("agentic tool-result controls nudge indexed file hits toward fresh reads", () => {
  const { earlyExit, localFileReadGuidance } = runControl({
    call: { name: "search_file_content" },
    result: {
      success: true,
      observation: "Found matching indexed file content.",
      metadata: {
        results: [{ path: "E:/linxi/docs/brief.md", score: 0.91, coverage_scope: "single_file_text" }]
      }
    },
    transcript: [
      {
        role: "tool",
        name: "search_file_content",
        success: true,
        observation: "Found matching indexed file content.",
        metadata: {
          results: [{ path: "E:/linxi/docs/brief.md", score: 0.91, coverage_scope: "single_file_text" }]
        }
      }
    ],
    taskSpec: {
      success_contract: {
        required_policy_groups: ["local_file_text_read"]
      }
    }
  });

  assert.equal(earlyExit, null);
  assert.ok(localFileReadGuidance);
  assert.match(localFileReadGuidance.instruction, /read_file_text/);
  assert.match(localFileReadGuidance.instruction, /E:\/linxi\/docs\/brief\.md/);
});
