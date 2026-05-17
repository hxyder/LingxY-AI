import assert from "node:assert/strict";
import test from "node:test";

import { createActionToolRegistry } from "../../src/service/capabilities/registry/registry.mjs";
import { createLaunchAmbiguityResult } from "../../src/service/action_tools/tools/index.mjs";
import { createTaskSpec } from "../../src/service/core/task-spec.mjs";
import { FILE_EVIDENCE_COVERAGE } from "../../src/service/core/file-evidence-coverage.mjs";
import { runToolAgentLoop } from "../../src/service/executors/tool_using/agent-loop.mjs";

function makeLookupTool() {
  return {
    id: "lookup_fixture",
    name: "Lookup Fixture",
    description: "Returns a deterministic observation for behavior tests.",
    risk_level: "low",
    requires_confirmation: false,
    parameters: {
      type: "object",
      required: ["value"],
      properties: {
        value: { type: "string" }
      }
    },
    async execute(args) {
      return {
        success: true,
        observation: `observed:${args.value}`,
        metadata: { source: "behavior-test" }
      };
    }
  };
}

function makeReadFileTextTool() {
  return {
    id: "read_file_text",
    name: "Read File Text",
    description: "Returns deterministic file text for behavior tests.",
    risk_level: "low",
    requires_confirmation: false,
    parameters: {
      type: "object",
      required: ["path"],
      properties: {
        path: { type: "string" }
      }
    },
    async execute(args) {
      return {
        success: true,
        observation: `file:${args.path}:hello`,
        metadata: {
          tool_id: "read_file_text",
          path: args.path
        }
      };
    }
  };
}

function makeListFilesTool() {
  return {
    id: "list_files",
    name: "List Files",
    description: "Returns deterministic shallow file enumeration for behavior tests.",
    risk_level: "low",
    requires_confirmation: false,
    parameters: {
      type: "object",
      required: ["dir"],
      properties: {
        dir: { type: "string" }
      }
    },
    async execute(args) {
      return {
        success: true,
        observation: `listed:${args.dir}`,
        metadata: {
          tool_id: "list_files",
          dir: args.dir,
          files: [`${args.dir}\\a.md`, `${args.dir}\\b.md`],
          coverage_scope: FILE_EVIDENCE_COVERAGE.DIRECTORY_LISTING_SHALLOW,
          content_extracted: false,
          recursive: false
        }
      };
    }
  };
}

function makeNoopTool(id, extra = {}) {
  return {
    id,
    name: id,
    description: `Noop ${id}`,
    risk_level: "low",
    requires_confirmation: false,
    parameters: {
      type: "object",
      required: [],
      properties: {}
    },
    async execute(args = {}) {
      return {
        success: true,
        observation: `${id}:${JSON.stringify(args)}`
      };
    },
    ...extra
  };
}

function makeGenerateDocumentTool() {
  return {
    id: "generate_document",
    name: "Generate Document",
    description: "Generate a document artifact for behavior tests.",
    risk_level: "low",
    requires_confirmation: false,
    parameters: {
      type: "object",
      required: ["kind", "outline"],
      properties: {
        kind: { type: "string", enum: ["pptx", "docx", "xlsx", "pdf", "html"] },
        outline: { type: "object" }
      }
    },
    async execute(args = {}) {
      return {
        success: true,
        observation: `generated:${args.kind}`,
        artifact_paths: [`E:\\linxiDoc\\behavior.${args.kind}`]
      };
    }
  };
}

function makeRuntime(overrides = {}) {
  const events = [];
  const auditLog = [];
  const runtime = {
    actionToolRegistry: createActionToolRegistry([makeLookupTool()]),
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
    ...overrides
  };
  return { runtime, events, auditLog };
}

function makeTask() {
  return {
    task_id: "task_agent_loop_behavior",
    user_command: "Use the fixture and answer from its result.",
    execution_mode: "interactive",
    task_spec: {
      goal: "qa",
      synthesis: { expected_output: "summary", user_goal: "answer from fixture" },
      tool_policy: { web_search_fetch: { mode: "forbidden" } }
    }
  };
}

test("agent loop carries tool_result into the next planner turn and final composer", async () => {
  const { runtime, events } = makeRuntime({
    finalAnswerComposer: async ({ transcript }) => {
      assert.ok(transcript.some((entry) =>
        entry.type === "tool_result"
        && entry.tool === "lookup_fixture"
        && entry.observation === "observed:alpha"
      ));
      return "final: observed:alpha";
    }
  });
  const plannerSnapshots = [];

  const planner = async ({ transcript, iteration }) => {
    plannerSnapshots.push(transcript.map((entry) => ({
      type: entry.type,
      tool: entry.tool,
      observation: entry.observation
    })));
    if (iteration === 0) {
      return { type: "tool_call", tool: "lookup_fixture", args: { value: "alpha" } };
    }
    assert.ok(transcript.some((entry) =>
      entry.type === "tool_result"
      && entry.tool === "lookup_fixture"
      && entry.observation === "observed:alpha"
    ));
    return { type: "final", text: "Planner saw the fixture result." };
  };

  const result = await runToolAgentLoop({
    task: makeTask(),
    runtime,
    planner,
    maxIterations: 3
  });

  assert.equal(result.status, "success");
  assert.equal(result.final_text, "final: observed:alpha");
  assert.equal(plannerSnapshots.length, 2);
  assert.deepEqual(plannerSnapshots[0], []);
  assert.equal(plannerSnapshots[1][0].type, "tool_result");
  assert.equal(plannerSnapshots[1][0].observation, "observed:alpha");
  assert.ok(events.some((event) => event.eventType === "tool_call_completed" && event.payload?.success === true));
});

test("synthesis violations after action tools recover through final composer instead of hidden planner retries", async () => {
  let composerCalls = 0;
  const launchTool = makeNoopTool("launch_app", {
    async execute(args = {}) {
      return {
        success: true,
        observation: `Launched ${args.app}. Pricing page details include API access, hosted models, cloud execution, no desktop model download requirement, GPU handled by provider infrastructure, and paid usage after any included credits.`
      };
    }
  });
  const { runtime, events } = makeRuntime({
    actionToolRegistry: createActionToolRegistry([launchTool]),
    finalAnswerComposer: async ({ reason, draft_text, prior_drafts }) => {
      composerCalls += 1;
      assert.equal(reason, "synthesis_recovery_after_planner_final");
      assert.match(draft_text, /Launched/);
      assert.match(prior_drafts, /answer_not_synthesized/);
      return "总结：可以直接调用云端模型 API，不需要把模型下载到桌面；运行推理所需 GPU 由服务商基础设施承担，但 API 通常按量计费，是否免费取决于账户赠送额度或具体套餐。";
    }
  });
  const task = {
    task_id: "task_synthesis_recovery_after_action",
    user_command: "所以我直接能调用它的模型，不用下载到桌面？但是不是还是需要GPU来运行模型吗？这些都是免费的吗？",
    execution_mode: "interactive",
    task_spec: {
      goal: "launch_and_act",
      synthesis: { expected_output: "summary", user_goal: "answer cloud model pricing and GPU requirements" },
      tool_policy: { web_search_fetch: { mode: "optional" } },
      success_contract: {
        tool_called: true,
        required_tool_names: ["launch_app"],
        required_policy_groups: []
      }
    }
  };

  const result = await runToolAgentLoop({
    task,
    runtime,
    planner: async ({ iteration }) => {
      if (iteration === 0) {
        return { type: "tool_call", tool: "launch_app", args: { app: "https://developers.openai.com/api/docs/pricing" } };
      }
      return { type: "final", text: "I opened the pricing page." };
    },
    maxIterations: 3
  });

  assert.equal(result.status, "success");
  assert.equal(composerCalls, 1);
  assert.match(result.final_text, /总结/);
  assert.ok(events.some((event) =>
    event.eventType === "synthesis_retry"
    && event.payload?.recovery === "final_composer"
  ));
  assert.ok(events.some((event) =>
    event.eventType === "final_composer_started"
    && event.payload?.reason === "synthesis_recovery_after_planner_final"
  ));
});

test("preauthorized action-only handoff sends once without another planner turn", async () => {
  const sent = [];
  const webTool = makeNoopTool("web_search_fetch", {
    async execute() {
      return {
        success: true,
        observation: "Market evidence from a successful search.",
        metadata: {
          results: [{ title: "Market", url: "https://example.com/market", snippet: "Market evidence." }]
        }
      };
    }
  });
  const emailTool = {
    id: "account_send_email",
    name: "Account Send Email",
    description: "Send email for behavior tests.",
    risk_level: "low",
    requires_confirmation: false,
    parameters: {
      type: "object",
      required: ["to", "subject", "body"],
      properties: {
        to: { type: "array", items: { type: "string" } },
        subject: { type: "string" },
        body: { type: "string" }
      }
    },
    async execute(args) {
      sent.push(args);
      return {
        success: true,
        observation: "Email sent."
      };
    }
  };
  const plannerIterations = [];
  const { runtime, events } = makeRuntime({
    actionToolRegistry: createActionToolRegistry([webTool, emailTool]),
    finalAnswerComposer: async ({ reason }) => {
      assert.equal(reason, "action_only_email_body");
      return "Polished email body with enough synthesized context to pass side-effect validation. It is based on the successful market evidence and excludes tool logs.";
    }
  });
  const task = {
    ...makeTask(),
    execution_mode: "unattended_safe",
    user_command: "Summarize market news and email reviewer@example.com",
    task_spec: {
      goal: "search_and_answer",
      tool_policy: { web_search_fetch: { mode: "required" } },
      success_contract: { required_policy_groups: ["external_web_read", "email_send"] }
    },
    context_packet: {
      selection_metadata: {
        side_effect_authorization: {
          kind: "scheduled_fire",
          decision: "preauthorized",
          source: "schedule_definition",
          execution_mode: "unattended_safe",
          groups: ["email_send"]
        },
        side_effect_contract: {
          version: 1,
          kind: "side_effect_contract",
          groups: {
            email_send: {
              slots: {
                to: { entity: "email_address", values: ["reviewer@example.com"], mode: "preserve" }
              }
            }
          }
        }
      }
    }
  };
  const planner = async ({ iteration }) => {
    plannerIterations.push(iteration);
    if (iteration === 0) return { type: "tool_call", tool: "web_search_fetch", args: { query: "market" } };
    return { type: "final", text: "Ready to send." };
  };

  const result = await runToolAgentLoop({ task, runtime, planner, maxIterations: 5 });

  assert.equal(result.status, "success");
  assert.equal(result.final_text, "Polished email body with enough synthesized context to pass side-effect validation. It is based on the successful market evidence and excludes tool logs.");
  assert.deepEqual(plannerIterations, [0]);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, ["reviewer@example.com"]);
  assert.equal(sent[0].body, "Polished email body with enough synthesized context to pass side-effect validation. It is based on the successful market evidence and excludes tool logs.");
  assert.ok(events.some((event) =>
    event.eventType === "deterministic_action_fallback"
    && event.payload?.reason === "preauthorized_action_only_finalizer"
  ));
});

test("recent local event runs downgrade when final answer lacks dated event details", async () => {
  const webTool = {
    id: "web_search_fetch",
    name: "Web Search Fetch",
    description: "Search fixture.",
    risk_level: "low",
    requires_confirmation: false,
    parameters: {
      type: "object",
      required: [],
      properties: {}
    },
    async execute() {
      return {
        success: true,
        observation: "搜索结果：Raleigh events this weekend. VisitRaleigh events calendar.",
        metadata: {
          results: [{ url: "https://www.visitraleigh.com/events/" }]
        }
      };
    }
  };
  const { runtime } = makeRuntime({
    actionToolRegistry: createActionToolRegistry([webTool])
  });
  const task = {
    ...makeTask(),
    user_command: "我的城市最近有什么有意思的活动吗？",
    task_spec: {
      goal: "qa",
      synthesis: { expected_output: "summary", user_goal: "recent local events" },
      tool_policy: { web_search_fetch: { mode: "required" } },
      success_contract: { required_policy_groups: ["external_web_read"] },
      research_quality: {
        profile: "multi_source_research",
        min_sources: 1,
        min_distinct_domains: 1,
        single_source_digest_satisfies: false
      }
    }
  };

  const result = await runToolAgentLoop({
    task,
    runtime,
    planner: async ({ iteration }) => iteration === 0
      ? { type: "tool_call", tool: "web_search_fetch", args: { query: "Raleigh events" } }
      : { type: "final", text: "没有直接列出具体的活动名称和日期。建议直接访问活动日历。" },
    maxIterations: 3
  });

  assert.equal(result.status, "partial_success");
  assert.equal(result.answer_quality_violations[0]?.kind, "local_event_answer_lacks_concrete_events");
});

test("invalid tool arguments do not poison repeated-call dedupe before repair", async () => {
  const { runtime, events } = makeRuntime({
    actionToolRegistry: createActionToolRegistry([makeGenerateDocumentTool()]),
    finalAnswerComposer: async ({ transcript }) => {
      assert.ok(transcript.some((entry) =>
        entry.type === "validation_error"
        && entry.tool === "generate_document"
      ));
      assert.ok(transcript.some((entry) =>
        entry.type === "tool_result"
        && entry.tool === "generate_document"
        && entry.success === true
      ));
      return "document generated";
    }
  });
  const task = {
    task_id: "task_document_validation_repair",
    user_command: "Generate a Word document.",
    execution_mode: "interactive",
    task_spec: {
      goal: "generate_document",
      artifact: { required: true, kind: "docx", quality: "draft" },
      synthesis: { expected_output: "docx", user_goal: "generate a document" },
      tool_policy: { web_search_fetch: { mode: "forbidden" } },
      success_contract: {
        artifact_created: true,
        artifact_registered: false,
        tool_called: true,
        required_tool_names: [],
        required_policy_groups: []
      }
    }
  };

  const result = await runToolAgentLoop({
    task,
    runtime,
    planner: async ({ iteration }) => {
      if (iteration === 0 || iteration === 1) {
        return { type: "tool_call", tool: "generate_document", args: { kind: "docx" } };
      }
      if (iteration === 2) {
        return {
          type: "tool_call",
          tool: "generate_document",
          args: {
            kind: "docx",
            outline: {
              title: "Repairable Document",
              sections: [
                { heading: "Summary", body: "This section proves the corrected arguments reached the tool." }
              ]
            }
          }
        };
      }
      return { type: "final", text: "done" };
    },
    maxIterations: 5
  });

  assert.equal(result.status, "success");
  assert.equal(result.final_text, "document generated");
  assert.equal(
    result.transcript.filter((entry) => entry.type === "validation_error" && entry.tool === "generate_document").length,
    2
  );
  assert.ok(events.some((event) =>
    event.eventType === "tool_call_completed"
    && event.payload?.tool_id === "generate_document"
    && event.payload?.success === true
  ));
  assert.ok(!events.some((event) =>
    event.eventType === "synthesis_retry"
    && event.payload?.reason === "repeated_tool_call"
  ));
});

test("typed artifact contract exposes document generation without relying on artifact wording regex", async () => {
  const { runtime } = makeRuntime({
    actionToolRegistry: createActionToolRegistry([makeGenerateDocumentTool()]),
    finalAnswerComposer: async ({ transcript }) => {
      assert.ok(transcript.some((entry) =>
        entry.type === "tool_result"
        && entry.tool === "generate_document"
        && entry.success === true
      ));
      return "excel generated";
    }
  });
  const task = {
    task_id: "task_typed_artifact_surface",
    user_command: "继续处理这个",
    execution_mode: "interactive",
    context_packet: {
      semantic_router_decision: {
        needed_capabilities: ["artifact_generation"],
        artifact_required: true,
        expected_output: "artifact",
        output_kind: "xlsx"
      }
    },
    task_spec: {
      goal: "qa",
      artifact: { required: true, kind: "xlsx", quality: "draft" },
      synthesis: { expected_output: "artifact", user_goal: "turn prior context into a spreadsheet" },
      tool_policy: { web_search_fetch: { mode: "forbidden" } },
      success_contract: {
        artifact_created: true,
        artifact_registered: true,
        tool_called: false,
        required_tool_names: [],
        required_policy_groups: []
      }
    }
  };

  const result = await runToolAgentLoop({
    task,
    runtime,
    planner: async ({ tools }) => {
      assert.ok(tools.some((tool) => tool.id === "generate_document"));
      return {
        type: "tool_call",
        tool: "generate_document",
        args: {
          kind: "xlsx",
          outline: {
            title: "Receipt Summary",
            headers: ["Field", "Value"],
            rows: [
              ["Renter", "Xiaoyu Han"],
              ["Total", "$1,128.60"]
            ]
          }
        }
      };
    },
    maxIterations: 1
  });

  assert.equal(result.status, "success");
  assert.equal(result.final_text, "excel generated");
  assert.ok(!result.transcript.some((entry) =>
    entry.type === "tool_denied"
    && entry.reason === "tool_not_available_for_task"
  ));
});

test("deterministic artifact recovery does not turn final prose into a docx when edit_file is required by patched spec", async () => {
  const generatedCalls = [];
  const generateDocument = {
    ...makeGenerateDocumentTool(),
    async execute(args = {}) {
      generatedCalls.push(args);
      return {
        success: true,
        observation: `generated:${args.kind}`,
        artifact_paths: [`E:\\linxiDoc\\bad-fallback.${args.kind}`]
      };
    }
  };
  const { runtime, events } = makeRuntime({
    actionToolRegistry: createActionToolRegistry([makeReadFileTextTool(), generateDocument]),
    finalAnswerComposer: async () => [
      "好的，我已经整理好了优化后的 Word 版本。",
      "以下是内容，您可以复制到 Word 文档中。"
    ].join("\n")
  });
  const task = {
    task_id: "task_existing_docx_edit_required",
    user_command: "结合你发现的简历问题，给我整理一下，做一个优化后的word版本",
    execution_mode: "interactive",
    task_spec_initial: {
      goal: "qa",
      artifact: { required: true, kind: "docx", quality: "draft" },
      synthesis: { expected_output: "artifact", user_goal: "revise previous resume advice into Word" },
      tool_policy: { web_search_fetch: { mode: "forbidden" } },
      success_contract: {
        artifact_created: true,
        artifact_registered: false,
        tool_called: true,
        required_tool_names: [],
        required_policy_groups: []
      }
    },
    task_spec: {
      goal: "transform_existing_file",
      artifact: { required: true, kind: "docx", quality: "draft" },
      synthesis: { expected_output: "artifact", user_goal: "update the existing resume document in place" },
      tool_policy: { web_search_fetch: { mode: "forbidden" } },
      success_contract: {
        artifact_created: true,
        artifact_registered: false,
        tool_called: true,
        required_tool_names: ["edit_file"],
        required_policy_groups: []
      }
    }
  };

  const result = await runToolAgentLoop({
    task,
    runtime,
    planner: async ({ iteration }) => {
      if (iteration === 0) {
        return { type: "tool_call", tool: "read_file_text", args: { path: "E:\\linxiDoc\\resume.docx" } };
      }
      return { type: "final", text: "Here is the revised document text, but no file was edited." };
    },
    maxIterations: 3
  });

  assert.equal(result.status, "partial_success");
  assert.deepEqual(generatedCalls, []);
  assert.ok(result.contract_violations.some((violation) => violation.kind === "edit_file_required_not_called"));
  assert.ok(!events.some((event) => event.eventType === "deterministic_artifact_obligation"));
});

test("artifact-required tasks cannot finalize before creating a file", async () => {
  const { runtime, events } = makeRuntime({
    actionToolRegistry: createActionToolRegistry([makeGenerateDocumentTool()]),
    finalAnswerComposer: async ({ transcript }) => {
      assert.ok(transcript.some((entry) =>
        entry.type === "tool_result"
        && entry.tool === "generate_document"
        && entry.artifact_paths?.length === 1
      ));
      return "document generated";
    }
  });
  const seenGuidance = [];
  const task = {
    task_id: "task_artifact_required_gate",
    user_command: "给我生成一份制作 multi-agent 的文档",
    execution_mode: "interactive",
    task_spec: {
      goal: "generate_document",
      artifact: { required: true, kind: "docx", quality: "draft" },
      synthesis: { expected_output: "artifact", user_goal: "generate a document" },
      tool_policy: { web_search_fetch: { mode: "forbidden" } },
      success_contract: {
        artifact_created: true,
        artifact_registered: true,
        tool_called: true,
        required_tool_names: [],
        required_policy_groups: []
      }
    }
  };

  const result = await runToolAgentLoop({
    task,
    runtime,
    planner: async ({ transcript }) => {
      const guidance = transcript.find((entry) =>
        entry.type === "contract_guidance"
        && entry.groups?.includes("artifact_generation")
      );
      if (!guidance) return { type: "final", text: "Here is the document text, but no file." };
      seenGuidance.push(guidance.instruction);
      const generated = transcript.some((entry) => entry.type === "tool_result" && entry.tool === "generate_document");
      if (!generated) {
        return {
          type: "tool_call",
          tool: "generate_document",
          args: {
            kind: "docx",
            outline: {
              title: "Multi-Agent Systems",
              sections: [
                { heading: "Overview", body: "A practical overview of multi-agent design." }
              ]
            }
          }
        };
      }
      return { type: "final", text: "done" };
    },
    maxIterations: 5
  });

  assert.equal(result.status, "success");
  assert.equal(result.final_text, "document generated");
  assert.ok(seenGuidance.some((text) => text.includes("Do not finalize with prose only")));
  assert.ok(events.some((event) =>
    event.eventType === "phase_gate_signal"
    && event.payload?.violation_kinds?.includes("artifact_required_not_created")
  ));
  assert.ok(events.some((event) =>
    event.eventType === "contract_guidance"
    && event.payload?.required_policy_groups?.includes("artifact_generation")
  ));
});

test("artifact-required tasks do not report success after exhausting invalid artifact tool calls", async () => {
  const { runtime, events } = makeRuntime({
    actionToolRegistry: createActionToolRegistry([makeGenerateDocumentTool()]),
    finalAnswerComposer: async () => "I can describe the document, but no file was created."
  });
  const task = {
    task_id: "task_artifact_invalid_until_exhausted",
    user_command: "生成一份 docx 文档",
    execution_mode: "interactive",
    task_spec: {
      goal: "generate_document",
      artifact: { required: true, kind: "docx", quality: "draft" },
      synthesis: { expected_output: "artifact", user_goal: "generate a document" },
      tool_policy: { web_search_fetch: { mode: "forbidden" } },
      success_contract: {
        artifact_created: true,
        artifact_registered: true,
        tool_called: true,
        required_tool_names: [],
        required_policy_groups: []
      }
    }
  };

  const result = await runToolAgentLoop({
    task,
    runtime,
    planner: async () => ({ type: "tool_call", tool: "generate_document", args: { kind: "docx" } }),
    maxIterations: 2
  });

  assert.equal(result.status, "partial_success");
  assert.ok(result.phase_gate?.violations?.some((violation) =>
    violation.kind === "artifact_required_not_created"
  ));
  assert.equal(
    result.transcript.filter((entry) => entry.type === "validation_error" && entry.tool === "generate_document").length,
    2
  );
  assert.ok(events.some((event) =>
    event.eventType === "contract_finalization_blocked"
    && event.payload?.violation_kinds?.includes("artifact_required_not_created")
  ));
});

test("artifact-required tasks reject a successful artifact with the wrong kind", async () => {
  const { runtime, events } = makeRuntime({
    actionToolRegistry: createActionToolRegistry([makeGenerateDocumentTool()]),
    finalAnswerComposer: async () => "A PDF was generated."
  });
  const task = {
    task_id: "task_artifact_wrong_kind",
    user_command: "生成一份 docx 文档",
    execution_mode: "interactive",
    task_spec: {
      goal: "generate_document",
      artifact: { required: true, kind: "docx", quality: "draft" },
      synthesis: { expected_output: "artifact", user_goal: "generate a document" },
      tool_policy: { web_search_fetch: { mode: "forbidden" } },
      success_contract: {
        artifact_created: true,
        artifact_registered: true,
        tool_called: true,
        required_tool_names: [],
        required_policy_groups: []
      }
    }
  };

  const result = await runToolAgentLoop({
    task,
    runtime,
    planner: async ({ iteration }) => {
      if (iteration === 0) {
        return {
          type: "tool_call",
          tool: "generate_document",
          args: {
            kind: "pdf",
            outline: {
              title: "Wrong Kind",
              sections: [{ heading: "Summary", body: "This is intentionally a PDF." }]
            }
          }
        };
      }
      return { type: "final", text: "done" };
    },
    maxIterations: 3
  });

  assert.equal(result.status, "partial_success");
  assert.ok(result.phase_gate?.violations?.some((violation) =>
    violation.kind === "artifact_required_kind_mismatch"
  ));
  assert.ok(events.some((event) =>
    event.eventType === "contract_finalization_blocked"
    && event.payload?.violation_kinds?.includes("artifact_required_kind_mismatch")
  ));
});

test("phase gate preserves initial artifact contract when current SR patch is incomplete", async () => {
  const { runtime, events } = makeRuntime({
    actionToolRegistry: createActionToolRegistry([
      makeLookupTool(),
      makeGenerateDocumentTool()
    ]),
    finalAnswerComposer: async () => "Generated document body from collected evidence."
  });
  const task = {
    task_id: "task_artifact_initial_contract",
    user_command: "生成一份 docx 文档",
    execution_mode: "interactive",
    task_spec: {
      goal: "qa",
      synthesis: { expected_output: "direct_answer", user_goal: "answer" },
      tool_policy: { web_search_fetch: { mode: "forbidden" } }
    },
    task_spec_initial: {
      goal: "generate_document",
      artifact: { required: true, kind: "docx", quality: "draft" },
      synthesis: { expected_output: "artifact", user_goal: "generate a document" },
      tool_policy: { web_search_fetch: { mode: "forbidden" } },
      success_contract: {
        artifact_created: true,
        artifact_registered: true,
        tool_called: true,
        required_tool_names: [],
        required_policy_groups: []
      }
    }
  };

  const result = await runToolAgentLoop({
    task,
    runtime,
    planner: async ({ transcript, iteration }) => {
      if (iteration === 0) {
        return { type: "tool_call", tool: "lookup_fixture", args: { value: "irrelevant" } };
      }
      const generated = transcript.some((entry) =>
        entry.type === "tool_result"
        && entry.tool === "generate_document"
        && entry.artifact_paths?.length === 1
      );
      if (generated) return { type: "final", text: "done" };
      return { type: "final", text: "Here is prose only." };
    },
    maxIterations: 5
  });

  assert.equal(result.status, "success");
  assert.match(result.final_text, /behavior\.docx/);
  assert.ok(result.transcript.some((entry) =>
    entry.type === "deterministic_artifact_obligation"
    && entry.source === "early_step_gate"
  ));
  assert.ok(events.some((event) =>
    event.eventType === "phase_gate_signal"
    && event.payload?.violation_kinds?.includes("artifact_required_not_created")
  ));
  assert.ok(events.some((event) =>
    event.eventType === "tool_call_proposed"
    && event.payload?.tool_id === "generate_document"
    && event.payload?.source === "deterministic_artifact_obligation"
  ));
});

test("valid repeated tool calls still trigger repeated-call synthesis guidance", async () => {
  const { runtime, events } = makeRuntime({
    finalAnswerComposer: async ({ transcript }) => {
      assert.equal(
        transcript.filter((entry) => entry.type === "tool_result" && entry.tool === "lookup_fixture").length,
        1
      );
      return "deduped final";
    }
  });

  const result = await runToolAgentLoop({
    task: makeTask(),
    runtime,
    planner: async ({ iteration }) => {
      if (iteration === 0 || iteration === 1) {
        return { type: "tool_call", tool: "lookup_fixture", args: { value: "same" } };
      }
      return { type: "final", text: "done" };
    },
    maxIterations: 4
  });

  assert.equal(result.status, "success");
  assert.equal(result.final_text, "deduped final");
  assert.equal(
    result.transcript.filter((entry) => entry.type === "tool_result" && entry.tool === "lookup_fixture").length,
    1
  );
  assert.ok(events.some((event) =>
    event.eventType === "synthesis_retry"
    && event.payload?.reason === "repeated_tool_call"
  ));
});

test("agent loop emits evidence summary for local file reads", async () => {
  const { runtime, events, auditLog } = makeRuntime({
    actionToolRegistry: createActionToolRegistry([makeReadFileTextTool()])
  });
  const task = {
    ...makeTask(),
    task_id: "task_agent_loop_local_evidence",
    user_command: "Summarize the attached file.",
    task_spec: {
      goal: "summarize local file",
      synthesis: { expected_output: "summary", user_goal: "summarize local file" },
      tool_policy: { web_search_fetch: { mode: "forbidden" } }
    }
  };

  const planner = async ({ iteration }) => {
    if (iteration === 0) {
      return { type: "tool_call", tool: "read_file_text", args: { path: "E:\\docs\\resume.md" } };
    }
    return { type: "final", text: "Summarized local evidence." };
  };

  const result = await runToolAgentLoop({
    task,
    runtime,
    planner,
    maxIterations: 3
  });

  assert.equal(result.status, "success");
  assert.equal(result.evidence_summary.local_source_count, 1);
  assert.equal(result.evidence_summary.local_text_source_count, 1);
  assert.equal(result.evidence_summary.local_shallow_source_count, 0);
  assert.equal(result.evidence_summary.local_coverage_scope_counts.single_file_text, 1);
  assert.deepEqual(result.evidence_summary.local_sources, ["E:\\docs\\resume.md"]);
  assert.equal(result.evidence_summary.sources.length, 1);
  assert.equal(result.evidence_summary.sources[0].kind, "file");
  assert.ok(events.some((entry) =>
    entry.eventType === "tool_call_completed"
    && entry.payload?.sources?.[0]?.kind === "file"
    && entry.payload.sources[0].locator === "E:\\docs\\resume.md"
  ));
  assert.ok(events.some((entry) =>
    entry.eventType === "evidence_summary"
    && entry.payload?.local_source_count === 1
  ));
  assert.ok(auditLog.some((entry) =>
    entry.event_subtype === "tool_loop.evidence_summary"
    && entry.payload?.local_source_count === 1
  ));
});

test("agent loop emits shallow file coverage without counting it as content evidence", async () => {
  const { runtime, events, auditLog } = makeRuntime({
    actionToolRegistry: createActionToolRegistry([makeListFilesTool()])
  });
  const task = {
    ...makeTask(),
    task_id: "task_agent_loop_shallow_file_evidence",
    user_command: "List files in this folder.",
    task_spec: {
      goal: "inspect local folder",
      synthesis: { expected_output: "summary", user_goal: "inspect local folder" },
      tool_policy: { web_search_fetch: { mode: "forbidden" } }
    }
  };

  const planner = async ({ iteration }) => {
    if (iteration === 0) {
      return { type: "tool_call", tool: "list_files", args: { dir: "E:\\docs" } };
    }
    return { type: "final", text: "Listed local files." };
  };

  const result = await runToolAgentLoop({
    task,
    runtime,
    planner,
    maxIterations: 3
  });

  assert.equal(result.status, "success");
  assert.equal(result.evidence_summary.local_source_count, 0);
  assert.equal(result.evidence_summary.local_shallow_source_count, 2);
  assert.deepEqual(result.evidence_summary.local_shallow_sources, [
    "E:\\docs\\a.md",
    "E:\\docs\\b.md"
  ]);
  assert.ok(events.some((entry) =>
    entry.eventType === "evidence_summary"
    && entry.payload?.local_shallow_source_count === 2
  ));
  assert.ok(auditLog.some((entry) =>
    entry.event_subtype === "tool_loop.evidence_summary"
    && entry.payload?.local_source_count === 0
    && entry.payload?.local_shallow_source_count === 2
  ));
});

test("attached-file research does not expose open/reveal as file-reading tools", async () => {
  const { runtime } = makeRuntime({
    actionToolRegistry: createActionToolRegistry([
      makeNoopTool("web_search_fetch", { policy_group: "external_web_read" }),
      makeNoopTool("open_file"),
      makeNoopTool("reveal_in_explorer"),
      makeNoopTool("stat_file")
    ])
  });
  const seenToolIds = [];
  const task = {
    task_id: "task_attached_search_no_open",
    user_command: "结合这份材料搜索外部机会",
    execution_mode: "interactive",
    context_packet: {
      file_paths: ["E:\\fixtures\\material.docx"],
      text: "## material.docx\nattached material contents"
    },
    task_spec: {
      goal: "qa",
      synthesis: { expected_output: "summary", user_goal: "external lookup from attached material" },
      tool_policy: {
        policy_groups: { external_web_read: { mode: "optional" } },
        web_search_fetch: { mode: "optional" }
      },
      success_contract: {
        required_tool_names: [],
        required_policy_groups: []
      }
    }
  };

  const result = await runToolAgentLoop({
    task,
    runtime,
    planner: async ({ tools }) => {
      seenToolIds.push(...tools.map((tool) => tool.id));
      assert.ok(tools.some((tool) => tool.id === "web_search_fetch"));
      assert.ok(tools.some((tool) => tool.id === "stat_file"));
      assert.ok(!tools.some((tool) => tool.id === "open_file"));
      assert.ok(!tools.some((tool) => tool.id === "reveal_in_explorer"));
      return { type: "final", text: "done" };
    },
    maxIterations: 1
  });

  assert.equal(result.status, "success");
  assert.ok(seenToolIds.includes("web_search_fetch"));
});

test("hidden direct file-open tools are denied even if a planner hallucinates them", async () => {
  const { runtime, events } = makeRuntime({
    actionToolRegistry: createActionToolRegistry([
      makeNoopTool("web_search_fetch", { policy_group: "external_web_read" }),
      makeNoopTool("open_file"),
      makeNoopTool("stat_file")
    ])
  });
  const task = {
    task_id: "task_attached_search_hallucinated_open",
    user_command: "结合这份材料搜索外部机会",
    execution_mode: "interactive",
    context_packet: {
      file_paths: ["E:\\fixtures\\material.docx"],
      text: "## material.docx\nattached material contents"
    },
    task_spec: {
      goal: "qa",
      synthesis: { expected_output: "summary", user_goal: "external lookup from attached material" },
      tool_policy: {
        policy_groups: { external_web_read: { mode: "optional" } },
        web_search_fetch: { mode: "optional" }
      },
      success_contract: {
        required_tool_names: [],
        required_policy_groups: []
      }
    }
  };
  let calls = 0;

  const result = await runToolAgentLoop({
    task,
    runtime,
    planner: async ({ iteration }) => {
      calls += 1;
      if (iteration === 0) {
        return { type: "tool_call", tool: "open_file", args: { path: "E:\\fixtures\\material.docx" } };
      }
      return { type: "final", text: "I will not open the file." };
    },
    maxIterations: 2
  });

  assert.equal(result.status, "success");
  assert.equal(calls, 2);
  assert.ok(result.transcript.some((entry) =>
    entry.type === "tool_denied"
    && entry.tool === "open_file"
    && entry.reason === "tool_not_available_for_task"
  ));
  assert.ok(!result.transcript.some((entry) => entry.type === "tool_result" && entry.tool === "open_file"));
  assert.ok(events.some((event) =>
    event.eventType === "tool_call_denied"
    && event.payload?.tool_id === "open_file"
    && event.payload?.reason === "tool_not_available_for_task"
  ));
});

test("image-grounded external research can use vision and search tools in one tool loop", async () => {
  const { runtime } = makeRuntime({
    actionToolRegistry: createActionToolRegistry([
      makeNoopTool("vision_analyze"),
      makeNoopTool("web_search_fetch", { policy_group: "external_web_read" })
    ]),
    finalAnswerComposer: async ({ transcript }) => {
      assert.ok(transcript.some((entry) =>
        entry.type === "tool_result"
        && entry.tool === "vision_analyze"
      ));
      assert.ok(transcript.some((entry) =>
        entry.type === "tool_result"
        && entry.tool === "web_search_fetch"
      ));
      return "vision plus search complete";
    }
  });
  const seenToolIds = [];
  const task = {
    task_id: "task_image_external_research",
    user_command: "结合这张产品图搜索外部竞品",
    execution_mode: "interactive",
    context_packet: {
      image_paths: ["E:\\fixtures\\product.png"],
      semantic_router_decision: {
        needed_capabilities: ["image_understanding", "external_web_read"]
      }
    },
    task_spec: {
      goal: "multimodal_analyze",
      synthesis: { expected_output: "summary", user_goal: "image-grounded external research" },
      tool_policy: {
        policy_groups: { external_web_read: { mode: "required" } },
        web_search_fetch: { mode: "required" }
      },
      success_contract: {
        required_tool_names: [],
        required_policy_groups: ["external_web_read"]
      }
    }
  };

  const result = await runToolAgentLoop({
    task,
    runtime,
    planner: async ({ tools, iteration }) => {
      seenToolIds.push(...tools.map((tool) => tool.id));
      assert.ok(tools.some((tool) => tool.id === "vision_analyze"));
      assert.ok(tools.some((tool) => tool.id === "web_search_fetch"));
      if (iteration === 0) {
        return { type: "tool_call", tool: "vision_analyze", args: { image_paths: ["E:\\fixtures\\product.png"] } };
      }
      if (iteration === 1) {
        return { type: "tool_call", tool: "web_search_fetch", args: { query: "competitors from product image" } };
      }
      return { type: "final", text: "done" };
    },
    maxIterations: 4
  });

  assert.equal(result.status, "success");
  assert.equal(result.final_text, "vision plus search complete");
  assert.ok(seenToolIds.includes("vision_analyze"));
  assert.ok(seenToolIds.includes("web_search_fetch"));
});

test("explicit file-open tasks still expose open_file", async () => {
  const { runtime } = makeRuntime({
    actionToolRegistry: createActionToolRegistry([
      makeNoopTool("open_file"),
      makeNoopTool("stat_file")
    ])
  });
  const task = {
    task_id: "task_explicit_file_open",
    user_command: "打开这个文件",
    execution_mode: "interactive",
    context_packet: {
      file_paths: ["E:\\fixtures\\material.docx"]
    },
    task_spec: {
      goal: "open_or_reveal_file",
      synthesis: { expected_output: "execution", user_goal: "open file" },
      tool_policy: { web_search_fetch: { mode: "forbidden" } },
      success_contract: {
        required_tool_names: [],
        required_policy_groups: []
      }
    }
  };

  const result = await runToolAgentLoop({
    task,
    runtime,
    planner: async ({ tools }) => {
      assert.ok(tools.some((tool) => tool.id === "open_file"));
      return { type: "final", text: "ready" };
    },
    maxIterations: 1
  });

  assert.equal(result.status, "success");
});

test("agent loop falls back to collected tool results when final composition throws", async () => {
  const { runtime } = makeRuntime({
    finalAnswerComposer: async () => {
      throw new Error("fake composer timeout");
    }
  });

  const planner = async ({ transcript, iteration }) => {
    if (iteration === 0) {
      return { type: "tool_call", tool: "lookup_fixture", args: { value: "beta" } };
    }
    assert.ok(transcript.some((entry) => entry.observation === "observed:beta"));
    return { type: "final", text: "Planner final after tool." };
  };

  const result = await runToolAgentLoop({
    task: makeTask(),
    runtime,
    planner,
    maxIterations: 3
  });

  assert.equal(result.status, "success");
  assert.match(result.final_text, /observed:beta/);
  assert.ok(!/fake composer timeout/.test(result.final_text));
});

test("compound launch task is execution-only, not an artifact request", () => {
  const spec = createTaskSpec("打开 AlphaApp、BetaApp 和 GammaApp", {});

  assert.equal(spec.goal, "launch_and_act");
  assert.equal(spec.artifact.required, false);
  assert.ok(!spec.required_steps.includes("generate_artifact"));
  assert.ok(spec.success_contract.required_tool_names.includes("launch_app"));
});

test("compound launch continues remaining independent targets after one target fails", async () => {
  const launched = [];
  const launchTool = {
    id: "launch_app",
    name: "Launch App",
    description: "Launch app",
    risk_level: "medium",
    requires_confirmation: false,
    parameters: {
      type: "object",
      required: ["app"],
      properties: { app: { type: "string" } }
    },
    async execute(args = {}) {
      launched.push(args.app);
      if (args.app === "AlphaApp") {
        return { success: false, observation: "AlphaApp has multiple matching launch candidates." };
      }
      return { success: true, observation: `Launched ${args.app}` };
    }
  };
  const { runtime, events } = makeRuntime({
    actionToolRegistry: createActionToolRegistry([launchTool])
  });
  const task = {
    task_id: "task_compound_launch",
    user_command: "打开 AlphaApp、BetaApp 和 GammaApp",
    execution_mode: "interactive",
    task_spec: {
      goal: "launch_and_act",
      synthesis: { expected_output: "execution", user_goal: "open several apps" },
      tool_policy: { web_search_fetch: { mode: "forbidden" } },
      success_contract: {
        required_tool_names: ["launch_app"],
        required_policy_groups: [],
        tool_called: true
      }
    }
  };

  const planner = async ({ transcript, iteration }) => {
    if (iteration === 0) {
      return { type: "tool_call", tool: "launch_app", args: { app: "AlphaApp" } };
    }
    const guidance = [...transcript].reverse().find((entry) =>
      entry.type === "contract_guidance"
      && /Remaining targets/.test(entry.instruction ?? "")
    );
    if (guidance?.instruction?.includes("BetaApp")) {
      return { type: "tool_call", tool: "launch_app", args: { app: "BetaApp" } };
    }
    if (guidance?.instruction?.includes("GammaApp")) {
      return { type: "tool_call", tool: "launch_app", args: { app: "GammaApp" } };
    }
    return { type: "final", text: "I cannot operate your computer." };
  };

  const result = await runToolAgentLoop({
    task,
    runtime,
    planner,
    maxIterations: 6
  });

  assert.deepEqual(launched, ["AlphaApp", "BetaApp", "GammaApp"]);
  assert.equal(result.status, "partial_success");
  assert.match(result.final_text, /AlphaApp/);
  assert.match(result.final_text, /BetaApp/);
  assert.match(result.final_text, /GammaApp/);
  assert.match(result.final_text, /成功|已打开|已启动|successfully|launched/i);
  assert.ok(!/Launched BetaApp|Launched GammaApp/.test(result.final_text));
  assert.ok(!/cannot operate your computer/i.test(result.final_text));
  assert.ok(events.some((event) =>
    event.eventType === "contract_action_handoff"
    && event.payload?.source === "launch_sequence"
  ));
});

test("launch ambiguity final answer asks for disambiguation from structured candidates", async () => {
  const launchTool = {
    id: "launch_app",
    name: "Launch App",
    description: "Launch app",
    risk_level: "medium",
    requires_confirmation: false,
    parameters: {
      type: "object",
      required: ["app"],
      properties: { app: { type: "string" } }
    },
    async execute(args = {}) {
      return createLaunchAmbiguityResult(args.app, [
        {
          app_id: "alpha.desktop",
          display_name: "Alpha Desktop",
          exe_path: "C:\\Apps\\Alpha\\alpha.exe",
          is_dev_tool: false
        },
        {
          app_id: "alpha.tools",
          display_name: "Alpha Tools",
          exe_path: "C:\\Apps\\AlphaTools\\alpha-tools.exe",
          is_dev_tool: true
        }
      ]);
    }
  };
  const { runtime } = makeRuntime({
    actionToolRegistry: createActionToolRegistry([launchTool])
  });
  const task = {
    task_id: "task_launch_disambiguation",
    user_command: "打开 Alpha",
    execution_mode: "interactive",
    task_spec: {
      goal: "launch_and_act",
      synthesis: { expected_output: "execution", user_goal: "open app" },
      tool_policy: { web_search_fetch: { mode: "forbidden" } },
      success_contract: {
        required_tool_names: ["launch_app"],
        required_policy_groups: [],
        tool_called: true
      }
    }
  };

  const planner = async ({ iteration }) => {
    if (iteration === 0) {
      return { type: "tool_call", tool: "launch_app", args: { app: "Alpha" } };
    }
    return { type: "final", text: "I cannot operate your computer." };
  };

  const result = await runToolAgentLoop({
    task,
    runtime,
    planner,
    maxIterations: 3
  });

  assert.equal(result.status, "partial_success");
  assert.match(result.final_text, /哪一个|哪个|which/i);
  assert.match(result.final_text, /Alpha Desktop/);
  assert.match(result.final_text, /Alpha Tools/);
  assert.ok(!/cannot operate your computer/i.test(result.final_text));
  assert.ok(!/launch_args/.test(result.final_text));
});

test("tool_using loop passes cancellation signal to planner and action tools", async () => {
  const controller = new AbortController();
  let plannerSignal = null;
  let toolSignal = null;
  const signalAwareTool = {
    id: "lookup_fixture",
    name: "Lookup Fixture",
    description: "Returns a deterministic observation for behavior tests.",
    risk_level: "low",
    requires_confirmation: false,
    parameters: {
      type: "object",
      required: ["value"],
      properties: { value: { type: "string" } }
    },
    async execute(args, context = {}) {
      toolSignal = context.signal ?? null;
      return {
        success: true,
        observation: `observed:${args.value}`,
        metadata: { source: "behavior-test" }
      };
    }
  };
  const { runtime } = makeRuntime({
    actionToolRegistry: createActionToolRegistry([signalAwareTool])
  });
  const task = makeTask();
  const planner = async ({ iteration, signal }) => {
    plannerSignal = signal ?? null;
    if (iteration === 0) {
      return { type: "tool_call", tool: "lookup_fixture", args: { value: "cancel-aware" } };
    }
    return { type: "final", text: "done" };
  };

  const result = await runToolAgentLoop({
    task,
    runtime,
    planner,
    maxIterations: 2,
    signal: controller.signal
  });

  assert.equal(result.status, "success");
  assert.equal(plannerSignal, controller.signal);
  assert.equal(toolSignal, controller.signal);
});

test("tool_using loop rejects before planner work when already aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  const { runtime } = makeRuntime();
  const task = makeTask();
  let plannerCalled = false;

  await assert.rejects(
    () => runToolAgentLoop({
      task,
      runtime,
      signal: controller.signal,
      planner: async () => {
        plannerCalled = true;
        return { type: "final", text: "should not run" };
      }
    }),
    (error) => error?.code === "ABORT_ERR"
  );
  assert.equal(plannerCalled, false);
});
