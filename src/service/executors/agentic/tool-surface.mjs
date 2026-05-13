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

const ARTIFACT_TOOL_IDS = new Set([
  "write_file",
  "generate_document",
  "edit_file",
  "render_diagram",
  "render_svg",
  "resolve_output_path",
  "register_artifact",
  "verify_file_exists"
]);

const EXTERNAL_WEB_READ_TOOL_IDS = new Set([
  "web_search",
  "web_search_fetch",
  "fetch_url_content"
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

function liveUserIntentSources(task) {
  const sources = [];
  if (typeof task?.user_command === "string" && task.user_command.trim()) {
    sources.push(task.user_command);
  }
  const cp = task?.context_packet;
  if (typeof cp?.user_command === "string" && cp.user_command.trim()) {
    sources.push(cp.user_command);
  }
  const spec = task?.task_spec ?? task?.task_spec_initial;
  if (typeof spec?.user_goal_text === "string" && spec.user_goal_text.trim()) {
    sources.push(spec.user_goal_text);
  }
  return sources;
}

function requiredPolicyGroupsOf(task) {
  const groups = [];
  for (const spec of [task?.task_spec, task?.task_spec_initial]) {
    const required = spec?.success_contract?.required_policy_groups;
    if (!Array.isArray(required)) continue;
    groups.push(...required.filter((group) => typeof group === "string" && group.trim()));
  }
  return [...new Set(groups)];
}

function semanticDecisionOf(task) {
  return task?.context_packet?.semantic_router_decision ?? null;
}

function neededCapabilitiesOf(task) {
  const decision = semanticDecisionOf(task);
  return Array.isArray(decision?.needed_capabilities)
    ? decision.needed_capabilities.filter((value) => typeof value === "string" && value.trim())
    : [];
}

function taskRequiresArtifactTools(task) {
  const specs = [task?.task_spec, task?.task_spec_initial];
  return specs.some((spec) =>
    spec?.artifact?.required === true
    || spec?.success_contract?.artifact_created === true
    || spec?.contract?.output_contract?.artifact_required === true
  );
}

function taskHasTypedArtifactCapability(task) {
  const capabilities = neededCapabilitiesOf(task);
  if (capabilities.includes("artifact_generation")) return true;
  const decision = semanticDecisionOf(task);
  if (decision?.artifact_required === true) return true;
  if (decision?.expected_output === "artifact") return true;
  return requiredPolicyGroupsOf(task).includes("artifact_generation");
}

function taskAllowsArtifactTools(task) {
  return taskRequiresArtifactTools(task) || taskHasTypedArtifactCapability(task);
}

const CONNECTOR_SCOPE_RE = /(云盘|网盘|邮箱|邮件|日历|收件箱|google\s*drive|gmail|calendar|onedrive|outlook)/iu;
const INTERNET_SCOPE_RE = /(互联网|联网|网页|网站|站点|浏览器|web|internet|online|browser)/iu;

function userCommandIsConnectorScoped(task) {
  return liveUserIntentSources(task).some((text) =>
    CONNECTOR_SCOPE_RE.test(text) && !INTERNET_SCOPE_RE.test(text)
  );
}

export function filterToolsForAgenticTask(tools = [], task) {
  const allowArtifacts = taskAllowsArtifactTools(task);
  const connectorScoped = userCommandIsConnectorScoped(task);
  return tools.filter((tool) => {
    if (!tool?.id) return false;
    if (!allowArtifacts && ARTIFACT_TOOL_IDS.has(tool.id)) return false;
    if (connectorScoped && EXTERNAL_WEB_READ_TOOL_IDS.has(tool.id)) return false;
    return true;
  });
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
