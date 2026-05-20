import assert from "node:assert/strict";
import test from "node:test";

import { runAgenticPlanner } from "../../src/service/executors/agentic/planner.mjs";

test("agentic planner emits immediate model-wait progress before first provider output", async () => {
  const events = [];
  const adapter = {
    supportsStreaming: false,
    describe() {
      return { provider: "test" };
    },
    async generate() {
      return {
        text: "A brief summary.",
        tool_calls: [],
        usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 }
      };
    }
  };

  const result = await runAgenticPlanner({
    task: {
      task_id: "task_agentic_progress",
      user_command: "Summarize this briefly.",
      task_spec: {
        goal: "answer",
        synthesis: { expected_output: "direct_answer" },
        success_contract: {
          required_policy_groups: [],
          required_tool_names: []
        }
      }
    },
    runtime: {
      actionToolRegistry: {
        list: () => [],
        get: () => null
      },
      store: {
        appendAuditLog() {}
      }
    },
    adapterOverride: adapter,
    onEvent(event) {
      events.push(event);
    },
    maxIterations: 1
  });

  assert.equal(result.finalText, "A brief summary.");
  assert.ok(events.some((event) =>
    event.event_type === "planner_request_started"
    && event.payload?.planner_mode === "agentic_planner"
  ));
  assert.ok(events.some((event) =>
    event.event_type === "status_changed"
    && event.payload?.sub_status === "waiting_for_planner_first_output"
    && event.payload?.planner_mode === "agentic_planner"
    && event.payload?.heartbeat_count === 0
  ));
});
