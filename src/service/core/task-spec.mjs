/**
 * UCA-051: TaskSpec — Single Source of Truth for user request interpretation.
 *
 * Every user input is compiled into a TaskSpec before any executor is chosen.
 * This eliminates the pattern where intent-router, decomposer, and executor
 * each independently re-interpret the request and produce contradictory results.
 *
 * Flow: userText → createTaskSpec() → applyHardenedRules() → TaskSpec
 *       TaskSpec → (task-runtime) → ExecutionPlan → executor
 */

import { isConnectorDomainRequest } from "../connectors/core/connector-intent.mjs";
import { extractLaunchAppCandidates, extractPureLaunchApp } from "./router/fast-path-router.mjs";
import { extractAllSignals } from "./intent/signals/index.mjs";
import { resolveToolPolicy, buildExternalWebReadPolicy, shouldConsultSemanticRouter } from "./policy/tool-policy-resolver.mjs";
import { intentRouteNeedsConnector } from "./policy/evidence-policy.mjs";
import { enforcePolicyInvariants } from "./policy/policy-invariants.mjs";
import { inferResearchQuality, RESEARCH_PROFILES } from "./policy/research-quality.mjs";
import { classifyContextSources } from "./intent/context-sources.mjs";
import { resolveExecutor } from "./planning/executor-resolver.mjs";
import { createTracker, STAGES } from "./contracts/decision-trace.mjs";
import { compileTaskContract } from "./contracts/task-contract.mjs";
import { inferSideEffectPolicyGroups } from "./policy/side-effect-contracts.mjs";

// ---------------------------------------------------------------------------
// Goal families (the canonical classification of what the user wants to do)
// ---------------------------------------------------------------------------

/**
 * UCA-058: Goals that must NEVER be decomposed into subtasks.
 * Single-intent responses — the LLM answers directly, no splitting needed.
 */
export const NO_DECOMPOSE_GOALS = new Set([
  "qa",
  "translate",
  "search_and_answer",
  "analyze_and_report",
  "generate_document",
  "transform_existing_file",
  "launch_and_act",
  "schedule_or_notify",
  "multimodal_analyze"
]);

export const GOAL_FAMILIES = /** @type {const} */ ([
  "qa",                    // Pure Q&A — no tools, no file
  "search_and_answer",     // Needs current/real-time data → must call web_search_fetch first
  "analyze_and_report",    // Analyze provided content → produce a file (docx/pdf/md)
  "generate_document",     // Create PPT/Word/Excel/PDF from scratch or from web research
  "open_or_reveal_file",   // Locate and open/reveal an existing file
  "transform_existing_file", // Modify/convert an existing file
  "launch_and_act",        // Launch an application and/or perform UI actions
  "schedule_or_notify",    // Create a reminder/scheduled task
  "translate",             // Language conversion
  "multimodal_analyze"     // Vision / OCR / image description
]);

function goalRuleMatches(rule, raw, signals = null) {
  if (!rule?.patterns?.some((pat) => pat.test(raw))) return false;
  if (!rule.requiresSignal) return true;
  return Boolean(signals && rule.requiresSignal(signals));
}

function isLaunchTaskText(text) {
  const raw = String(text ?? "");
  return Boolean(extractPureLaunchApp(raw) || extractLaunchAppCandidates(raw).length > 0);
}

// ---------------------------------------------------------------------------
// TaskSpec type (JSDoc typedef for IDE support)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ArtifactSpec
 * @property {boolean} required
 * @property {"pptx"|"docx"|"xlsx"|"pdf"|"html"|"csv"|"md"|"txt"|null} kind
 * @property {"draft"|"formal"} quality
 */

/**
 * @typedef {Object} SuccessContract
 * @property {boolean} artifact_created   - task is only successful if artifact file exists
 * @property {boolean} artifact_registered - artifact must be in the manifest
 * @property {boolean} tool_called        - at least one tool call must appear in transcript
 * @property {string[]} required_tool_names - specific tools that must be called
 */

/**
 * @typedef {Object} TaskSpec
 * @property {string} goal                     - one of GOAL_FAMILIES
 * @property {string} user_goal_text           - original user input (verbatim)
 * @property {string} topic                    - inferred topic summary
 * @property {boolean} needs_current_web_data  - if true, web_search_fetch MUST run first
 * @property {ArtifactSpec} artifact
 * @property {{ files: string[], urls: string[], selection_text: string, clipboard: string }} source
 * @property {{ language: string, can_split: boolean, must_use_tools: boolean, must_verify_artifact: boolean }} constraints
 * @property {string[]} required_steps         - ordered step list (injected by hardenedRules)
 * @property {SuccessContract} success_contract
 * @property {import("./policy/research-quality.mjs").ResearchQuality | null} research_quality
 *   - P4-RQ D1: research-class enforcement profile. Drives hard
 *     coverage checks in validateSuccessContract / validateStepGate
 *     (D3). null when web is forbidden — no enforcement applies.
 * @property {"ok"|"ok_deterministic"|"sr_not_invoked"|"sr_timeout"|"sr_no_provider"|"sr_unsupported_provider"|"sr_disabled"|"sr_low_confidence"|"sr_schema_invalid"|"sr_fact_conflict"|"sr_exception"} routing_status
 *   - P4-RQ G4: SR availability flag. "ok" when SR ran (or wasn't
 *     gated to run); `sr_<code>` when the SR preflight returned a
 *     rejection. Read by audit traces to distinguish "SR said no"
 *     from "SR couldn't answer".
 * @property {boolean} routing_degraded
 *   - P4-RQ G6b: derived from routing_status. true when SR was
 *     consulted but failed operationally
 *     (sr_timeout / sr_exception / sr_no_provider / sr_schema_invalid).
 *     False for sr_disabled / sr_unsupported_provider (operator
 *     choice) and sr_low_confidence / sr_fact_conflict (SR ran).
 *     Read by fast-executor as the PRIMARY pre-LLM short-circuit
 *     gate so research-class queries don't fabricate live-lookup
 *     answers when SR couldn't deliver.
 * @property {boolean} connector_domain
 *   - P4-RQ G4: true when isConnectorDomainRequest fired. Read by
 *     executor-resolver Rule 5 extension (G5a) to keep
 *     "查一下我最近的邮件"-style tasks on tool_using even when web
 *     mode is forbidden (connector tools handle the fetch, not
 *     external web).
 * @property {string} suggested_executor       - executor hint (not final — task-runtime decides)
 * @property {string[]} intent_tags            - multi-label tags from intent-router
 * @property {string[]} suggested_formats      - detected output formats
 */

// ---------------------------------------------------------------------------
// Goal classification rules (word-boundary safe, no substring traps)
// ---------------------------------------------------------------------------

const GOAL_RULES = [
  // translate — highest confidence, check first.
  // UCA-077 P1-05: split Chinese / English alternations so \b only guards
  // English (Chinese chars are \W and would never satisfy \b\B\b boundaries).
  {
    goal: "translate",
    patterns: [/(翻译)|\b(translate|translation)\b/i]
  },
  // schedule / notify
  {
    goal: "schedule_or_notify",
    patterns: [
      /\b(定时|提醒|cron|reminder|每天|每周|每月|daily|weekly)\b/i,
      /(?:提醒.*(?:明天|今天|上午|下午|\d+\s*[点时]))|(?:(?:明天|今天|上午|下午|\d+\s*[点时]).*提醒)/
    ]
  },
  // launch an application (must have app context: app name, 应用, etc.)
  {
    goal: "launch_and_act",
    patterns: [
      /\b(启动|launch)\b/i,
      /\b(打开|open|运行|run)\b.{0,20}\b(应用|app|程序|software|微信|wechat|qq|dingtalk|钉钉|飞书|notion|slack|discord|telegram|vscode|chrome|firefox)/i
    ]
  },
  // open/reveal an existing file (file path or "上次/刚才 生成" context)
  {
    goal: "open_or_reveal_file",
    patterns: [
      /(打开|显示|定位).{0,30}((?:这个|这份)?(?:文件|附件|文档)|所在位置|pptx|docx|xlsx|pdf|上次|刚才|最近)/i,
      /\b(打开|open|reveal|显示|定位)\b.{0,30}\b(文件|file|pptx|docx|xlsx|pdf|上次|刚才|最近)\b/i,
      /(打开|open)\s+[\w/\\:.~]+\.(pptx|docx|xlsx|pdf|txt|md|csv|html)/i
    ]
  },
  // transform an existing file (modify/convert)
  {
    goal: "transform_existing_file",
    patterns: [
      /\b(转换|convert|改写|rewrite|修改|modify|edit|update)\b.{0,20}\b(文件|file|doc|ppt|xls)\b/i
    ]
  },
  // generate document from scratch or research
  {
    goal: "generate_document",
    patterns: [
      /(生成|创建|制作|写|create|generate|make|write).{0,30}(pptx?|powerpoint|幻灯片|演示文稿|演示文档|slides?)/i,
      /(生成|创建|制作|写|create|generate|make|write).{0,30}(docx?|word\s*文档|word\s*文件|\bword\b|文档)/i,
      /(生成|创建|制作|写|create|generate|make|write).{0,30}(xlsx?|excel|电子表格|表格)/i,
      /(生成|创建|制作|写|create|generate|make|write).{0,30}(pdf|报告|report)/i
    ]
  },
  // analyze + report (has content to analyze, output is a file)
  {
    goal: "analyze_and_report",
    patterns: [
      /(分析|analyze|analyse).{0,40}(总结|报告|输出|生成|文档|文件)/i
    ]
  },
  // search_and_answer — explicitly needs current/latest data.
  //
  // UCA-077 P1-05: this rule used to fire on weak words like "最新/recent"
  // alone, which routed local-context tasks (e.g. "最新这个框架的功能") to
  // search_and_answer and onward to web_search. Tightening:
  //   - When signals are provided, search_and_answer requires either
  //     a structural external-intent signal OR an SR judgement that
  //     this is a research-class task. Weak time markers never
  //     escalate the goal by themselves.
  //   - When signals are absent (back-compat for callers like routeIntent
  //     that have not adopted the signal layer yet), keep the legacy
  //     pattern set, but it now serves only as a coarse hint downstream.
  //
  // P4-RQ §19 #5 / F2 — MIGRATION OFF topic_hint:
  // Pre-F2 the requiresSignal check read `topic_hint.matched`,
  // which entrenched the topic-domain regex as a goal-classifier
  // input. F2 replaces that with the synthetic `semantic_router`
  // signal that wraps SR's structured judgement. Net effect:
  //   - With SR available + SR says web≠forbidden → search_and_answer.
  //   - Without SR + topical query → goal=qa (conservative fallback,
  //     consistent with the "no SR = forbidden web" principle from
  //     E3 C1; executor-resolver Rule 5 routes qa+forbidden to fast
  //     for a quick "I can't reach the web" reply).
  //   - explicit_external still fires here as a STRUCTURAL hard
  //     signal (kept-as-regex per the reference docs).
  //
  // explicit_search NOT added per user direction post-E5: "下一步
  // 不要做'把 explicit_search 加进 goal regex'这种快修, 应该按计划做
  // goal/executor 从 SR + EvidencePolicy 输出迁移". The migration
  // is the SR consult; if "查一下 X" without SR is mis-classified
  // as goal=qa today, that's an acceptable edge — executor still
  // reaches tool_using because explicit_search drives web=required
  // at the resolver layer (E5 step 3), and SuccessContract will
  // require external_web_read either way.
  {
    goal: "search_and_answer",
    // UCA-077 P2-04: split Chinese / English so \b only guards English; the
    // earlier `\b(新闻|最新|...)\b` pattern never matched between two Chinese
    // chars (Chinese is \W in JS regex). That left "今天有什么 AI 新闻"
    // classified as `qa` even after every signal correctly fired.
    patterns: [
      /(搜索|最新|新闻|动态|资讯|热点|今日)/,
      /\b(search|latest|recent|news|today|tomorrow|weather|forecast)\b/i,
      /(天气|气温|明天|后天|明日|汇率|股价|航班|机票|酒店|价格)/
    ],
    // F2: explicit_external (structural hard signal) OR semantic_router
    // says research-class (web_policy != forbidden). topic_hint REMOVED.
    requiresSignal: (signals) =>
      Boolean(
        signals?.explicit_external?.matched
        || (signals?.semantic_router?.matched
            && signals.semantic_router.hint?.web_policy
            && signals.semantic_router.hint.web_policy !== "forbidden")
      )
  }
  // fallback: "qa" — handled in classifyGoal()
];

/**
 * Determine the goal family from user text.
 * Returns the first matching goal, or "qa" as fallback.
 *
 * UCA-077 P1-05: `signals` is optional. Rules that declare `requiresSignal`
 * are gated on it — without signals, the rule is skipped (conservative).
 * Callers inside the new pipeline (createTaskSpec) always pass signals.
 *
 * @param {string} text
 * @param {import("./intent/signals/_signal-types.mjs").SignalBundle["signals"]} [signals]
 * @returns {string}
 */
export function classifyGoal(text, signals = null) {
  const raw = String(text ?? "");
  const scheduleRule = GOAL_RULES.find((rule) => rule.goal === "schedule_or_notify");
  if (goalRuleMatches(scheduleRule, raw, signals)) {
    return "schedule_or_notify";
  }
  const openFileRule = GOAL_RULES.find((rule) => rule.goal === "open_or_reveal_file");
  if (goalRuleMatches(openFileRule, raw, signals)) {
    return "open_or_reveal_file";
  }
  if (isLaunchTaskText(raw)) {
    return "launch_and_act";
  }
  if (isConnectorDomainRequest(raw)) {
    return "search_and_answer";
  }
  for (const rule of GOAL_RULES) {
    if (rule.goal === "schedule_or_notify") continue;
    if (rule.goal === "open_or_reveal_file") continue;
    if (!goalRuleMatches(rule, raw, signals)) continue;
    return rule.goal;
  }

  // P4-RQ G1: SR-driven goal escalation bypasses the legacy
  // GOAL_RULES.patterns gate when SR (Layer-3) provides a
  // structured research-class judgement.
  //
  // Reproduction this fixes: "查一下有没有类似的开源项目" + SR=required.
  // The text doesn't match any topical pattern (weather/news/etc.),
  // so the search_and_answer rule short-circuited above before
  // requiresSignal even saw the SR signal — task got goal=qa even
  // though SR clearly classified it as research.
  //
  // Placement (after the rule loop, before qa fallback): we still
  // let translate / multimodal_analyze / schedule_or_notify /
  // launch_and_act / generate_document / transform_existing_file /
  // analyze_and_report win when their patterns match — those are
  // non-research goals SR shouldn't override. Only when no other
  // goal pattern matched do we let SR promote ambiguous text to
  // search_and_answer.
  //
  // Conditions:
  //   - signals.semantic_router.matched (decision was stamped)
  //   - strength === "strong" (confidence ≥ 0.7 — don't promote
  //     on weak/uncertain SR)
  //   - hint.web_policy != "forbidden" (SR-required and SR-optional
  //     both indicate the task wants external info)
  const sr = signals?.semantic_router;
  if (sr?.matched
      && sr.strength === "strong"
      && sr.hint?.web_policy
      && sr.hint.web_policy !== "forbidden") {
    return "search_and_answer";
  }

  return "qa";
}

const NON_WEB_POLICY_GROUPS_FROM_INTENT_ROUTE = new Set([
  "email_send",
  "calendar_create",
  "file_upload",
  "schedule_create"
]);
const CLEAR_SIDE_EFFECT_POLICY_GROUPS = new Set([
  "email_send",
  "calendar_create",
  "file_upload",
  "schedule_create"
]);

function requiredPolicyGroupsFromIntentRoute(decision = null, { text = "", contextPacket = null } = {}) {
  const groups = decision && typeof decision === "object" && Array.isArray(decision.required_policy_groups)
    ? decision.required_policy_groups
    : [];
  const inferredGroups = inferSideEffectPolicyGroups({
    sources: [
      text,
      contextPacket?.text,
      contextPacket?.selection_metadata?.schedule_name,
      contextPacket?.selection_metadata?.schedule_description,
      contextPacket?.selection_metadata?.schedule_action_target
    ].filter(Boolean),
    existingContract: contextPacket?.selection_metadata?.side_effect_contract ?? null,
    task: {
      user_command: text,
      context_packet: contextPacket
    }
  });
  return [...new Set([...groups, ...inferredGroups]
    .filter((group) => NON_WEB_POLICY_GROUPS_FROM_INTENT_ROUTE.has(group)))];
}

function expectedOutputFromIntentRoute(decision = null, requiredPolicyGroups = []) {
  const expected = decision && typeof decision === "object" && typeof decision.expected_output === "string"
    ? decision.expected_output
    : null;
  const groups = decision && typeof decision === "object" && Array.isArray(decision.required_policy_groups)
    ? decision.required_policy_groups
    : [];
  if ([...groups, ...requiredPolicyGroups].some((group) => CLEAR_SIDE_EFFECT_POLICY_GROUPS.has(group))
      && (!expected || expected === "email_draft")) {
    return "execution";
  }
  return expected;
}

function shouldRelaxConnectorWebPolicy({ connectorDomainRequest, srDecision, signals }) {
  if (!connectorDomainRequest) return false;
  if (srDecision && typeof srDecision === "object") return false;
  if (signals?.explicit_external?.matched) return false;
  if (signals?.explicit_single_url?.matched) return false;
  return true;
}

function relaxConnectorWebPolicy(policy) {
  const mode = policy?.policy_groups?.external_web_read?.mode
    ?? policy?.web_search_fetch?.mode;
  if (mode !== "required") return policy;
  return buildExternalWebReadPolicy(
    "optional",
    "Connector capability request: connected-account tools own the external account state; open-web evidence remains optional unless IntentRoute requires it.",
    [
      { type: "context", source: "connector-intent", reason: "connector domain is a capability axis, not an open-web requirement" }
    ]
  );
}

// ---------------------------------------------------------------------------
// UCA-077 P1-05: WEB_DATA_PATTERNS / needsCurrentWebData() were removed.
//
// They have been split into discrete signal modules under
// `src/service/core/intent/signals/`:
//   - weak-freshness.mjs    (最近 / current / today …)
//   - explicit-search.mjs   (搜索 / 查一下 / google …)
//   - topic-hint.mjs   (天气 / 股价 / 航班 …)
//   - explicit-external.mjs (网上 / online …)
//   - source-scope.mjs      (这个文件 / 这段代码 …)
//
// Tool decisions consume the signal bundle through
// `policy/tool-policy-resolver.mjs`. This file no longer hard-codes any
// "needs web search" heuristic.
// ---------------------------------------------------------------------------

const NOTE_INTENT_PATTERNS = [
  /(?:笔记|筆記|纪要|會議紀要|会议记录|會議記錄|meeting\s+notes?|study\s+notes?|class\s+notes?)/i,
  /(?:记一下|記一下|记录一下|記錄一下|整理成(?:笔记|筆記|纪要)|总结成(?:笔记|筆記|纪要)|写成(?:笔记|筆記|纪要)|做成(?:笔记|筆記|纪要))/i,
  /\b(?:note|notes|minutes)\b/i
];

const EDITABLE_ARTIFACT_EXTENSIONS = new Set([
  ".pptx",
  ".docx",
  ".xlsx",
  ".pdf",
  ".md",
  ".txt",
  ".html",
  ".htm",
  ".csv",
  ".json"
]);

const ARTIFACT_REFINEMENT_PATTERNS = [
  /(加上|加一些|加入|补上|补充|插入|替换|换成|删掉|删除|修改|更新|调整|优化|完善|美化|精美|润色|改一下|改得|重做|重写|重排)/i,
  /\b(add|include|insert|replace|remove|delete|modify|edit|update|revise|refine|polish|improve|beautify|restyle)\b/i
];

const ARTIFACT_REFERENCE_PATTERNS = [
  /(pptx?|powerpoint|幻灯片|演示文稿|slides?|slideshow|docx?|word\s*文档|word\s*文件|\bword\b|xlsx?|excel|电子表格|表格|pdf|文件|文档)/i
];

const LOCAL_ROUTING_LOCK_SCOPES = new Set(["uploaded_files", "current_context", "local_project", "selection"]);

function artifactKindFromPath(filePath = "") {
  const normalized = String(filePath ?? "").toLowerCase();
  if (normalized.endsWith(".pptx")) return "pptx";
  if (normalized.endsWith(".docx")) return "docx";
  if (normalized.endsWith(".xlsx")) return "xlsx";
  if (normalized.endsWith(".pdf")) return "pdf";
  if (normalized.endsWith(".html") || normalized.endsWith(".htm")) return "html";
  if (normalized.endsWith(".csv")) return "csv";
  if (normalized.endsWith(".md")) return "md";
  if (normalized.endsWith(".txt")) return "txt";
  return null;
}

function hasEditableArtifactContext(contextPacket = {}) {
  return (contextPacket?.file_paths ?? []).some((filePath) => {
    const normalized = String(filePath ?? "").toLowerCase();
    return [...EDITABLE_ARTIFACT_EXTENSIONS].some((ext) => normalized.endsWith(ext));
  });
}

function hasArtifactRefinementIntent(text, contextPacket = {}) {
  if (!hasEditableArtifactContext(contextPacket)) return false;
  const normalized = String(text ?? "");
  // UCA-077 P1-05: previously this also returned true on any artifact
  // reference word ("文件/文档") even without an edit verb, so requests like
  // "查一下这个文件里最近提到的内容" got upgraded to transform_existing_file
  // and routed to agentic. The reference alone is too weak — require an
  // explicit refinement verb.
  return ARTIFACT_REFINEMENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

function detectArtifactKindFromContext(contextPacket = {}) {
  for (const filePath of contextPacket?.file_paths ?? []) {
    const kind = artifactKindFromPath(filePath);
    if (kind) return kind;
  }
  return null;
}

function hasContentForNote(contextPacket = {}) {
  return Boolean(
    String(contextPacket?.text ?? "").trim()
    || String(contextPacket?.clipboard_text ?? "").trim()
    || contextPacket?.file_paths?.length
    || contextPacket?.image_paths?.length
    || contextPacket?.source_type === "audio_note"
    || contextPacket?.source_app === "uca.note"
  );
}

function hasNoteTakingIntent(text, contextPacket = {}) {
  if (contextPacket?.source_type === "audio_note" || contextPacket?.source_app === "uca.note") {
    return true;
  }
  return hasContentForNote(contextPacket) && NOTE_INTENT_PATTERNS.some((p) => p.test(String(text ?? "")));
}

function hasDeterministicRoutingLock({ signals, contextPacket = {}, toolPolicy, text = "" } = {}) {
  if (isLaunchTaskText(text)) return true;
  if (signals?.explicit_no_search?.matched && signals.explicit_no_search.kind === "fact") return true;
  if (signals?.local_only_constraint?.matched && signals.local_only_constraint.kind === "fact") return true;

  const neutralSearch = Boolean(
    signals?.explicit_search?.matched
    && signals.explicit_search.strength === "strong"
  );
  if (Array.isArray(contextPacket?.file_paths) && contextPacket.file_paths.length > 0 && !neutralSearch) return true;
  if (Array.isArray(contextPacket?.image_paths) && contextPacket.image_paths.length > 0 && !neutralSearch) return true;

  const sourceScope = signals?.source_scope;
  const sources = contextPacket?.context_sources;
  const hasObservedLocalAnchor = Boolean(
    sources?.real_selection
    || sources?.file_text
    || sources?.uploaded_files
    || sources?.uploaded_images
  );
  const webMode = toolPolicy?.policy_groups?.external_web_read?.mode
    ?? toolPolicy?.web_search_fetch?.mode;
  return Boolean(
    webMode === "forbidden"
    && sourceScope?.matched
    && LOCAL_ROUTING_LOCK_SCOPES.has(sourceScope.hint?.value)
    && !neutralSearch
    && (sourceScope.kind === "fact"
      || (sourceScope.kind === "assumption" && hasObservedLocalAnchor))
  );
}

// ---------------------------------------------------------------------------
// Detect artifact requirement
// ---------------------------------------------------------------------------

const FORMAT_PATTERNS = [
  { format: "pptx", pattern: /(\.pptx|pptx|powerpoint|\bppt\b|幻灯片|演示文稿|演示文档|slides?|slideshow)/i },
  { format: "docx", pattern: /(\.docx|docx|word\s*文档|word\s*文件|\bword\b|文档格式)/i },
  { format: "xlsx", pattern: /(\.xlsx|xlsx|excel|电子表格|表格文件|spreadsheet)/i },
  { format: "pdf",  pattern: /(\.pdf|pdf)/i },
  { format: "html", pattern: /(\.html|\.htm|html)/i },
  { format: "json", pattern: /(\.json|json)/i },
  { format: "csv",  pattern: /(\.csv|csv|逗号分隔)/i },
  { format: "md",   pattern: /(\.md|markdown)/i },
  { format: "txt",  pattern: /(\.txt|txt|纯文本)/i }
];

const FILE_ARTIFACT_FORMATS = new Set(["pptx", "docx", "xlsx", "pdf"]);

function detectFormats(text) {
  if (isLaunchTaskText(text)) {
    return [];
  }
  return FORMAT_PATTERNS
    .filter(({ pattern }) => pattern.test(text))
    .map(({ format }) => format);
}

function buildResearchExecutionConstraints(researchQuality) {
  if (!researchQuality || typeof researchQuality !== "object") return undefined;

  if (researchQuality.profile === RESEARCH_PROFILES.SINGLE_LOOKUP) {
    return {
      max_iterations: 8,
      error_budget: {
        max_empty_search_results: 2,
        max_tool_failures: 4,
        max_replan_rounds: 2,
        max_no_file_change_runs: 1
      }
    };
  }

  if (researchQuality.profile === RESEARCH_PROFILES.DEEP_RESEARCH) {
    return {
      max_iterations: 16,
      error_budget: {
        max_empty_search_results: 4,
        max_tool_failures: 8,
        max_replan_rounds: 3,
        max_no_file_change_runs: 1
      }
    };
  }

  if (researchQuality.profile === RESEARCH_PROFILES.MULTI_SOURCE_RESEARCH) {
    return {
      max_iterations: 12,
      error_budget: {
        max_empty_search_results: 3,
        max_tool_failures: 6,
        max_replan_rounds: 3,
        max_no_file_change_runs: 1
      }
    };
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// createTaskSpec — compile user text + context into a TaskSpec
// ---------------------------------------------------------------------------

/**
 * @param {string} userText
 * @param {Object} [contextPacket]  — the ContextPacket from the overlay / submission layer
 * @param {Object} [intentRouterResult] — existing routeIntent() result (to avoid double-routing)
 * @returns {TaskSpec}
 */
export function createTaskSpec(userText, contextPacket = {}, intentRouterResult = {}) {
  const text = String(userText ?? "");

  // UCA-077 P1-05: pipeline order is signals → goal → policy → executor.
  // Each step is a pure function; only this orchestrator carries side intent.
  // UCA-077 P2-02: every stage records into a DecisionTrace tracker so the
  // task carries a full "why" log for SSE / UI / audit consumers.
  //
  // P4-02.x C1 (plan p4-03-p4-02): Layer 1 context-source classification
  // runs FIRST so signal extraction (Layer 2) and the policy resolver
  // (Layer 4) can both consume the canonical labels. Wired here at the
  // orchestrator entry rather than in `context-submission.mjs` so the
  // 8+ verifiers that call createTaskSpec directly (routing-policy /
  // executor-selection / risk-register / signal-kinds / …) automatically
  // exercise the classifier. Output stamped onto a cloned contextPacket
  // — original input is not mutated; downstream code reads from the
  // clone via `enrichedContext`.
  const tracker = createTracker();
  const contextSources = classifyContextSources({ text, contextPacket });
  const enrichedContext = { ...(contextPacket ?? {}), context_sources: contextSources };
  const { signals } = extractAllSignals(text, enrichedContext);
  const noteIntent = hasNoteTakingIntent(text, contextPacket);
  const imageDriven = Array.isArray(contextPacket?.image_paths) && contextPacket.image_paths.length > 0;
  const artifactEditIntent = hasArtifactRefinementIntent(text, contextPacket);

  const baseGoal = classifyGoal(text, signals);
  let goal = baseGoal;
  let goalReason = "Goal classified from text patterns + signals.";
  if (noteIntent) {
    goal = imageDriven ? "multimodal_analyze" : "analyze_and_report";
    goalReason = "Note-capture intent overrode the regex-classified goal.";
  } else if (artifactEditIntent) {
    goal = "transform_existing_file";
    goalReason = "User asked to edit an attached editable artifact.";
  } else if (imageDriven && goal === "qa") {
    // UCA-077 P2-06: bare image attachments default to multimodal_analyze
    // even when the verb regex (`/图片|image|截图.../`) misses Chinese
    // alternatives like "识别这张图". The executor would pick multi_modal
    // anyway via runtime capability check, but the goal+mode must match
    // so the TaskContract reports a consistent intent.
    goal = "multimodal_analyze";
    goalReason = "Image attachment present and no other goal pattern matched.";
  }
  tracker.record(STAGES.GOAL_CLASSIFICATION, {
    output: { goal, base_goal: baseGoal },
    reason: goalReason,
    evidence: collectGoalEvidence(signals, { noteIntent, artifactEditIntent }),
    rejected: baseGoal !== goal ? [{ candidate: baseGoal, reason: "overridden by note/artifact-edit intent" }] : []
  });

  const suggestedFormats = detectFormats(text);
  const contextArtifactKind = detectArtifactKindFromContext(contextPacket);
  const explicitFileArtifactKind = noteIntent
    ? (suggestedFormats.includes("md") ? "md" : null)
    : (suggestedFormats.find((f) => FILE_ARTIFACT_FORMATS.has(f)) ?? null);
  const inferredFileArtifactKind = ["generate_document", "analyze_and_report", "transform_existing_file", "multimodal_analyze"].includes(goal)
    ? (noteIntent ? "md" : "docx")
    : null;
  const fileArtifactKind = explicitFileArtifactKind
    ?? (goal === "transform_existing_file" ? contextArtifactKind : null)
    ?? inferredFileArtifactKind;
  const artifactRequired = goal === "launch_and_act"
    ? false
    : (noteIntent ||
      FILE_ARTIFACT_FORMATS.has(fileArtifactKind) ||
      goal === "generate_document" ||
      goal === "analyze_and_report" ||
      goal === "transform_existing_file");

  const srDecision = enrichedContext?.semantic_router_decision;
  const srRejection = enrichedContext?.semantic_router_rejection;
  const pureLaunchApp = extractPureLaunchApp(text);
  const connectorDomainRequest = (!pureLaunchApp && isConnectorDomainRequest(text))
    || intentRouteNeedsConnector(srDecision);
  // Connector intent is a capability axis, not a web-policy axis. Earlier
  // versions treated any connector request as "external_web_read=forbidden",
  // which broke compound workflows such as "research current market data,
  // then email it". Let resolveToolPolicy + SemanticRouter/EvidencePolicy
  // decide the web axis, while connector_domain only keeps connector tools
  // in the executor's planning surface.
  const resolvedPolicy = resolveToolPolicy({ signals, contextPacket: enrichedContext, text });
  const rawPolicy = shouldRelaxConnectorWebPolicy({ connectorDomainRequest, srDecision, signals })
    ? relaxConnectorWebPolicy(resolvedPolicy)
    : resolvedPolicy;
  // P4-00.6: enforce the policy_groups ↔ per-toolId invariant. Today
  // every emitter is consistent, but this is the single guarantee point
  // for future write paths (SemanticRouter, hand-built test policies).
  // forbidden wins; group is canonical otherwise. Every conflict gets
  // its own DecisionTrace entry under POLICY_CONFLICT_RESOLVED so the
  // operator can see what was overruled.
  // P4-03: when an upstream async preflight stamped a SemanticRouter
  // outcome onto the context packet, surface it on the DecisionTrace so
  // the inspect-routing UI can show the full pipeline. Today no caller
  // stamps these fields (the default router has no adapter wired); the
  // stamp is read here so the §19 follow-up that wires the async
  // preflight in submission paths needs zero changes to task-spec.
  if (srDecision && typeof srDecision === "object") {
    tracker.record(STAGES.SEMANTIC_ROUTER, {
      output: {
        web_policy: srDecision.web_policy ?? null,
        source_scope: srDecision.source_scope ?? null,
        primary_intent: srDecision.primary_intent ?? null,
        expected_output: srDecision.expected_output ?? null,
        source_mode: srDecision.source_mode ?? null,
        needed_capabilities: Array.isArray(srDecision.needed_capabilities)
          ? srDecision.needed_capabilities
          : [],
        required_policy_groups: Array.isArray(srDecision.required_policy_groups)
          ? srDecision.required_policy_groups
          : [],
        needs_external_info: srDecision.needs_external_info ?? null,
        needs_current_information: srDecision.needs_current_information ?? null,
        executor: srDecision.executor ?? null,
        confidence: typeof srDecision.confidence === "number" ? srDecision.confidence : null
      },
      reason: srDecision.rationale_summary ?? srDecision.reason ?? "Semantic router returned a decision.",
      evidence: [{ type: "semantic_router", source: "semantic_router", reason: "decision stamped on contextPacket" }]
    });
  } else if (srRejection && typeof srRejection === "object") {
    tracker.record(STAGES.SEMANTIC_ROUTER, {
      output: { rejected: true, code: srRejection.code ?? "unknown" },
      reason: `Semantic router rejected: ${srRejection.reason ?? "(no reason)"}`,
      evidence: [{ type: "semantic_router", source: "semantic_router", reason: srRejection.code ?? "unknown" }]
    });
  }

  const { resolved: toolPolicy, conflicts: policyConflicts } = enforcePolicyInvariants(rawPolicy);
  for (const conflict of policyConflicts) {
    tracker.record(STAGES.POLICY_CONFLICT_RESOLVED, {
      output: {
        group: conflict.group,
        tool_id: conflict.tool_id,
        resolution: conflict.resolution
      },
      reason: `Policy conflict on ${conflict.group}: group=${conflict.group_mode} vs ${conflict.tool_id}=${conflict.tool_mode}; ${conflict.reason} → ${conflict.resolution}.`,
      evidence: [
        { type: "invariant", source: "enforcePolicyInvariants", reason: conflict.reason }
      ]
    });
  }
  // P4-RR: every tool-policy decision activates the resolver mitigation
  // (RR-01) and the capability-based group expansion (RR-03). When the
  // resulting policy carries a forbidden mode anywhere, RR-02 (registry
  // guard) is also armed. Tagging here lets the UI / inspect-routing tool
  // render "system applied RR-01 / RR-03" alongside the reason.
  const policyTriggeredRaid = ["RR-01", "RR-03"];
  const anyForbidden = Object.values(toolPolicy).some((entry) => entry?.mode === "forbidden")
    || Object.values(toolPolicy.policy_groups ?? {}).some((entry) => entry?.mode === "forbidden");
  if (anyForbidden) policyTriggeredRaid.push("RR-02");
  tracker.record(STAGES.TOOL_POLICY, {
    output: { web_search_fetch: toolPolicy.web_search_fetch.mode },
    reason: toolPolicy.web_search_fetch.reason,
    evidence: toolPolicy.web_search_fetch.evidence,
    // The other two modes are recorded as alternatives so a UI can show what
    // *could* have been chosen and why it was not.
    rejected: rejectedToolPolicyModes(toolPolicy.web_search_fetch.mode),
    triggered_raid_ids: policyTriggeredRaid
  });

  // Infer source from context packet
  const source = {
    files: contextPacket?.file_paths ?? [],
    urls: contextPacket?.urls ?? [],
    selection_text: contextPacket?.text ?? "",
    clipboard: contextPacket?.clipboard_text ?? ""
  };
  const mergedIntentTags = [
    ...(intentRouterResult.intent_tags ?? []),
    ...(noteIntent ? ["note_capture"] : [])
  ];
  const mergedSuggestedFormats = [
    ...new Set([
      ...suggestedFormats,
      ...(noteIntent ? ["md"] : [])
    ])
  ];

  // P4-RQ D1: derive research_quality from web policy + context
  // sources + the explicit_single_url Layer-2 signal.
  // multi_source_research carries hard thresholds the validator (D3)
  // enforces; single_lookup is the exception for "summarise this URL"
  // / local-anchored tasks; null when web is forbidden entirely.
  //
  // K3: thread the SR's `research_depth` suggestion through. When SR
  // classified the request as "deep_research" (explicit thorough /
  // comprehensive ask) and no local anchor is present, the inference
  // upgrades to the deep_research profile (5/3 thresholds vs the
  // default 3/2).
  const researchQuality = inferResearchQuality({
    contextSources,
    signals,
    toolPolicyMode: toolPolicy?.policy_groups?.external_web_read?.mode,
    srResearchDepth: enrichedContext?.semantic_router_decision?.research_depth ?? null,
    srSourceMode: enrichedContext?.semantic_router_decision?.source_mode ?? null
  });

  // P4-RQ G4: routing_status — propagate SR availability to
  // downstream consumers (executor-resolver Rule 5 ext., fast-
  // executor truthfulness guard, audit trace). Distinguishes
  // "SR ran successfully" (ok) from "SR couldn't run" (sr_timeout
  // / sr_no_provider / sr_unsupported_provider / etc.). Without
  // this flag, fast-executor can't tell whether a task fell to
  // qa+forbidden because SR said so or because SR never ran —
  // those need different conservative behaviours (G5 short-
  // circuit reads this).
  //
  // routing_status: ok | ok_deterministic | sr_<code> | sr_not_invoked. sr_not_invoked
  // fires when shouldConsultSemanticRouter said yes but neither
  // decision nor rejection was stamped — the LLM-primary classifier
  // is silently missing. ok_deterministic means SR was unavailable or
  // absent, but a narrow deterministic lock already settled the routing
  // axis; local-anchor SR output may still enrich synthesis when it
  // succeeds, but an outage must not make the task refuse.
  const deterministicRoutingLock = hasDeterministicRoutingLock({
    signals,
    contextPacket: enrichedContext,
    toolPolicy,
    text
  });
  const srWasEligible = !srDecision && !srRejection
    && shouldConsultSemanticRouter({ signals, contextPacket: enrichedContext, text });
  const routingStatus = srDecision
    ? "ok"
    : deterministicRoutingLock
      ? "ok_deterministic"
      : srRejection?.code
      ? `sr_${srRejection.code}`
      : srWasEligible
        ? "sr_not_invoked"
        : "ok";

  // P4-RQ G6b: routing_degraded — boolean derived from routing_status.
  // True when the SR preflight was actually called AND failed
  // operationally (transient fault that prevented SR from forming
  // a verdict). False when SR ran successfully, when SR was never
  // consulted, OR when the operator explicitly opted out.
  //
  // Read by fast-executor's pre-LLM short-circuit (G5b) as the
  // PRIMARY gate. This replaces the previous "routing_status != ok
  // AND research_signals_present" composition because:
  //   - "research_signals_present" tried to gate on user-text
  //     surface (explicit_search etc.) — but missed real research-
  //     class queries like "下周天气" that have no explicit search
  //     verb. The user's directive: read framework state, not
  //     user text.
  //   - "routing_degraded" reads framework state directly: was SR
  //     consulted, did it fail. If yes, the deterministic
  //     fallback for non-explicit-signal queries is unreliable —
  //     fast must surface the degradation honestly.
  //
  // Degraded = LLM-primary classifier missing (operational failure or
  // silently not invoked). Non-degraded = SR ran or operator opted out.
  const DEGRADED_ROUTING_CODES = new Set([
    "sr_timeout",
    "sr_exception",
    "sr_no_provider",
    "sr_schema_invalid",
    "sr_not_invoked"
  ]);
  const routingDegraded = DEGRADED_ROUTING_CODES.has(routingStatus);

  // P4-RQ G5b (legacy): research_signals_present — kept for
  // observability and potential future consumers. NO LONGER read
  // by fast-executor's short-circuit (G6b switched that gate to
  // routing_degraded). Stays as a derived task_spec flag for
  // audit / decision-trace clarity.
  const researchSignalsPresent = Boolean(
    signals?.explicit_search?.matched
    || signals?.explicit_external?.matched
    || toolPolicy?.policy_groups?.external_web_read?.mode === "required"
  );

  const srRequiredPolicyGroups = requiredPolicyGroupsFromIntentRoute(srDecision, {
    text,
    contextPacket: enrichedContext
  });
  const synthesis = {
    user_goal: typeof srDecision?.user_goal === "string" && srDecision.user_goal.trim()
      ? srDecision.user_goal.trim()
      : text,
    expected_output: expectedOutputFromIntentRoute(srDecision, srRequiredPolicyGroups),
    primary_intent: typeof srDecision?.primary_intent === "string"
      ? srDecision.primary_intent
      : null
  };
  const executionConstraints = buildResearchExecutionConstraints(researchQuality);
  const mustUseTools = goal !== "qa" || connectorDomainRequest || srRequiredPolicyGroups.length > 0;

  const partialSpec = {
    goal,
    user_goal_text: text,
    topic: text.slice(0, 100),
    needs_current_web_data: toolPolicy.web_search_fetch.mode === "required",
    tool_policy: toolPolicy,
    research_quality: researchQuality,
    ...(executionConstraints ? { execution_constraints: executionConstraints } : {}),
    synthesis,
    // G4: framework-state flags read by executor-resolver Rule 5
    // extension and fast-executor short-circuit (G5/G6b).
    routing_status: routingStatus,
    routing_degraded: routingDegraded,        // G6b — primary fast-guard gate
    connector_domain: connectorDomainRequest,
    research_signals_present: researchSignalsPresent,  // G5b legacy — observability
    artifact: {
      required: artifactRequired,
      kind: fileArtifactKind,
      quality: "draft"
    },
    source,
    constraints: {
      language: "zh-CN",
      can_split: !artifactRequired && !["generate_document", "analyze_and_report", "transform_existing_file"].includes(goal),
      must_use_tools: mustUseTools,
      must_verify_artifact: artifactRequired
    },
    required_steps: [],
    success_contract: {
      artifact_created: artifactRequired,
      artifact_registered: artifactRequired,
      tool_called: mustUseTools,
      required_tool_names: [],
      // P4-00.7: group-level requirements. Validator counts any member of
      // the group as satisfying the requirement — used so the LLM can pick
      // fetch_url_content or web_search when web_search_fetch returns
      // nothing without tripping the success contract.
      required_policy_groups: srRequiredPolicyGroups
    },
    intent_tags: mergedIntentTags,
    suggested_formats: mergedSuggestedFormats
  };
  // Note-capture and image flows have legacy hard hand-offs (multi_modal /
  // agentic). For them we honour the legacy mapping but still record an
  // ExecutorDecision so the resolver path is uniform downstream.
  let executorDecision;
  if (noteIntent) {
    executorDecision = {
      executor: imageDriven ? "multi_modal" : "agentic",
      reason: imageDriven ? "Note capture with image content" : "Note capture",
      evidence: [{ type: "context", source: "note-intent", reason: "hasNoteTakingIntent" }],
      rejected: []
    };
  } else {
    executorDecision = resolveExecutor({
      taskSpec: partialSpec,
      toolPolicy,
      contextPacket: enrichedContext,
      routeSuggestion: intentRouterResult.suggested_executor
    });
  }
  tracker.record(STAGES.EXECUTOR_SELECTION, {
    output: { executor: executorDecision.executor },
    reason: executorDecision.reason,
    evidence: executorDecision.evidence,
    rejected: executorDecision.rejected
  });

  const spec = {
    ...partialSpec,
    suggested_executor: executorDecision.executor,
    executor_decision: executorDecision,
    decision_trace: tracker.entries()
  };

  // UCA-077 P2-04: attach a structured TaskContract alongside the legacy
  // TaskSpec. Existing consumers ignore this field; new consumers (Phase 3
  // graph executor, planning specialists) read `spec.contract` instead of
  // re-deriving intent from a half-dozen TaskSpec fields.
  spec.contract = compileTaskContract({ taskSpec: spec, signals, contextPacket: enrichedContext });

  return applyHardenedRules(spec);
}

function collectGoalEvidence(signals, { noteIntent, artifactEditIntent }) {
  const evidence = [];
  if (noteIntent) evidence.push({ type: "context", source: "note-intent", reason: "hasNoteTakingIntent" });
  if (artifactEditIntent) evidence.push({ type: "context", source: "artifact-edit-intent", reason: "hasArtifactRefinementIntent" });
  // F2: evidence list extended with semantic_router. topic_hint
  // kept as OBSERVABILITY-ONLY evidence — it no longer participates
  // in the goal classifier's decision (see GOAL_RULES requiresSignal),
  // but a topic match alongside a goal=search_and_answer still
  // surfaces in the trace so operators can see corroborating
  // signals.
  for (const name of ["explicit_external", "semantic_router", "topic_hint", "source_scope"]) {
    const signal = signals?.[name];
    if (signal?.matched) evidence.push(...signal.evidence);
  }
  return evidence;
}

function rejectedToolPolicyModes(chosen) {
  return ["forbidden", "optional", "required"]
    .filter((mode) => mode !== chosen)
    .map((mode) => ({ candidate: mode, reason: `not selected by tool-policy resolver (chose ${chosen})` }));
}

// ---------------------------------------------------------------------------
// applyHardenedRules — enforce non-overridable execution constraints
// ---------------------------------------------------------------------------
//
// UCA-077 P1-05: deriveExecutor() was deleted. Executor selection now goes
// through `planning/executor-resolver.mjs`, called inside createTaskSpec.
// ---------------------------------------------------------------------------

/**
 * Mutates spec.required_steps and spec.success_contract in place,
 * then returns the updated spec.
 * @param {TaskSpec} spec
 * @returns {TaskSpec}
 */
export function applyHardenedRules(spec) {
  const steps = [];

  // UCA-077 P1-05: Rule 1 used to deterministically push "web_search_fetch"
  // into required_steps whenever any weak freshness regex matched. The
  // tool-policy resolver is now the only place that decides whether
  // web_search_fetch is required.
  //
  // P4-00.7 (revised §18.6.1.A): pull this off the canonical group entry
  // and stamp ONLY `required_policy_groups`. The previous version also
  // pushed "web_search_fetch" into `required_tool_names` for prompt
  // back-compat, but that recreated the exact contradiction the group
  // semantics was meant to remove — the agentic Rule 1 told the LLM to
  // call web_search_fetch specifically, even though the validator now
  // accepts any sibling. Prompt-builder now renders required_policy_groups
  // verbatim (with applies_to) so the LLM sees the group-level constraint.
  // `required_tool_names` is reserved for *toolId-specific* hard rules
  // (e.g. open_or_reveal_file → open_file).
  const externalWebMode = spec.tool_policy?.policy_groups?.external_web_read?.mode
    ?? spec.tool_policy?.web_search_fetch?.mode;
  if (externalWebMode === "required") {
    if (!spec.success_contract.required_policy_groups.includes("external_web_read")) {
      spec.success_contract.required_policy_groups.push("external_web_read");
    }
  }

  // Rule 2: artifact required → must synthesize before generating.
  // UCA-077 P1-05: the legacy web_search_fetch guard was removed because
  // required_steps no longer carries that hint; the policy layer does.
  if (spec.artifact.required) {
    if (spec.goal === "generate_document") {
      steps.push("synthesize");
    }
    steps.push("generate_artifact");
    steps.push("verify_file_exists");
    steps.push("register_artifact");
    spec.success_contract.artifact_created = true;
    spec.success_contract.artifact_registered = true;
  }

  // Rule 3: open_or_reveal_file → must resolve → verify → open in sequence
  if (spec.goal === "open_or_reveal_file") {
    steps.length = 0; // clear, order matters
    steps.push("resolve_output_path");
    steps.push("verify_file_exists");
    steps.push("open_file");
    spec.success_contract.required_tool_names = ["open_file"];
  }

  // Rule 4: launch_and_act → must call launch_app tool
  if (spec.goal === "launch_and_act") {
    spec.success_contract.tool_called = true;
    if (!spec.success_contract.required_tool_names.includes("launch_app")) {
      spec.success_contract.required_tool_names.push("launch_app");
    }
  }

  // Rule 4b: transform_existing_file → must actually edit the existing file,
  // not silently fall back to synthesizing a brand-new artifact.
  if (spec.goal === "transform_existing_file") {
    if (!spec.success_contract.required_tool_names.includes("edit_file")) {
      spec.success_contract.required_tool_names.push("edit_file");
    }
  }

  // Rule 5: translate → fast path, no tools needed
  if (spec.goal === "translate") {
    spec.constraints.must_use_tools = false;
    spec.success_contract.tool_called = false;
  }

  spec.required_steps = steps;
  return spec;
}

// ---------------------------------------------------------------------------
// validateTaskSpec — schema check before handing to executor
// ---------------------------------------------------------------------------

/**
 * @param {TaskSpec} spec
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateTaskSpec(spec) {
  const errors = [];

  if (!spec || typeof spec !== "object") {
    return { valid: false, errors: ["spec must be an object"] };
  }
  if (!GOAL_FAMILIES.includes(spec.goal)) {
    errors.push(`Unknown goal family: "${spec.goal}". Must be one of: ${GOAL_FAMILIES.join(", ")}`);
  }
  if (typeof spec.user_goal_text !== "string" || !spec.user_goal_text.trim()) {
    errors.push("user_goal_text must be a non-empty string");
  }
  if (typeof spec.needs_current_web_data !== "boolean") {
    errors.push("needs_current_web_data must be a boolean");
  }
  if (!spec.artifact || typeof spec.artifact !== "object") {
    errors.push("artifact must be an object");
  }
  if (spec.artifact?.required && !spec.artifact?.kind) {
    errors.push("artifact.kind must be specified when artifact.required is true");
  }

  return { valid: errors.length === 0, errors };
}
