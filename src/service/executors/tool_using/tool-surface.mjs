function semanticDecisionOf(task) {
  return task?.context_packet?.semantic_router_decision ?? null;
}

export function neededCapabilitiesOf(task) {
  const decision = semanticDecisionOf(task);
  return Array.isArray(decision?.needed_capabilities)
    ? decision.needed_capabilities.filter((value) => typeof value === "string" && value.trim())
    : [];
}

const CAPABILITY_TOOL_MATCHERS = Object.freeze({
  external_web_read: (tool) =>
    tool.policy_group === "external_web_read"
    || ["web_search", "web_search_fetch", "fetch_url_content", "open_url"].includes(tool.id),
  file_read: (tool) =>
    /^(list_files|glob_files|find_recent_files|get_latest_artifact|stat_file|read_file_text|read_folder_text|search_file_content|index_file_content|verify_file_exists|file_op)$/.test(tool.id),
  artifact_generation: (tool) =>
    /^(write_file|generate_document|edit_file|render_diagram|resolve_output_path|register_artifact|verify_file_exists)$/.test(tool.id),
  code_execution: (tool) => tool.id === "run_script",
  browser_control: (tool) => ["open_url", "take_screenshot"].includes(tool.id),
  email_calendar_action: (tool) =>
    /^(compose_email|send_email_smtp|account_|connector_)/.test(tool.id),
  desktop_action: (tool) =>
    /^(launch_app|gui_|open_file|reveal_in_explorer|copy_to_clipboard|notify|read_clipboard)/.test(tool.id),
  // vision_analyze is the tool-backed specialist for image
  // understanding. Without this match the IntentRoute filter would
  // strip it whenever needed_capabilities=["image_understanding"],
  // which is the path image-bearing tasks take when they reach
  // tool_using instead of multi_modal.
  image_understanding: (tool) => tool.id === "vision_analyze",
  image_generation: (tool) => ["generate_document", "write_file"].includes(tool.id),
  none: () => false
});

// UCA-181 follow-up: tools that create / mutate the schedule registry.
// Hiding them from the planner when the task is itself a scheduler fire
// prevents the LLM from re-interpreting the fired userCommand
// ("提醒用户交 timecard") as another schedule request and re-emitting
// create_scheduled_task, which then surfaces a needless approval popup
// before the tool's own recursion guard would refuse it.
const SCHEDULE_REGISTRY_TOOL_IDS = new Set([
  "create_scheduled_task",
  "delete_scheduled_task",
  "pause_scheduled_task"
]);

const DIRECT_FILE_OPEN_TOOL_IDS = new Set(["open_file", "reveal_in_explorer"]);

export function isScheduledFireTask(task) {
  return task?.context_packet?.selection_metadata?.scheduled_task_fire === true;
}

export function isScheduleRegistryTool(toolOrId) {
  const id = typeof toolOrId === "string" ? toolOrId : toolOrId?.id;
  return SCHEDULE_REGISTRY_TOOL_IDS.has(id);
}

function taskAllowsDirectFileOpen(task) {
  const spec = task?.task_spec ?? task?.task_spec_initial ?? {};
  if (spec.goal === "open_or_reveal_file") return true;
  const requiredTools = Array.isArray(spec.success_contract?.required_tool_names)
    ? spec.success_contract.required_tool_names
    : [];
  if (requiredTools.some((toolId) => DIRECT_FILE_OPEN_TOOL_IDS.has(toolId))) return true;
  const requiredSteps = Array.isArray(spec.required_steps) ? spec.required_steps : [];
  return requiredSteps.some((step) => DIRECT_FILE_OPEN_TOOL_IDS.has(step));
}

function filterDirectFileOpenTools(list = [], task) {
  if (taskAllowsDirectFileOpen(task)) return list;
  return list.filter((tool) => !DIRECT_FILE_OPEN_TOOL_IDS.has(tool.id));
}

export function filterToolsForTask(tools = [], task) {
  const insideScheduledFire = isScheduledFireTask(task);
  const stripTaskScopedTools = (list) => {
    const withoutDirectOpen = filterDirectFileOpenTools(list, task);
    return insideScheduledFire
      ? withoutDirectOpen.filter((tool) => !isScheduleRegistryTool(tool))
      : withoutDirectOpen;
  };

  const capabilities = neededCapabilitiesOf(task).filter((capability) => capability !== "none");
  if (capabilities.length === 0) return stripTaskScopedTools(tools);
  const filtered = tools.filter((tool) => capabilities.some((capability) => {
    const matcher = CAPABILITY_TOOL_MATCHERS[capability];
    return typeof matcher === "function" ? matcher(tool) : false;
  }));
  return stripTaskScopedTools(filtered.length > 0 ? filtered : tools);
}

export function shouldRenderWorkflowHint(task) {
  const capabilities = neededCapabilitiesOf(task);
  if (task?.task_spec?.connector_domain === true) return true;
  if (capabilities.includes("email_calendar_action")) return true;
  if (Array.isArray(task?.task_spec?.intent_tags) && task.task_spec.intent_tags.includes("connector")) return true;
  return false;
}
