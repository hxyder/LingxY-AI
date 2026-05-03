import assert from "node:assert/strict";
import test from "node:test";

import { createActionToolRegistry } from "../../src/service/action_tools/registry.mjs";
import { runToolAgentLoop } from "../../src/service/executors/tool_using/agent-loop.mjs";

function makeRiskyTool({ calls }) {
  return {
    id: "risky_fixture",
    name: "Risky Fixture",
    description: "Behavior-test fixture for confirmation gate flows.",
    risk_level: "high",
    requires_confirmation: true,
    parameters: {
      type: "object",
      required: ["value"],
      properties: {
        value: { type: "string" }
      }
    },
    async execute(args) {
      calls.push(args);
      return {
        success: true,
        observation: `risk-ok:${args.value}`
      };
    }
  };
}

function makeTask(overrides = {}) {
  return {
    task_id: "task_agent_loop_confirmation_gate",
    user_command: "Run the risky fixture.",
    execution_mode: "interactive",
    task_spec: {
      goal: "execute",
      synthesis: { expected_output: "execution", user_goal: "run risky fixture" },
      tool_policy: { web_search_fetch: { mode: "forbidden" } }
    },
    ...overrides
  };
}

function makeRuntime(overrides = {}) {
  const calls = [];
  const events = [];
  const auditLog = [];
  const approvals = [];
  const runtime = {
    actionToolRegistry: createActionToolRegistry([makeRiskyTool({ calls })]),
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
    pendingApprovals: {
      create(payload) {
        const approval = {
          approval_id: `approval_${approvals.length + 1}`,
          ...payload
        };
        approvals.push(approval);
        return approval;
      }
    },
    emitTaskEvent(eventType, payload) {
      events.push({ eventType, payload });
    },
    finalAnswerComposer: async ({ transcript }) => {
      const result = transcript.find((entry) => entry.type === "tool_result");
      return result?.observation ?? "no result";
    },
    ...overrides
  };
  return { runtime, calls, events, auditLog, approvals };
}

test("confirmation gate creates pending approval instead of executing without a handler", async () => {
  const { runtime, calls, events, approvals } = makeRuntime();

  const result = await runToolAgentLoop({
    task: makeTask(),
    runtime,
    planner: async () => ({
      type: "tool_call",
      tool: "risky_fixture",
      args: { value: "original" }
    }),
    maxIterations: 1
  });

  assert.equal(result.status, "waiting_external_decision");
  assert.equal(calls.length, 0);
  assert.equal(approvals.length, 1);
  assert.equal(result.approval.approval_id, "approval_1");
  assert.equal(result.approval.metadata.task_id, "task_agent_loop_confirmation_gate");
  assert.equal(result.approval.metadata.tool_id, "risky_fixture");
  assert.ok(result.transcript.some((entry) =>
    entry.type === "pending_approval"
    && entry.approval_id === "approval_1"
    && entry.tool === "risky_fixture"
  ));
  assert.ok(events.some((event) =>
    event.eventType === "pending_approval_created"
    && event.payload?.approval_id === "approval_1"
    && event.payload?.tool_id === "risky_fixture"
  ));
});

test("confirmation gate applies edited args from confirmation handler before execution", async () => {
  const { runtime, calls, events } = makeRuntime({
    confirmationHandler: async ({ args }) => ({
      decision: "edit",
      args: { ...args, value: "edited" }
    })
  });
  let iterations = 0;

  const result = await runToolAgentLoop({
    task: makeTask(),
    runtime,
    planner: async ({ iteration }) => {
      iterations += 1;
      if (iteration === 0) {
        return {
          type: "tool_call",
          tool: "risky_fixture",
          args: { value: "original" }
        };
      }
      return { type: "final", text: "done" };
    },
    maxIterations: 2
  });

  assert.equal(result.status, "success");
  assert.equal(result.final_text, "risk-ok:edited");
  assert.deepEqual(calls, [{ value: "edited" }]);
  assert.equal(iterations, 2);
  assert.ok(events.some((event) =>
    event.eventType === "tool_call_completed"
    && event.payload?.tool_id === "risky_fixture"
    && event.payload?.success === true
  ));
});

test("confirmation gate blocks high-risk tools in unattended mode without creating approval", async () => {
  const { runtime, calls, events, approvals, auditLog } = makeRuntime();

  const result = await runToolAgentLoop({
    task: makeTask({ execution_mode: "unattended_safe" }),
    runtime,
    planner: async () => ({
      type: "tool_call",
      tool: "risky_fixture",
      args: { value: "unattended" }
    }),
    maxIterations: 1
  });

  assert.equal(result.status, "partial_success");
  assert.match(result.final_text, /Blocked high-risk tool risky_fixture in unattended mode/);
  assert.equal(calls.length, 0);
  assert.equal(approvals.length, 0);
  assert.ok(result.transcript.some((entry) =>
    entry.type === "tool_denied"
    && entry.tool === "risky_fixture"
    && entry.reason === "high_risk_blocked_in_unattended_safe"
  ));
  assert.ok(events.some((event) =>
    event.eventType === "tool_call_denied"
    && event.payload?.reason === "high_risk_blocked_in_unattended_safe"
  ));
  assert.ok(auditLog.some((entry) =>
    entry.event_subtype === "tool.denied"
    && entry.payload?.reason === "high_risk_blocked_in_unattended_safe"
  ));
});
