import assert from "node:assert/strict";
import test from "node:test";

import { createActionToolRegistry } from "../../src/service/capabilities/registry/registry.mjs";
import { runToolAgentLoop } from "../../src/service/executors/tool_using/agent-loop.mjs";

function makeScheduleTool({ calls }) {
  return {
    id: "create_scheduled_task",
    name: "Create Scheduled Task",
    description: "Behavior-test fixture for scheduled fire recursion guard.",
    risk_level: "high",
    requires_confirmation: true,
    parameters: {
      type: "object",
      required: [],
      properties: {}
    },
    async execute(args) {
      calls.push(args);
      return {
        success: true,
        observation: "scheduled"
      };
    }
  };
}

function makeNotifyTool({ calls }) {
  return {
    id: "notify",
    name: "Notify",
    description: "Behavior-test fixture notification tool.",
    risk_level: "low",
    requires_confirmation: false,
    parameters: {
      type: "object",
      required: ["body"],
      properties: {
        body: { type: "string" }
      }
    },
    async execute(args) {
      calls.push(args);
      return {
        success: true,
        observation: `notified:${args.body}`
      };
    }
  };
}

function makeTask() {
  return {
    task_id: "task_agent_loop_scheduled_fire_gate",
    user_command: "提醒我交 timecard",
    execution_mode: "interactive",
    context_packet: {
      selection_metadata: {
        scheduled_task_fire: true
      }
    },
    task_spec: {
      goal: "execute",
      synthesis: { expected_output: "execution", user_goal: "notify now" },
      tool_policy: { web_search_fetch: { mode: "forbidden" } },
      success_contract: {
        required_tool_names: ["notify"],
        required_policy_groups: []
      },
      execution_constraints: {
        error_budget: { max_tool_failures: 5 }
      }
    }
  };
}

function makeRuntime() {
  const scheduleCalls = [];
  const notifyCalls = [];
  const events = [];
  const runtime = {
    actionToolRegistry: createActionToolRegistry([
      makeScheduleTool({ calls: scheduleCalls }),
      makeNotifyTool({ calls: notifyCalls })
    ]),
    toolContext: {},
    toolOutputDir: null,
    securityBroker: {
      authorizeToolCall() {
        return { allowed: true, reason: null };
      }
    },
    store: {
      appendAuditLog() {}
    },
    emitTaskEvent(eventType, payload) {
      events.push({ eventType, payload });
    },
    finalAnswerComposer: async ({ transcript }) => {
      const result = transcript.find((entry) => entry.type === "tool_result");
      return result?.observation ?? "scheduled fire final";
    }
  };
  return { runtime, scheduleCalls, notifyCalls, events };
}

test("scheduled-fire gate denies hallucinated schedule registry calls before execution", async () => {
  const { runtime, scheduleCalls, notifyCalls, events } = makeRuntime();

  const result = await runToolAgentLoop({
    task: makeTask(),
    runtime,
    planner: async ({ transcript }) => {
      const deniedSchedule = transcript.some((entry) =>
        entry.type === "tool_denied"
        && entry.tool === "create_scheduled_task"
      );
      if (!deniedSchedule) {
        return {
          type: "tool_call",
          tool: "create_scheduled_task",
          args: { name: "recursive", trigger: {}, action: {} }
        };
      }
      assert.ok(transcript.some((entry) =>
        entry.type === "synthesis_retry"
        && entry.violations?.some((violation) => violation.kind === "scheduled_fire_recursion_blocked")
      ));
      return {
        type: "tool_call",
        tool: "notify",
        args: { body: "timecard" }
      };
    },
    maxIterations: 3
  });

  assert.equal(result.status, "success");
  assert.equal(scheduleCalls.length, 0);
  assert.deepEqual(notifyCalls, [{ body: "timecard" }]);
  assert.ok(result.transcript.some((entry) =>
    entry.type === "tool_denied"
    && entry.tool === "create_scheduled_task"
    && entry.reason === "scheduled_fire_cannot_modify_schedule_registry"
  ));
  assert.ok(!result.transcript.some((entry) =>
    entry.type === "tool_result"
    && entry.tool === "create_scheduled_task"
  ));
  assert.ok(events.some((event) =>
    event.eventType === "tool_call_denied"
    && event.payload?.tool_id === "create_scheduled_task"
    && event.payload?.reason === "scheduled_fire_cannot_modify_schedule_registry"
  ));
});
