import assert from "node:assert/strict";
import test from "node:test";

import {
  isScheduleRegistryTool,
  isScheduledFireTask,
  isSideEffectTool,
  taskNeedsCurrentWebData,
  toolDescriptorForAdapter,
  transcriptHasSuccessfulToolCall
} from "../../src/service/executors/agentic/tool-surface.mjs";
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
