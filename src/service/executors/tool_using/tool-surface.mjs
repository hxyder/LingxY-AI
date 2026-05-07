import { toolsInGroup } from "../../core/policy/policy-groups.mjs";
import { commandTargetsCurrentBrowserContext } from "../../../shared/current-context-intent.mjs";

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
  // open_url intentionally NOT listed here: the contract validator only
  // counts actual web fetchers (web_search / web_search_fetch /
  // fetch_url_content) as satisfying external_web_read. Listing open_url
  // here misled the LLM planner into picking it for research-class
  // queries, after which the success contract still failed and the task
  // ended in partial_success with Google.com uselessly opened (see
  // task_f90251bc, 2026-05-06). open_url remains exposed as a
  // browser_control capability for explicit "打开 URL" commands.
  external_web_read: (tool) =>
    tool.policy_group === "external_web_read"
    || ["web_search", "web_search_fetch", "fetch_url_content"].includes(tool.id),
  file_read: (tool) =>
    /^(list_files|glob_files|find_recent_files|get_latest_artifact|stat_file|read_file_text|read_folder_text|search_file_content|index_file_content|verify_file_exists|file_op)$/.test(tool.id),
  // B2-a (b) round-1 codex catch: verify_file_exists is a *verifier*,
  // not a producer. Removed from artifact_generation so the policy
  // group and capability matcher agree (single source of truth).
  artifact_generation: (tool) =>
    /^(write_file|generate_document|edit_file|render_diagram|render_svg|resolve_output_path|register_artifact)$/.test(tool.id),
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
  image_generation: (tool) => ["generate_document", "write_file", "render_svg", "render_diagram"].includes(tool.id),
  // First-class lane for the "create / configure a capability" intent.
  // Exposes the draft + save tools so the planner can run the interview
  // and persist the result without per-case keyword routing.
  capability_management: (tool) =>
    ["draft_capability", "save_capability_draft"].includes(tool.id),
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

// B2-a (a): open_url is "interactive browse / navigate", NOT "fetch
// page content". The LLM regularly conflated the two and emitted
// open_url for queries like "send me the link for X" or
// "https://example.com" alone, leaving content-fetch obligations
// unmet. Hide open_url by default; only expose when the user
// explicitly asked the runtime to *navigate* somewhere.
const OPEN_URL_TOOL_ID = "open_url";

const OPEN_URL_VERB_RE = /(打开|访问|进入|跳转|浏览|前往|登录到|登录上)|\bopen\b|\bvisit\b|\bnavigate\b|\bgo\s+to\b|\bload\s+(this\s+page|that\s+page|the\s+url)\b/iu;

// Permissive TLD coverage (codex round-1: original list missed .gov,
// .edu, .gov.uk, .ac.jp etc.). Match http(s) URLs explicitly, OR any
// `domain.<2+letters>` with up to one nested suffix (so service.gov.uk
// and api.example.co.jp work). The trailing /\S* is optional path.
const URL_OR_DOMAIN_RE = /(?:https?:\/\/\S+)|(?:\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\.[a-z]{2,})?\b(?:\/\S*)?)/iu;

// Live-user-intent sources only. We do NOT join with context_packet.text
// or background_contexts[] — those carry synthetic URLs and prior page
// metadata which would otherwise let a background URL + a foreground
// verb falsely re-expose open_url (codex round-1 regression note).
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

function userExplicitlyAskedToOpenUrl(task) {
  // URL+verb must co-occur in the *same* source — protects against
  // background-context URL + live-prompt verb bleed.
  for (const text of liveUserIntentSources(task)) {
    if (URL_OR_DOMAIN_RE.test(text) && OPEN_URL_VERB_RE.test(text)) {
      return true;
    }
  }
  // Legit "open the page I'm currently browsing" path: clipboard or
  // active-window probe surfaced a URL via context_packet.url AND
  // the user's live command references the current browser context
  // ("打开当前页面 / 这个页面 / open this page / current tab"). Both
  // halves required so a generic "open calculator" while a stale
  // browser URL is in the packet does NOT unlock open_url
  // (codex round-2 catch).
  const cpUrl = task?.context_packet?.url;
  if (typeof cpUrl === "string" && cpUrl.trim()) {
    for (const text of liveUserIntentSources(task)) {
      if (OPEN_URL_VERB_RE.test(text) && commandTargetsCurrentBrowserContext(text)) {
        return true;
      }
    }
  }
  return false;
}

function taskRequiresOpenUrlExplicitly(task) {
  const spec = task?.task_spec ?? task?.task_spec_initial;
  if (!spec) return false;
  const requiredTools = spec.success_contract?.required_tool_names;
  if (Array.isArray(requiredTools) && requiredTools.includes(OPEN_URL_TOOL_ID)) {
    return true;
  }
  const requiredSteps = Array.isArray(spec.required_steps) ? spec.required_steps : [];
  return requiredSteps.includes(OPEN_URL_TOOL_ID);
}

export function shouldExposeOpenUrl(task) {
  return userExplicitlyAskedToOpenUrl(task) || taskRequiresOpenUrlExplicitly(task);
}

function filterOpenUrl(list = [], task) {
  if (shouldExposeOpenUrl(task)) return list;
  return list.filter((tool) => tool?.id !== OPEN_URL_TOOL_ID);
}

// Mirrors POLICY_GROUPS.artifact_generation in
// src/service/core/policy/policy-groups.mjs — verify_file_exists used
// to be here but is a verifier, not a producer (codex round-1 catch).
const ARTIFACT_TOOL_IDS = new Set([
  "write_file",
  "generate_document",
  "edit_file",
  "render_diagram",
  "render_svg",
  "resolve_output_path",
  "register_artifact"
]);

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

function requiredPolicyGroupsOf(task) {
  const groups = [];
  for (const spec of [task?.task_spec, task?.task_spec_initial]) {
    const required = spec?.success_contract?.required_policy_groups;
    if (!Array.isArray(required)) continue;
    groups.push(...required.filter((group) => typeof group === "string" && group.trim()));
  }
  return [...new Set(groups)];
}

function toolSatisfiesRequiredPolicyGroup(tool, groups = []) {
  if (!tool?.id) return false;
  return groups.some((group) =>
    tool.policy_group === group || toolsInGroup(group).includes(tool.id)
  );
}

function mergeToolLists(primary = [], extra = []) {
  const seen = new Set();
  const merged = [];
  for (const tool of [...primary, ...extra]) {
    if (!tool?.id || seen.has(tool.id)) continue;
    seen.add(tool.id);
    merged.push(tool);
  }
  return merged;
}

function taskRequiresArtifactTools(task) {
  const specs = [task?.task_spec, task?.task_spec_initial];
  return specs.some((spec) =>
    spec?.artifact?.required === true
    || spec?.success_contract?.artifact_created === true
    || spec?.contract?.output_contract?.artifact_required === true
  );
}

function artifactToolsFrom(tools = []) {
  return tools.filter((tool) => ARTIFACT_TOOL_IDS.has(tool.id));
}

export function filterToolsForTask(tools = [], task) {
  const insideScheduledFire = isScheduledFireTask(task);
  const stripTaskScopedTools = (list) => {
    const withoutDirectOpen = filterDirectFileOpenTools(list, task);
    const withoutOpenUrl = filterOpenUrl(withoutDirectOpen, task);
    return insideScheduledFire
      ? withoutOpenUrl.filter((tool) => !isScheduleRegistryTool(tool))
      : withoutOpenUrl;
  };

  const capabilities = neededCapabilitiesOf(task).filter((capability) => capability !== "none");
  if (capabilities.length === 0) return stripTaskScopedTools(tools);
  const filtered = tools.filter((tool) => capabilities.some((capability) => {
    const matcher = CAPABILITY_TOOL_MATCHERS[capability];
    return typeof matcher === "function" ? matcher(tool) : false;
  }));
  const requiredGroups = requiredPolicyGroupsOf(task);
  const requiredTools = tools.filter((tool) => toolSatisfiesRequiredPolicyGroup(tool, requiredGroups));
  const artifactTools = taskRequiresArtifactTools(task) ? artifactToolsFrom(tools) : [];
  const capabilityTools = filtered.length > 0 ? filtered : tools;
  return stripTaskScopedTools(mergeToolLists(capabilityTools, [...requiredTools, ...artifactTools]));
}

export function shouldRenderWorkflowHint(task) {
  const capabilities = neededCapabilitiesOf(task);
  if (task?.task_spec?.connector_domain === true) return true;
  if (capabilities.includes("email_calendar_action")) return true;
  if (Array.isArray(task?.task_spec?.intent_tags) && task.task_spec.intent_tags.includes("connector")) return true;
  return false;
}
