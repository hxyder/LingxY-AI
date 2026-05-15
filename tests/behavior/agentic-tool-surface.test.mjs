import assert from "node:assert/strict";
import test from "node:test";

import {
  filterToolsForAgenticTask,
  isScheduleRegistryTool,
  isScheduledFireTask,
  isSideEffectTool,
  taskNeedsCurrentWebData,
  toolDescriptorForAdapter,
  transcriptHasSuccessfulToolCall
} from "../../src/service/executors/agentic/tool-surface.mjs";
import { buildAgenticSystemPrompt as renderAgenticSystemPrompt } from "../../src/service/executors/agentic/prompt-builder.mjs";
import { BUILTIN_ACTION_TOOLS } from "../../src/service/action_tools/tools/index.mjs";

test("agentic tool surface renders adapter descriptors with safe defaults", () => {
  assert.deepEqual(
    toolDescriptorForAdapter({ id: "lookup", name: "Lookup", description: "Search", parameters: { type: "object" } }),
    { name: "lookup", description: "Search", input_schema: { type: "object" } }
  );
  assert.deepEqual(
    toolDescriptorForAdapter({ id: "empty" }),
    { name: "empty", description: "", input_schema: { type: "object", properties: {} } }
  );
});

test("agentic tool surface detects current-web preflight needs", () => {
  assert.equal(taskNeedsCurrentWebData({ task_spec: { needs_current_web_data: true } }), true);
  assert.equal(
    taskNeedsCurrentWebData({ task_spec: { success_contract: { required_tool_names: ["web_search_fetch"] } } }),
    true
  );
  assert.equal(taskNeedsCurrentWebData({ task_spec: { success_contract: { required_tool_names: [] } } }), false);
});

test("agentic tool surface detects scheduled-fire context and registry tools", () => {
  assert.equal(isScheduledFireTask({ context_packet: { selection_metadata: { scheduled_task_fire: true } } }), true);
  assert.equal(isScheduledFireTask({ context_packet: { selection_metadata: {} } }), false);
  assert.equal(isScheduleRegistryTool("create_scheduled_task"), true);
  assert.equal(isScheduleRegistryTool({ id: "mcp_scheduler__create", _mcpToolName: "delete_scheduled_task" }), true);
  assert.equal(isScheduleRegistryTool({ id: "notify" }), false);
});

test("agentic tool surface classifies side-effect tools by group, risk, and confirmation", () => {
  assert.equal(isSideEffectTool({ id: "account_send_email" }), true);
  assert.equal(isSideEffectTool({ id: "custom_event", policy_group: "calendar_create" }), true);
  assert.equal(isSideEffectTool({ id: "custom_upload", policy_groups: ["file_upload"] }), true);
  assert.equal(isSideEffectTool({ id: "dangerous", risk_level: "high" }), true);
  assert.equal(isSideEffectTool({ id: "approval_tool", requires_confirmation: true }), true);
  assert.equal(isSideEffectTool({ id: "read_only" }), false);
  assert.equal(isSideEffectTool(null), false);
});

test("agentic dynamic tool descriptors include capability management tools", () => {
  const ids = new Set(BUILTIN_ACTION_TOOLS.map((tool) => tool.id));
  assert.ok(ids.has("draft_capability"));
  assert.ok(ids.has("save_capability_draft"));

  const draft = BUILTIN_ACTION_TOOLS.find((tool) => tool.id === "draft_capability");
  const save = BUILTIN_ACTION_TOOLS.find((tool) => tool.id === "save_capability_draft");
  const draftDescriptor = toolDescriptorForAdapter(draft);
  const saveDescriptor = toolDescriptorForAdapter(save);

  assert.equal(draftDescriptor.name, "draft_capability");
  assert.equal(typeof draftDescriptor.description, "string");
  assert.ok(draftDescriptor.input_schema && typeof draftDescriptor.input_schema === "object");
  assert.equal(saveDescriptor.name, "save_capability_draft");
  assert.ok(saveDescriptor.input_schema && typeof saveDescriptor.input_schema === "object");
});

test("agentic prompt renders xlsx as a structured spreadsheet contract", () => {
  const prompt = renderAgenticSystemPrompt({
    tools: [{ id: "generate_document", name: "Generate Document", description: "fixture", parameters: { type: "object" } }],
    task: {
      user_command: "给我生成 excel 表的格式",
      task_spec: {
        artifact: { required: true, kind: "xlsx" },
        success_contract: { required_tool_names: ["generate_document"] }
      }
    },
    requestedFormat: { id: "xlsx" },
    language: "zh-CN"
  });

  assert.match(prompt, /XLSX artifact/);
  assert.match(prompt, /headers: \[\.\.\.\], rows: \[\.\.\.\]/);
  assert.match(prompt, /Never turn narrative prose/);
  assert.match(prompt, /generic `Content` column/);
});

test("agentic tool surface preserves artifact writers for typed artifact contracts", () => {
  const visible = filterToolsForAgenticTask(BUILTIN_ACTION_TOOLS, {
    user_command: "读取会议纪要，提取 owner、goal、follow-up。",
    task_spec: {
      artifact: { required: true, kind: "md" },
      success_contract: { artifact_created: true }
    }
  }).map((tool) => tool.id);

  assert.ok(visible.includes("write_file"));
  assert.ok(visible.includes("generate_document"));
  assert.ok(visible.includes("resolve_output_path"));
});

test("agentic tool surface does not infer artifact writers from raw text without TaskSpec", () => {
  const visible = filterToolsForAgenticTask(BUILTIN_ACTION_TOOLS, {
    user_command: "读取附件并生成 markdown 报告文件。",
    task_spec: {}
  }).map((tool) => tool.id);

  assert.ok(!visible.includes("write_file"));
  assert.ok(!visible.includes("generate_document"));
  assert.ok(!visible.includes("resolve_output_path"));
});

test("agentic typed artifact_generation capability is not vetoed by live text heuristics", () => {
  const visible = filterToolsForAgenticTask(BUILTIN_ACTION_TOOLS, {
    user_command: "继续处理这个",
    context_packet: {
      semantic_router_decision: {
        needed_capabilities: ["artifact_generation"],
        artifact_required: true,
        expected_output: "artifact"
      }
    },
    task_spec: {}
  }).map((tool) => tool.id);

  assert.ok(visible.includes("write_file"));
  assert.ok(visible.includes("generate_document"));
  assert.ok(visible.includes("resolve_output_path"));
});

test("agentic tool surface keeps connector-scoped searches out of generic web search", () => {
  const visible = filterToolsForAgenticTask(BUILTIN_ACTION_TOOLS, {
    user_command: "搜索云盘里文件名包含 audit 的文档，只列出名称。",
    task_spec: {}
  }).map((tool) => tool.id);

  assert.ok(!visible.includes("web_search_fetch"));
  assert.ok(visible.includes("connector_workflow_run"));
});

test("agentic tool surface keeps web tools for degraded side-effect routing and hides unrequested run_script", () => {
  const visible = filterToolsForAgenticTask(BUILTIN_ACTION_TOOLS, {
    user_command: "收集最新信息并发送邮件到 a@example.com",
    task_spec: {
      routing_degraded: true,
      success_contract: { required_policy_groups: ["email_send"] }
    }
  }).map((tool) => tool.id);

  assert.ok(visible.includes("web_search_fetch"));
  assert.ok(visible.includes("connector_workflow_run"));
  assert.ok(!visible.includes("run_script"));
  assert.ok(!visible.includes("vision_analyze"));
  assert.ok(!visible.includes("file_op"));
});

test("agentic tool surface exposes run_script only for explicit code execution", () => {
  const visible = filterToolsForAgenticTask(BUILTIN_ACTION_TOOLS, {
    user_command: "用 Node.js 执行脚本检查生成文件。",
    task_spec: {}
  }).map((tool) => tool.id);

  assert.ok(visible.includes("run_script"));
});

test("agentic tool surface only counts successful prior tool calls", () => {
  const transcript = [
    { role: "tool", name: "send_email_smtp", success: false },
    { role: "tool", name: "account_upload_file", success: true },
    { role: "assistant", name: "send_email_smtp", success: true }
  ];
  assert.equal(transcriptHasSuccessfulToolCall(transcript, "send_email_smtp"), false);
  assert.equal(transcriptHasSuccessfulToolCall(transcript, "account_upload_file"), true);
  assert.equal(transcriptHasSuccessfulToolCall(transcript, null), false);
});
