import assert from "node:assert/strict";
import test from "node:test";

import { createActionToolRegistry } from "../../src/service/capabilities/registry/registry.mjs";
import { runToolAgentLoop } from "../../src/service/executors/tool_using/agent-loop.mjs";

function makeSearchTool({ calls }) {
  return {
    id: "web_search_fetch",
    name: "Web Search Fixture",
    description: "Behavior-test fixture for search saturation flows.",
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
      return {
        success: true,
        observation: `Search result ${calls.length}: repeated publisher material with enough detail to count as substantive evidence.`,
        metadata: {
          results: [
            {
              title: `Repeated source ${calls.length}`,
              url: `https://a.com/article-${calls.length}`
            }
          ]
        }
      };
    }
  };
}

function makeTask() {
  return {
    task_id: "task_agent_loop_saturation_gate",
    user_command: "Do multi-source research on a topic.",
    execution_mode: "interactive",
    task_spec: {
      goal: "qa",
      synthesis: { expected_output: "summary", user_goal: "multi-source research" },
      tool_policy: {
        policy_groups: { external_web_read: { mode: "required" } },
        web_search_fetch: { mode: "required" }
      },
      success_contract: {
        required_policy_groups: ["external_web_read"],
        required_tool_names: []
      },
      research_quality: {
        profile: "multi_source_research"
      },
      execution_constraints: {
        error_budget: {
          max_empty_search_results: 5,
          max_tool_failures: 5
        }
      }
    }
  };
}

function makeRuntime() {
  const calls = [];
  const events = [];
  const auditLog = [];
  const runtime = {
    actionToolRegistry: createActionToolRegistry([makeSearchTool({ calls })]),
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
    finalAnswerComposer: async () => "saturation final"
  };
  return { runtime, calls, events, auditLog };
}

test("saturation gate adds a one-shot hint when recent searches repeat baseline domains", async () => {
  const { runtime, calls, events, auditLog } = makeRuntime();

  const result = await runToolAgentLoop({
    task: makeTask(),
    runtime,
    planner: async ({ transcript }) => {
      if (transcript.some((entry) => entry.type === "saturation_hint")) {
        return { type: "final", text: "done" };
      }
      return {
        type: "tool_call",
        tool: "web_search_fetch",
        args: { query: `search round ${calls.length + 1}` }
      };
    },
    maxIterations: 6
  });

  assert.equal(result.status, "success");
  assert.equal(result.final_text, "saturation final");
  assert.equal(calls.length, 4);

  const hintEntries = result.transcript.filter((entry) => entry.type === "saturation_hint");
  assert.equal(hintEntries.length, 1);
  assert.equal(hintEntries[0].window_size, 3);
  assert.deepEqual(hintEntries[0].repeated_domains, ["a.com"]);

  const hintEvents = events.filter((event) => event.eventType === "saturation_hint");
  assert.equal(hintEvents.length, 1);
  assert.equal(hintEvents[0].payload?.baseline_domain_count, 1);
  assert.deepEqual(hintEvents[0].payload?.repeated_domains, ["a.com"]);

  const hintAudits = auditLog.filter((entry) => entry.event_subtype === "tool_loop.saturation_hint");
  assert.equal(hintAudits.length, 1);
  assert.deepEqual(hintAudits[0].payload?.repeated_domains, ["a.com"]);
});
