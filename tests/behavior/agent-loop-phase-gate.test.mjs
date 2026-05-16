import assert from "node:assert/strict";
import test from "node:test";

import { createActionToolRegistry } from "../../src/service/capabilities/registry/registry.mjs";
import { runToolAgentLoop } from "../../src/service/executors/tool_using/agent-loop.mjs";
import {
  planArtifactCreationGuidance,
  planContractActionHandoff,
  planRequiredPolicyGroupGuidance
} from "../../src/service/executors/tool_using/phase-gate.mjs";

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

test("artifact guidance covers kind mismatches and multi-kind file requests", () => {
  const guidance = planArtifactCreationGuidance({
    stepGate: {
      violations: [
        {
          kind: "artifact_required_kind_mismatch",
          message: "requires a csv artifact"
        }
      ]
    },
    taskSpec: {
      artifact: { required: true, kind: "json", required_kinds: ["json", "csv", "md"] }
    },
    iteration: 1,
    maxIterations: 5,
    artifactGuidanceCount: 0
  });

  assert.ok(guidance);
  assert.match(guidance.transcriptEntry.instruction, /json, csv, md/u);
  assert.match(guidance.transcriptEntry.instruction, /write_file once per required filename\/kind/u);
  assert.deepEqual(guidance.eventPayload.required_artifact_kinds, ["json", "csv", "md"]);
});

test("required policy guidance tells run_script to execute generated script artifact files", () => {
  const guidance = planRequiredPolicyGroupGuidance({
    stepGate: {
      violations: [
        {
          kind: "generated_script_file_not_executed",
          message: "run_script did not reference the generated script artifact path or filename."
        }
      ]
    },
    iteration: 2,
    maxIterations: 5,
    requiredPolicyGuidanceCount: 0
  });

  assert.ok(guidance);
  assert.deepEqual(guidance.groups, ["run_script"]);
  assert.match(guidance.transcriptEntry.instruction, /real artifact path or filename/u);
  assert.match(guidance.transcriptEntry.instruction, /not equivalent inline code/u);
  assert.equal(guidance.eventPayload.generated_script_execution_required, true);
});

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

test("phase gate does not enter action-only handoff while non-action policy groups are still missing", () => {
  const stepGate = {
    satisfied: false,
    next_action: "continue",
    violations: [
      { kind: "email_send_required_not_called" },
      { kind: "external_web_read_required_not_called" }
    ]
  };

  const handoff = planContractActionHandoff({
    stepGate,
    transcript: [],
    iteration: 1,
    maxIterations: 6,
    contractActionGuidanceCount: 0,
    terminalContractActionGuidanceCount: 0
  });
  assert.equal(handoff, null);

  const guidance = planRequiredPolicyGroupGuidance({
    stepGate,
    iteration: 1,
    maxIterations: 6,
    requiredPolicyGuidanceCount: 0
  });
  assert.deepEqual(guidance?.groups, ["external_web_read"]);
  assert.match(guidance?.transcriptEntry?.instruction ?? "", /web_search_fetch|fetch_url_content/);
});

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

test("invalid tool call on artifact-required task injects artifact guidance before failing", async () => {
  const calls = [];
  const events = [];
  const auditLog = [];
  const tools = [
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
          observation: "External web evidence gathered.",
          metadata: {
            tool_id: "web_search_fetch",
            results: [{ title: "Evidence", url: "https://example.com/evidence" }]
          }
        };
      }
    },
    {
      id: "generate_document",
      name: "Generate Document Fixture",
      description: "fixture",
      risk_level: "low",
      requires_confirmation: false,
      parameters: { type: "object", properties: {} },
      async execute(args) {
        calls.push({ tool: "generate_document", args });
        return {
          success: true,
          observation: "DOCX artifact created.",
          artifact_paths: ["E:/linxiDoc/task_fixture/result.docx"],
          metadata: {
            path: "E:/linxiDoc/task_fixture/result.docx",
            artifact_paths: ["E:/linxiDoc/task_fixture/result.docx"]
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
    confirmationHandler: async ({ args }) => ({ decision: "approve", args }),
    finalAnswerComposer: async () => "Created the requested document."
  };

  const result = await runToolAgentLoop({
    task: makeTask({
      user_command: "Research the topic and create a docx report.",
      task_spec: {
        goal: "create_file",
        synthesis: { expected_output: "document", user_goal: "create a docx report" },
        artifact: { required: true, kind: "docx" },
        constraints: { must_verify_artifact: true },
        tool_policy: {
          policy_groups: { external_web_read: { mode: "required" } },
          web_search_fetch: { mode: "required" }
        },
        execution_constraints: {
          error_budget: {
            max_empty_search_results: 5,
            max_tool_failures: 5
          }
        },
        success_contract: {
          artifact_created: true,
          required_policy_groups: ["external_web_read"],
          required_tool_names: []
        }
      }
    }),
    runtime,
    planner: async ({ iteration }) => {
      if (iteration === 0) {
        return { type: "tool_call", tool: "web_search_fetch", args: { query: "report evidence" } };
      }
      if (iteration === 1) {
        return { type: "tool_call", args: { kind: "docx" } };
      }
      return {
        type: "tool_call",
        tool: "generate_document",
        args: {
          kind: "docx",
          outline: {
            title: "Report",
            sections: [{ heading: "Summary", body: "Evidence-backed summary." }]
          }
        }
      };
    },
    maxIterations: 4
  });

  assert.ok(["success", "partial_success"].includes(result.status), result.status);
  assert.deepEqual(calls.map((call) => call.tool), ["web_search_fetch", "generate_document"]);
  assert.ok(events.some((event) =>
    event.eventType === "contract_guidance"
    && event.payload?.source === "invalid_tool_call_gate"
    && event.payload?.required_policy_groups?.includes("artifact_generation")
  ));
  assert.ok(auditLog.some((entry) =>
    entry.event_subtype === "tool_loop.contract_guidance"
    && entry.payload?.source === "invalid_tool_call_gate"
  ));
});

test("artifact-required prose trap runs deterministic artifact obligation after guidance", async () => {
  const calls = [];
  const events = [];
  const auditLog = [];
  const tools = [
    {
      id: "generate_document",
      name: "Generate Document Fixture",
      description: "fixture",
      risk_level: "low",
      requires_confirmation: false,
      parameters: { type: "object", properties: {} },
      async execute(args) {
        calls.push({ tool: "generate_document", args });
        return {
          success: true,
          observation: "DOCX artifact created.",
          artifact_paths: ["E:/linxiDoc/task_fixture/prose.docx"],
          metadata: {
            path: "E:/linxiDoc/task_fixture/prose.docx",
            artifact_paths: ["E:/linxiDoc/task_fixture/prose.docx"],
            mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
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
    finalAnswerComposer: async () => "Composed document body."
  };

  const task = makeTask({
    user_command: "Create a docx report.",
    task_spec: {
      goal: "create_file",
      synthesis: { expected_output: "document", user_goal: "create a docx report" },
      artifact: { required: true, kind: "docx" },
      success_contract: {
        artifact_created: true,
        required_policy_groups: [],
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
    planner: async () => ({ type: "final", text: "Here is the report content in prose only." }),
    maxIterations: 4
  });

  assert.equal(result.status, "success");
  assert.deepEqual(calls.map((call) => call.tool), ["generate_document"]);
  assert.match(result.final_text, /prose\.docx/);
  assert.ok(events.some((event) =>
    event.eventType === "contract_guidance"
    && event.payload?.source === "prose_trap"
  ));
  assert.ok(events.some((event) =>
    event.eventType === "deterministic_artifact_obligation"
    && event.payload?.source === "prose_trap"
  ));
  assert.ok(events.some((event) =>
    event.eventType === "artifact_created"
    && event.payload?.path === "E:/linxiDoc/task_fixture/prose.docx"
  ));
  assert.ok(auditLog.some((entry) =>
    entry.event_subtype === "tool_loop.deterministic_artifact_obligation"
    && entry.payload?.source === "prose_trap"
  ));
});

test("artifact-required xlsx prose trap does not synthesize a generic Content spreadsheet", async () => {
  const calls = [];
  const events = [];
  const tools = [
    {
      id: "generate_document",
      name: "Generate Document Fixture",
      description: "fixture",
      risk_level: "low",
      requires_confirmation: false,
      parameters: { type: "object", properties: {} },
      async execute(args) {
        calls.push({ tool: "generate_document", args });
        return {
          success: true,
          observation: "XLSX artifact created.",
          artifact_paths: ["E:/linxiDoc/task_fixture/prose.xlsx"],
          metadata: {
            path: "E:/linxiDoc/task_fixture/prose.xlsx",
            artifact_paths: ["E:/linxiDoc/task_fixture/prose.xlsx"],
            mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
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
      appendAuditLog() {}
    },
    emitTaskEvent(eventType, payload) {
      events.push({ eventType, payload });
    },
    finalAnswerComposer: async () => "Only prose was available, no spreadsheet table."
  };

  const task = makeTask({
    user_command: "生成 Excel 报表",
    task_spec: {
      goal: "generate_document",
      synthesis: { expected_output: "artifact", user_goal: "generate xlsx report" },
      artifact: { required: true, kind: "xlsx" },
      success_contract: {
        artifact_created: true,
        required_policy_groups: [],
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
    planner: async () => ({
      type: "final",
      text: "好的，我可以给你一个 Excel 文件下载链接，但这里没有结构化表格。"
    }),
    maxIterations: 3
  });

  assert.equal(result.status, "partial_success");
  assert.deepEqual(calls, []);
  assert.ok(events.some((event) =>
    event.eventType === "contract_finalization_blocked"
    && event.payload?.violation_kinds?.includes("artifact_required_not_created")
  ));
  assert.ok(!events.some((event) =>
    event.eventType === "deterministic_artifact_obligation"
    && event.payload?.recovered === true
  ));
});

test("artifact-required markdown prose trap materializes with write_file", async () => {
  const calls = [];
  const events = [];
  const tools = [
    {
      id: "write_file",
      name: "Write File Fixture",
      description: "fixture",
      risk_level: "medium",
      requires_confirmation: false,
      parameters: { type: "object", properties: {} },
      async execute(args) {
        calls.push({ tool: "write_file", args });
        return {
          success: true,
          observation: `Wrote markdown to ${args.filename}.`,
          artifact_paths: [`E:/linxiDoc/task_fixture/${args.filename}`],
          metadata: {
            path: `E:/linxiDoc/task_fixture/${args.filename}`,
            artifact_paths: [`E:/linxiDoc/task_fixture/${args.filename}`],
            content_preview: args.content
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
      appendAuditLog() {}
    },
    emitTaskEvent(eventType, payload) {
      events.push({ eventType, payload });
    },
    finalAnswerComposer: async () => "# Markdown Report\n\n- evidence"
  };

  const task = makeTask({
    title: "markdown",
    user_command: "整理成 markdown 列表",
    task_spec: {
      goal: "generate_document",
      synthesis: { expected_output: "artifact", user_goal: "generate markdown report" },
      artifact: { required: true, kind: "md" },
      success_contract: {
        artifact_created: true,
        required_policy_groups: [],
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
    planner: async () => ({
      type: "final",
      text: "# Markdown Report\n\n- evidence\n\nAccuracy check: internal reviewer note"
    }),
    maxIterations: 3
  });

  assert.equal(result.status, "success");
  assert.deepEqual(calls.map((call) => call.tool), ["write_file"]);
  assert.equal(calls[0].args.filename, "markdown.md");
  assert.match(calls[0].args.content, /Markdown Report/);
  assert.doesNotMatch(calls[0].args.content, /Accuracy check/u);
  assert.ok(result.transcript.some((entry) =>
    entry.type === "tool_result"
    && entry.tool === "write_file"
    && entry.artifact_paths?.[0]?.endsWith(".md")
  ));
  assert.ok(events.some((event) =>
    event.eventType === "tool_call_proposed"
    && event.payload?.tool_id === "write_file"
    && event.payload?.source === "deterministic_artifact_obligation"
  ));
});
