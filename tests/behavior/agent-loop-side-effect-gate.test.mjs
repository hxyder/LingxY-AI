import assert from "node:assert/strict";
import test from "node:test";

import { createActionToolRegistry } from "../../src/service/capabilities/registry/registry.mjs";
import { runToolAgentLoop } from "../../src/service/executors/tool_using/agent-loop.mjs";

function makeEmailTool({ calls }) {
  return {
    id: "account_send_email",
    name: "Account Send Email",
    description: "Behavior-test fixture for side-effect gate flows.",
    risk_level: "medium",
    requires_confirmation: false,
    parameters: {
      type: "object",
      required: ["to", "body"],
      properties: {
        to: { type: "array", items: { type: "string" } },
        body: { type: "string" }
      }
    },
    async execute(args) {
      calls.push(args);
      return {
        success: true,
        observation: `sent:${args.to.join(",")}:${args.body}`
      };
    }
  };
}

function makeWebSearchTool({ calls }) {
  return {
    id: "web_search_fetch",
    name: "Web Search Fetch",
    description: "Behavior-test fixture for evidence recovery flows.",
    risk_level: "low",
    requires_confirmation: false,
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
        observation: "Search result: market source says major indexes moved higher.",
        metadata: {
          results: [{
            title: "Market source",
            url: "https://markets.example.com/us",
            snippet: "Major indexes moved higher and market breadth improved."
          }]
        }
      };
    }
  };
}

function makeTask(overrides = {}) {
  return {
    task_id: "task_agent_loop_side_effect_gate",
    user_command: "把摘要发给 reviewer@example.com",
    execution_mode: "interactive",
    task_spec: {
      goal: "execute",
      synthesis: { expected_output: "execution", user_goal: "send the summary" },
      tool_policy: {
        policy_groups: { email_send: { mode: "required" } },
        web_search_fetch: { mode: "forbidden" }
      },
      success_contract: {
        required_policy_groups: ["email_send"],
        required_tool_names: []
      },
      execution_constraints: {
        error_budget: { max_tool_failures: 5 }
      }
    },
    ...overrides
  };
}

function makeRuntime(overrides = {}) {
  const calls = [];
  const webCalls = [];
  const events = [];
  const auditLog = [];
  const runtime = {
    actionToolRegistry: createActionToolRegistry([
      makeEmailTool({ calls }),
      makeWebSearchTool({ calls: webCalls })
    ]),
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
      },
      listConnectedAccounts() {
        return [{ email: "sender@example.com" }];
      }
    },
    emitTaskEvent(eventType, payload) {
      events.push({ eventType, payload });
    },
    finalAnswerComposer: async ({ transcript }) => {
      const result = transcript.find((entry) => entry.type === "tool_result");
      return result?.observation ?? "side effect final";
    },
    ...overrides
  };
  return { runtime, calls, webCalls, events, auditLog };
}

test("side-effect gate applies contract slots before tool schema validation", async () => {
  const { runtime, calls } = makeRuntime();

  const result = await runToolAgentLoop({
    task: makeTask(),
    runtime,
    planner: async ({ iteration }) => {
      if (iteration === 0) {
        return {
          type: "tool_call",
          tool: "account_send_email",
          args: { body: "review summary" }
        };
      }
      return { type: "final", text: "done" };
    },
    maxIterations: 2
  });

  assert.equal(result.status, "success");
  assert.deepEqual(calls, [{
    to: ["reviewer@example.com"],
    body: "review summary"
  }]);
  assert.ok(result.transcript.some((entry) =>
    entry.type === "tool_result"
    && entry.tool === "account_send_email"
    && entry.success === true
  ));
  assert.ok(!result.transcript.some((entry) => entry.type === "validation_error"));
});

test("side-effect gate blocks a repeated successful side-effect even with changed args", async () => {
  const { runtime, calls, events } = makeRuntime();

  const result = await runToolAgentLoop({
    task: makeTask(),
    runtime,
    planner: async ({ iteration, transcript }) => {
      if (iteration === 0) {
        return {
          type: "tool_call",
          tool: "account_send_email",
          args: { to: ["reviewer@example.com"], body: "first body" }
        };
      }
      if (iteration === 1) {
        return {
          type: "tool_call",
          tool: "account_send_email",
          args: { to: ["reviewer@example.com"], body: "changed body" }
        };
      }
      assert.ok(transcript.some((entry) =>
        entry.type === "synthesis_retry"
        && entry.violations?.some((violation) => violation.kind === "redundant_side_effect_call")
      ));
      return { type: "final", text: "done" };
    },
    maxIterations: 3
  });

  assert.equal(result.status, "success");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    to: ["reviewer@example.com"],
    body: "first body"
  });
  assert.ok(!result.transcript.some((entry) =>
    entry.type === "tool_result"
    && entry.tool === "account_send_email"
    && entry.args?.body === "changed body"
  ));
  assert.ok(events.some((event) =>
    event.eventType === "synthesis_retry"
    && event.payload?.reason === "redundant_side_effect_call"
    && event.payload?.tool_id === "account_send_email"
  ));
});

test("email validation guardrail injects recoverable evidence guidance before retrying send", async () => {
  const { runtime, calls, webCalls, events } = makeRuntime();
  const task = makeTask({
    task_id: "task_agent_loop_email_recovery_guidance",
    user_command: "查找美股市场信息并发给 reviewer@example.com",
    task_spec: {
      goal: "execute",
      synthesis: { expected_output: "summary", user_goal: "send market digest" },
      research_quality: {
        profile: "multi_source_research",
        min_sources: 1,
        min_distinct_domains: 1,
        single_source_digest_satisfies: true
      },
      tool_policy: {
        policy_groups: {
          external_web_read: { mode: "required" },
          email_send: { mode: "required" }
        },
        web_search_fetch: { mode: "required" }
      },
      success_contract: {
        required_policy_groups: ["external_web_read", "email_send"],
        required_tool_names: []
      },
      execution_constraints: {
        error_budget: { max_tool_failures: 5 }
      }
    }
  });

  const result = await runToolAgentLoop({
    task,
    runtime,
    planner: async ({ iteration, transcript }) => {
      if (iteration === 0) {
        return {
          type: "tool_call",
          tool: "account_send_email",
          args: {
            to: ["reviewer@example.com"],
            body: "This market digest is long enough to pass body length checks, but it has no evidence yet."
          }
        };
      }
      if (iteration === 1) {
        assert.ok(transcript.some((entry) =>
          entry.type === "contract_guidance"
          && entry.source === "tool_validation"
          && entry.groups?.includes("external_web_read")
        ));
        return {
          type: "tool_call",
          tool: "web_search_fetch",
          args: { query: "US stock market major indexes today" }
        };
      }
      return {
        type: "tool_call",
        tool: "account_send_email",
        args: {
          to: ["reviewer@example.com"],
          body: [
            "Market digest",
            "",
            "Major indexes moved higher according to the gathered market source.",
            "Source: Market source — https://markets.example.com/us",
            "This synthesized digest is based on evidence gathered during this run."
          ].join("\n")
        }
      };
    },
    maxIterations: 4
  });

  assert.equal(result.status, "success");
  assert.equal(webCalls.length, 1);
  assert.equal(calls.length, 1);
  assert.ok(events.some((event) =>
    event.eventType === "contract_guidance"
    && event.payload?.source === "tool_validation"
    && event.payload?.required_policy_groups?.includes("external_web_read")
  ));
  assert.ok(events.some((event) =>
    event.eventType === "tool_call_denied"
    && event.payload?.reason === "tool_validation_failed"
  ));
});
