import assert from "node:assert/strict";
import test from "node:test";

import { createActionToolRegistry } from "../../src/service/action_tools/registry.mjs";
import { runToolAgentLoop } from "../../src/service/executors/tool_using/agent-loop.mjs";

function makeWebSearchTool({ calls, outcomes }) {
  return {
    id: "web_search_fetch",
    name: "Web Search Fixture",
    description: "Behavior-test fixture for phase gate flows.",
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
        metadata: outcome.metadata ?? {}
      };
    }
  };
}

function makeTask(overrides = {}) {
  return {
    task_id: "task_agent_loop_phase_gate",
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
      },
      execution_constraints: {
        error_budget: { max_tool_failures: 5 }
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
    finalAnswerComposer: async ({ transcript }) => {
      const success = transcript.find((entry) => entry.type === "tool_result" && entry.success === true);
      return success?.observation ?? "phase gate final";
    }
  };
  return { runtime, calls, events, auditLog };
}

function makeFileReadRuntime() {
  const calls = [];
  const events = [];
  const auditLog = [];
  const tools = [
    {
      id: "search_file_content",
      name: "Search File Content Fixture",
      description: "fixture",
      risk_level: "low",
      requires_confirmation: false,
      required_capabilities: ["file_read"],
      parameters: { type: "object", properties: { query: { type: "string" } } },
      async execute(args) {
        calls.push({ tool: "search_file_content", args });
        return {
          success: true,
          observation: "Found indexed file-content match.",
          metadata: {
            tool_id: "search_file_content",
            results: [
              {
                path: "E:/linxi/docs/brief.md",
                score: 0.93,
                coverage_scope: "single_file_text"
              }
            ]
          }
        };
      }
    },
    {
      id: "read_file_text",
      name: "Read File Text Fixture",
      description: "fixture",
      risk_level: "low",
      requires_confirmation: false,
      required_capabilities: ["file_read"],
      parameters: { type: "object", properties: { path: { type: "string" } } },
      async execute(args) {
        calls.push({ tool: "read_file_text", args });
        return {
          success: true,
          observation: "Fresh local file text extracted.",
          metadata: {
            tool_id: "read_file_text",
            path: args.path,
            content_extracted: true,
            coverage_scope: "single_file_text"
          }
        };
      }
    }
  ];
  const runtime = {
    actionToolRegistry: createActionToolRegistry(tools),
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
    finalAnswerComposer: async () => "fresh file summary"
  };
  return { runtime, calls, events, auditLog };
}

function makeFileAndWebRuntime() {
  const calls = [];
  const events = [];
  const auditLog = [];
  let finalComposerCalls = 0;
  const tools = [
    {
      id: "read_file_text",
      name: "Read File Text Fixture",
      description: "fixture",
      risk_level: "low",
      requires_confirmation: false,
      required_capabilities: ["file_read"],
      policy_group: "local_file_text_read",
      parameters: { type: "object", properties: { path: { type: "string" } } },
      async execute(args) {
        calls.push({ tool: "read_file_text", args });
        return {
          success: true,
          observation: "Fresh local attachment text.",
          metadata: {
            tool_id: "read_file_text",
            path: args.path,
            content_extracted: true,
            coverage_scope: "single_file_text"
          }
        };
      }
    },
    {
      id: "web_search_fetch",
      name: "Web Search Fixture",
      description: "fixture",
      risk_level: "low",
      requires_confirmation: false,
      policy_group: "external_web_read",
      parameters: { type: "object", properties: { query: { type: "string" } } },
      async execute(args) {
        calls.push({ tool: "web_search_fetch", args });
        return {
          success: true,
          observation: "External web evidence with a concrete current result.",
          metadata: {
            tool_id: "web_search_fetch",
            results: [
              { title: "Current public evidence", url: "https://example.com/current" }
            ]
          }
        };
      }
    }
  ];
  const runtime = {
    actionToolRegistry: createActionToolRegistry(tools),
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
    finalAnswerComposer: async () => {
      finalComposerCalls += 1;
      return "In summary: composed answer from local and web evidence, with the key takeaway grounded in the collected tool results.";
    }
  };
  return {
    runtime,
    calls,
    events,
    auditLog,
    getFinalComposerCalls: () => finalComposerCalls
  };
}

test("phase gate emits retry after one failed required tool and continues after success", async () => {
  const { runtime, calls, events, auditLog } = makeRuntime({
    outcomes: [
      { success: false, observation: "temporary upstream failure", error: "upstream_502" },
      {
        success: true,
        observation: "External evidence result with enough substance to satisfy the required external web read contract."
      }
    ]
  });

  const result = await runToolAgentLoop({
    task: makeTask(),
    runtime,
    planner: async ({ iteration }) => {
      if (iteration < 2) {
        return {
          type: "tool_call",
          tool: "web_search_fetch",
          args: { query: `phase gate query ${iteration}` }
        };
      }
      return { type: "final", text: "done" };
    },
    maxIterations: 3
  });

  assert.equal(result.status, "success");
  assert.equal(calls.length, 2);
  assert.ok(events.some((event) =>
    event.eventType === "phase_gate_signal"
    && event.payload?.next_action === "retry"
    && event.payload?.satisfied === false
  ));
  assert.ok(events.some((event) =>
    event.eventType === "phase_gate_signal"
    && event.payload?.next_action === "continue"
    && event.payload?.satisfied === true
  ));
  assert.ok(auditLog.some((entry) =>
    entry.event_subtype === "tool_loop.phase_gate"
    && entry.payload?.next_action === "retry"
  ));
});

test("phase gate injects runbook guidance after repeated same-tool failures", async () => {
  const { runtime, calls, events, auditLog } = makeRuntime({
    outcomes: [
      { success: false, observation: "upstream failed once", error: "upstream_502" },
      { success: false, observation: "upstream failed twice", error: "upstream_502" },
      { success: true, observation: "Recovered external evidence from adjusted query." }
    ]
  });

  const result = await runToolAgentLoop({
    task: makeTask(),
    runtime,
    planner: async ({ iteration, transcript }) => {
      if (iteration < 2) {
        return {
          type: "tool_call",
          tool: "web_search_fetch",
          args: { query: `repeated failure ${iteration}` }
        };
      }
      if (iteration === 2) {
        assert.ok(transcript.some((entry) =>
          entry.type === "runbook_guidance"
          && entry.runbook_id === "TOOL_REPEATED_FAILURE"
        ));
        return {
          type: "tool_call",
          tool: "web_search_fetch",
          args: { query: "adjusted recovery query" }
        };
      }
      return { type: "final", text: "planner saw runbook" };
    },
    maxIterations: 4
  });

  assert.equal(result.status, "success");
  assert.equal(calls.length, 3);
  assert.ok(events.some((event) =>
    event.eventType === "phase_gate_signal"
    && event.payload?.next_action === "escalate"
    && event.payload?.violation_kinds?.includes("tool_repeated_failure")
  ));
  assert.ok(events.some((event) =>
    event.eventType === "runbook_signal"
    && event.payload?.runbook_id === "TOOL_REPEATED_FAILURE"
  ));
  assert.ok(auditLog.some((entry) =>
    entry.event_subtype === "tool_loop.runbook_suggested"
    && entry.payload?.runbook_id === "TOOL_REPEATED_FAILURE"
  ));
  assert.ok(auditLog.some((entry) =>
    entry.event_subtype === "tool_loop.runbook_executed"
    && entry.payload?.runbook_id === "TOOL_REPEATED_FAILURE"
  ));
});

test("phase gate nudges indexed file matches toward fresh local reads", async () => {
  const { runtime, calls, events, auditLog } = makeFileReadRuntime();
  const task = makeTask({
    user_command: "Summarize the indexed local file content.",
    context_packet: {
      semantic_router_decision: {
        needed_capabilities: ["file_read"]
      }
    },
    task_spec: {
      goal: "qa",
      synthesis: { expected_output: "summary", user_goal: "summarize local file" },
      success_contract: {
        required_policy_groups: ["local_file_text_read"],
        required_tool_names: []
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
          tool: "search_file_content",
          args: { query: "brief" }
        };
      }
      if (iteration === 1) {
        const guidance = transcript.find((entry) => entry.type === "local_file_read_guidance");
        assert.ok(guidance);
        assert.match(guidance.instruction, /read_file_text/);
        assert.match(guidance.instruction, /E:\/linxi\/docs\/brief\.md/);
        return {
          type: "tool_call",
          tool: "read_file_text",
          args: { path: "E:/linxi/docs/brief.md" }
        };
      }
      return { type: "final", text: "done" };
    },
    maxIterations: 4
  });

  assert.equal(result.status, "success");
  assert.deepEqual(calls.map((call) => call.tool), ["search_file_content", "read_file_text"]);
  assert.ok(events.some((event) =>
    event.eventType === "local_file_read_guidance"
    && event.payload?.candidate_count === 1
  ));
  assert.ok(auditLog.some((entry) =>
    entry.event_subtype === "tool_loop.local_file_read_guidance"
    && entry.payload?.candidate_count === 1
  ));
});

test("phase gate injects generic required policy guidance after local read when web read is still required", async () => {
  const { runtime, calls, events, auditLog } = makeFileAndWebRuntime();
  const task = makeTask({
    user_command: "Use the attached file and current external evidence to answer.",
    context_packet: {
      file_paths: ["E:/linxi/resume.pdf"],
      semantic_router_decision: {
        needed_capabilities: ["file_read", "external_web_read"]
      }
    },
    task_spec: {
      goal: "qa",
      synthesis: { expected_output: "recommendation", user_goal: "combine local and external evidence" },
      success_contract: {
        required_policy_groups: ["local_file_text_read", "external_web_read"],
        required_tool_names: []
      }
    }
  });

  const result = await runToolAgentLoop({
    task,
    runtime,
    planner: async ({ iteration, transcript }) => {
      if (iteration === 0) {
        return { type: "tool_call", tool: "read_file_text", args: { path: "E:/linxi/resume.pdf" } };
      }
      if (iteration === 1) {
        const guidance = transcript.find((entry) =>
          entry.type === "contract_guidance"
          && entry.groups?.includes("external_web_read")
        );
        assert.ok(guidance);
        assert.match(guidance.instruction, /web_search_fetch/);
        return { type: "tool_call", tool: "web_search_fetch", args: { query: "current external evidence" } };
      }
      return { type: "final", text: "done" };
    },
    maxIterations: 4
  });

  assert.equal(result.status, "success");
  assert.deepEqual(calls.map((call) => call.tool), ["read_file_text", "web_search_fetch"]);
  assert.ok(events.some((event) =>
    event.eventType === "contract_guidance"
    && event.payload?.required_policy_groups?.includes("external_web_read")
  ));
  assert.ok(auditLog.some((entry) =>
    entry.event_subtype === "tool_loop.contract_guidance"
    && entry.payload?.required_policy_groups?.includes("external_web_read")
  ));
});

test("final branch reroutes premature final when a required policy group is still missing", async () => {
  const { runtime, calls, events } = makeFileAndWebRuntime();
  const task = makeTask({
    user_command: "Use the attached file and current external evidence to answer.",
    context_packet: {
      file_paths: ["E:/linxi/resume.pdf"],
      semantic_router_decision: {
        needed_capabilities: ["file_read", "external_web_read"]
      }
    },
    task_spec: {
      goal: "qa",
      synthesis: { expected_output: "recommendation", user_goal: "combine local and external evidence" },
      success_contract: {
        required_policy_groups: ["local_file_text_read", "external_web_read"],
        required_tool_names: []
      }
    }
  });

  const result = await runToolAgentLoop({
    task,
    runtime,
    planner: async ({ iteration, transcript }) => {
      if (iteration === 0) {
        return { type: "tool_call", tool: "read_file_text", args: { path: "E:/linxi/resume.pdf" } };
      }
      if (iteration === 1) {
        assert.ok(transcript.some((entry) =>
          entry.type === "contract_guidance"
          && entry.groups?.includes("external_web_read")
        ));
        return { type: "final", text: "premature final without web evidence" };
      }
      if (iteration === 2) {
        const guidanceCount = transcript.filter((entry) =>
          entry.type === "contract_guidance"
          && entry.groups?.includes("external_web_read")
        ).length;
        assert.equal(guidanceCount, 2);
        return { type: "tool_call", tool: "web_search_fetch", args: { query: "current external evidence" } };
      }
      return { type: "final", text: "done" };
    },
    maxIterations: 5
  });

  assert.equal(result.status, "success");
  assert.deepEqual(calls.map((call) => call.tool), ["read_file_text", "web_search_fetch"]);
  assert.ok(events.some((event) =>
    event.eventType === "phase_gate_signal"
    && event.payload?.violation_kinds?.includes("external_web_read_required_not_called")
  ));
});

test("invalid tool call falls back to final synthesis once required evidence is already satisfied", async () => {
  const { runtime, calls, events, getFinalComposerCalls } = makeFileAndWebRuntime();

  const result = await runToolAgentLoop({
    task: makeTask(),
    runtime,
    planner: async ({ iteration }) => {
      if (iteration === 0) {
        return { type: "tool_call", tool: "web_search_fetch", args: { query: "current evidence" } };
      }
      return { type: "tool_call", args: { query: "missing tool id" } };
    },
    maxIterations: 4
  });

  assert.equal(result.status, "success");
  assert.equal(
    result.final_text,
    "In summary: composed answer from local and web evidence, with the key takeaway grounded in the collected tool results."
  );
  assert.deepEqual(calls.map((call) => call.tool), ["web_search_fetch"]);
  assert.equal(getFinalComposerCalls(), 1);
  assert.ok(events.some((event) =>
    event.eventType === "synthesis_retry"
    && event.payload?.reason === "invalid_tool_call_fallback_to_final"
  ));
});
