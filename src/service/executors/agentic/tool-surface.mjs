import { groupsOfTool } from "../../core/policy/policy-groups.mjs";

const SCHEDULE_REGISTRY_TOOL_IDS = new Set([
  "create_scheduled_task",
  "delete_scheduled_task",
  "pause_scheduled_task"
]);

const SIDE_EFFECT_OBLIGATION_GROUPS = new Set([
  "email_send",
  "calendar_create",
  "file_upload",
  "schedule_create"
]);

export function toolDescriptorForAdapter(tool) {
  return {
    name: tool.id,
    description: tool.description ?? tool.name ?? "",
    input_schema: tool.parameters ?? { type: "object", properties: {} }
  };
}

export function taskNeedsCurrentWebData(task) {
  return Boolean(task?.task_spec?.needs_current_web_data)
    || task?.task_spec?.success_contract?.required_tool_names?.includes?.("web_search_fetch");
}

export function isScheduledFireTask(task) {
  return task?.context_packet?.selection_metadata?.scheduled_task_fire === true;
}

export function isScheduleRegistryTool(tool) {
  const id = typeof tool === "string" ? tool : tool?.id;
  const mcpToolName = typeof tool === "object" ? tool?._mcpToolName : null;
  return SCHEDULE_REGISTRY_TOOL_IDS.has(id) || SCHEDULE_REGISTRY_TOOL_IDS.has(mcpToolName);
}

export function isSideEffectTool(tool) {
  if (!tool) return false;
  const groupSet = new Set(groupsOfTool(tool.id));
  if (typeof tool.policy_group === "string") groupSet.add(tool.policy_group);
  if (Array.isArray(tool.policy_groups)) {
    for (const group of tool.policy_groups) {
      if (typeof group === "string") groupSet.add(group);
    }
  }
  for (const group of groupSet) {
    if (SIDE_EFFECT_OBLIGATION_GROUPS.has(group)) return true;
  }
  return tool.risk_level === "high" || tool.requires_confirmation === true;
}

export function transcriptHasSuccessfulToolCall(transcript = [], toolId) {
  if (!toolId) return false;
  return (transcript ?? []).some((entry) =>
    entry?.role === "tool"
    && entry.name === toolId
    && entry.success === true
  );
}
