import assert from "node:assert/strict";
import test from "node:test";

import { createActionToolRegistry } from "../../src/service/action_tools/registry.mjs";
import { runToolAgentLoop } from "../../src/service/executors/tool_using/agent-loop.mjs";

function makeWebSearchTool({ calls, outcomes }) {
  return {
    id: "web_search_fetch",
    name: "Web Search Fixture",
    description: "Behavior-test fixture for error budget flows.",
    risk_level: "low",
    requires_confirmation: false,
    policy_group: "external_web_read",
    parameters: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string" }
      }
    },
    async execute(args) {
      calls.push(args);
      const outcome = outcomes[Math.min(calls.length - 1, outcomes.length - 1)];
      return {
        success: outcome.success,
        observation: outcome.observation,
        error: outcome.error ?? null,
        metadata: outcome.metadata ?? {},
        result: outcome.result
      };
    }
  };
}

function makeTask(overrides = {}) {
  return {
    task_id: "task_agent_loop_error_budget",
    user_command: "Search and summarize external evidence.",
    execution_mode: "interactive",
    task_spec: {
      goal: "qa",
      synthesis: { expected_output: "summary", user_goal: "summarize external evidence" },
      tool_policy: {
        policy_groups: { external_web_read: { mode: "required" } },
        web_search_fetch: { mode: "required" }
      },
      success_contract: {
        required_policy_groups: ["external_web_read"],
        required_tool_names: []
      }
    },
    ...overrides
  };
}

function makeRuntime({ outcomes }) {
  const calls = [];
  const events = [];
  const auditLog = [];
  const runtime = {
    actionToolRegistry: createActionToolRegistry([makeWebSearchTool({ calls, outcomes })]),
    toolContext: {},
    toolOutputDir: null,
    securityBroker: {
      authorizeToolCall() {
        return { allowed: true, reason: null };
      }
    },
    store: {
      appendAuditLog(entry) {
        auditLog.push(entry);
      }
    },
    emitTaskEvent(eventType, payload) {
      events.push({ eventType, payload });
    },
    finalAnswerComposer: async ({ reason }) => `budget final: ${reason}`
  };
  return { runtime, calls, events, auditLog };
}

test("error budget stops the loop after repeated tool failures", async () => {
  const { runtime, calls, events, auditLog } = makeRuntime({
    outcomes: [
      { success: false, observation: "temporary upstream failure", error: "upstream_502" },
      { success: false, observation: "temporary upstream failure again", error: "upstream_502" }
    ]
  });

  const result = await runToolAgentLoop({
    task: makeTask(),
    runtime,
    planner: async ({ iteration }) => ({
      type: "tool_call",
      tool: "web_search_fetch",
      args: { query: `budget failure ${iteration}` }
    }),
    maxIterations: 4
  });

  assert.equal(result.status, "partial_success");
  assert.equal(result.error_budget.event, "tool_failure");
  assert.equal(result.error_budget.snapshot.consumed_tool_failures, 2);
  assert.match(result.final_text, /tool_failure budget exhausted/);
  assert.equal(calls.length, 2);
  assert.ok(events.some((event) =>
    event.eventType === "error_budget_signal"
    && event.payload?.event === "tool_failure"
    && /consumed 2\/2/.test(event.payload?.reason ?? "")
  ));
  assert.equal(
    auditLog.filter((entry) =>
      entry.event_subtype === "tool_loop.error_budget_charge"
      && entry.payload?.event === "tool_failure"
    ).length,
    2
  );
});

test("error budget treats empty external read results as exhausted immediately", async () => {
  const { runtime, calls, events, auditLog } = makeRuntime({
    outcomes: [
      { success: true, observation: "No results.", result: { results: [] } }
    ]
  });

  const result = await runToolAgentLoop({
    task: makeTask(),
    runtime,
    planner: async () => ({
      type: "tool_call",
      tool: "web_search_fetch",
      args: { query: "empty budget" }
    }),
    maxIterations: 4
  });

  assert.equal(result.status, "partial_success");
  assert.equal(result.error_budget.event, "empty_search_result");
  assert.equal(result.error_budget.snapshot.consumed_empty_search_results, 1);
  assert.match(result.final_text, /empty_search_result budget exhausted/);
  assert.equal(calls.length, 1);
  assert.ok(events.some((event) =>
    event.eventType === "error_budget_signal"
    && event.payload?.event === "empty_search_result"
    && /consumed 1\/1/.test(event.payload?.reason ?? "")
  ));
  assert.ok(auditLog.some((entry) =>
    entry.event_subtype === "tool_loop.error_budget_charge"
    && entry.payload?.event === "empty_search_result"
    && entry.payload?.exhausted === true
  ));
});
