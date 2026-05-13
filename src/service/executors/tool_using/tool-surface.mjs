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
    tool.id === "web_search_fetch"
    || tool.id === "fetch_url_content",
  file_read: (tool) =>
    /^(list_files|glob_files|find_recent_files|get_latest_artifact|stat_file|read_file_text|read_folder_text|search_file_content|index_file_content|verify_file_exists|file_op)$/.test(tool.id),
  // The capability matcher surfaces every tool the LLM may need
  // when artifact_required=true. That's a SUPERSET of the
  // POLICY_GROUPS.artifact_generation no-side-effect-producer floor
  // because the LLM also needs verify_file_exists to satisfy
  // task-spec required_steps for artifact tasks
  // (task-spec.mjs:1183/1193 inject verify_file_exists). The
  // policy group is the recovery-safety floor; this matcher is the
  // surface-visibility set — they are different abstractions on
  // purpose.
  artifact_generation: (tool) =>
    /^(write_file|generate_document|edit_file|render_diagram|render_svg|resolve_output_path|register_artifact|verify_file_exists)$/.test(tool.id),
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
  // Exposes read-only inventory/plugin management plus draft + save tools so
  // the planner can inspect existing capabilities, run the interview, and
  // persist the result without per-case keyword routing.
  capability_management: (tool) =>
    ["connector_plugin_manage", "draft_capability", "save_capability_draft"].includes(tool.id),
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
const WEB_SEARCH_PAGE_TOOL_ID = "web_search";
const EXTERNAL_WEB_READ_TOOL_IDS = new Set([
  "web_search",
  "web_search_fetch",
  "fetch_url_content"
]);

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

function userExplicitlyAskedToOpenSearchPage(task) {
  for (const text of liveUserIntentSources(task)) {
    if (/(打开|访问|浏览|前往|open|visit|navigate|go\s+to).{0,16}(搜索页|搜索结果|google|bing|search\s+(?:page|results))/iu.test(text)) {
      return true;
    }
  }
  return false;
}

function filterWebSearchPage(list = [], task) {
  if (userExplicitlyAskedToOpenSearchPage(task)) return list;
  return list.filter((tool) => tool?.id !== WEB_SEARCH_PAGE_TOOL_ID);
}

const CONNECTOR_SCOPE_RE = /(云盘|网盘|邮箱|邮件|日历|收件箱|google\s*drive|gmail|calendar|onedrive|outlook)/iu;
const INTERNET_SCOPE_RE = /(互联网|联网|网页|网站|站点|浏览器|web|internet|online|browser)/iu;
const EXTERNAL_RESEARCH_ACTION_RE = /(收集|整理|汇总|查询|查一下|搜索|研究|调研|总结|分析|compare|research|collect|summari[sz]e|search|look\s+up)/iu;
const EXTERNAL_RESEARCH_TOPIC_RE = /(最新|今日|今天|实时|当前|current|latest|news|新闻|资讯|市场|行情|股市|股票|美股|港股|A股|指数|板块|涨跌|财报|价格|price|quote|market|stock|index|earnings)/iu;

function userCommandIsConnectorScoped(task) {
  return liveUserIntentSources(task).some((text) =>
    CONNECTOR_SCOPE_RE.test(text) && !INTERNET_SCOPE_RE.test(text)
  );
}

function taskNeedsExternalWebReadSurface(task) {
  const spec = task?.task_spec ?? task?.task_spec_initial ?? {};
  const decision = semanticDecisionOf(task);
  const capabilities = neededCapabilitiesOf(task);
  if (capabilities.includes("external_web_read")) return true;
  if (decision?.source_scope === "external_world" || decision?.web_policy === "required") return true;
  if (spec?.needs_current_web_data === true || spec?.research_signals_present === true) return true;

  const policyGroups = spec?.tool_policy?.policy_groups ?? {};
  const webGroupMode = policyGroups?.external_web_read?.mode;
  const webToolMode = spec?.tool_policy?.web_search_fetch?.mode ?? spec?.tool_policy?.fetch_url_content?.mode;
  if (webGroupMode === "required" || webToolMode === "required") return true;

  // Connector-scoped commands can still require external research:
  // "collect today's market news and email it" contains "email", but the
  // research source is the outside world, not the mailbox. Keep this lexical
  // fallback narrow so "search my Drive/mailbox" continues to hide web search.
  return liveUserIntentSources(task).some((text) =>
    EXTERNAL_RESEARCH_ACTION_RE.test(text) && EXTERNAL_RESEARCH_TOPIC_RE.test(text)
  );
}

function filterConnectorScopedWebTools(list = [], task) {
  if (!userCommandIsConnectorScoped(task)) return list;
  if (taskNeedsExternalWebReadSurface(task)) return list;
  return list.filter((tool) => !EXTERNAL_WEB_READ_TOOL_IDS.has(tool?.id));
}

// C18 #2b: skill-install action tools are HIGH risk (third-party
// SKILL.md becomes future LLM prompt context). Mirror the open_url
// gating shape — only expose when the user's live text contains
// BOTH an install verb AND a github.com URL in the SAME source.
// Without that co-occurrence the LLM proposing an install would be
// pure hallucination, so we hide the tools by default. The pre-design
// D-consult was explicit: "don't fire on bare install without a
// GitHub URL".
const SKILL_INSTALL_TOOL_IDS = new Set([
  "preview_skill_from_github",
  "install_skill_from_github"
]);
// codex round-1: expanded EN coverage minimally — "install the skill",
// "set up the/this skill". False negatives are UX loss not safety
// loss, so the regex stays narrow on the verb-noun shape; bare
// "install" without "skill" still doesn't fire.
const SKILL_INSTALL_VERB_RE = /(安装|帮我安装|添加(?:这个|那个|这条)?技能|装上|装这个|install(?:\s+(?:this|the))?\s+skill|add(?:\s+(?:this|the))?\s+skill|set\s+up\s+(?:this\s+|the\s+)?skill)/iu;
const GITHUB_URL_RE = /github\.com\/[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*/i;

export function shouldExposeSkillInstall(task) {
  for (const text of liveUserIntentSources(task)) {
    if (SKILL_INSTALL_VERB_RE.test(text) && GITHUB_URL_RE.test(text)) {
      return true;
    }
  }
  // Explicit task-spec override (e.g. a follow-up turn where the
  // planner is mid-install and needs install_skill_from_github after
  // a previous preview_skill_from_github).
  const spec = task?.task_spec ?? task?.task_spec_initial;
  const requiredTools = spec?.success_contract?.required_tool_names;
  if (Array.isArray(requiredTools)
      && requiredTools.some((id) => SKILL_INSTALL_TOOL_IDS.has(id))) {
    return true;
  }
  return false;
}

function filterSkillInstall(list = [], task) {
  if (shouldExposeSkillInstall(task)) return list;
  return list.filter((tool) => !SKILL_INSTALL_TOOL_IDS.has(tool?.id));
}

// Surface-visibility set for artifact-required tasks. Intentionally
// a SUPERSET of POLICY_GROUPS.artifact_generation: the policy group
// is the no-side-effect-PRODUCER floor used by recovery; this set
// includes verify_file_exists because task-spec injects it into
// required_steps (src/service/core/task-spec.mjs:1183/1193) so the
// LLM must see it. Codex round-2/3 caught the contract drift when
// these two were conflated; they're now intentionally distinct.
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
const CODE_EXECUTION_TOOL_IDS = new Set(["run_script"]);

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

function taskHasTypedArtifactCapability(task) {
  const capabilities = neededCapabilitiesOf(task);
  if (capabilities.includes("artifact_generation")) return true;
  const decision = semanticDecisionOf(task);
  if (decision?.artifact_required === true) return true;
  if (decision?.expected_output === "artifact") return true;
  return requiredPolicyGroupsOf(task).includes("artifact_generation");
}

const CODE_EXECUTION_REQUEST_RE = /(执行|运行|跑一下|用\s*(node|python|powershell).{0,12}(脚本|代码)|脚本.{0,12}(执行|运行)|代码.{0,12}(执行|运行)|\b(run|execute)\b.{0,24}\b(script|code|node|python|powershell)\b|\b(node|python|powershell)\b.{0,24}\b(run|execute|script|code)\b)/iu;

function taskTextExplicitlyAsksForCodeExecution(task) {
  return liveUserIntentSources(task).some((text) => CODE_EXECUTION_REQUEST_RE.test(text));
}

function taskAllowsArtifactTools(task) {
  if (taskRequiresArtifactTools(task) || taskHasTypedArtifactCapability(task)) return true;
  return false;
}

function artifactToolsFrom(tools = []) {
  return tools.filter((tool) => ARTIFACT_TOOL_IDS.has(tool.id));
}

function codeExecutionToolsFrom(tools = []) {
  return tools.filter((tool) => CODE_EXECUTION_TOOL_IDS.has(tool.id));
}

function filterUnrequestedArtifactTools(list = [], task) {
  if (taskAllowsArtifactTools(task)) return list;
  return list.filter((tool) => !ARTIFACT_TOOL_IDS.has(tool?.id));
}

export function filterToolsForTask(tools = [], task) {
  const insideScheduledFire = isScheduledFireTask(task);
  const stripTaskScopedTools = (list) => {
    const withoutArtifacts = filterUnrequestedArtifactTools(list, task);
    const withoutDirectOpen = filterDirectFileOpenTools(withoutArtifacts, task);
    const withoutOpenUrl = filterOpenUrl(withoutDirectOpen, task);
    const withoutConnectorScopedWeb = filterConnectorScopedWebTools(withoutOpenUrl, task);
    const withoutWebSearchPage = filterWebSearchPage(withoutConnectorScopedWeb, task);
    const withoutSkillInstall = filterSkillInstall(withoutWebSearchPage, task);
    return insideScheduledFire
      ? withoutSkillInstall.filter((tool) => !isScheduleRegistryTool(tool))
      : withoutSkillInstall;
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
  const codeExecutionTools = taskTextExplicitlyAsksForCodeExecution(task) ? codeExecutionToolsFrom(tools) : [];
  const capabilityTools = filtered.length > 0 ? filtered : tools;
  return stripTaskScopedTools(mergeToolLists(capabilityTools, [...requiredTools, ...artifactTools, ...codeExecutionTools]));
}

export function shouldRenderWorkflowHint(task) {
  const capabilities = neededCapabilitiesOf(task);
  if (task?.task_spec?.connector_domain === true) return true;
  if (capabilities.includes("email_calendar_action")) return true;
  if (Array.isArray(task?.task_spec?.intent_tags) && task.task_spec.intent_tags.includes("connector")) return true;
  return false;
}
