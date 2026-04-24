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
import { extractPureLaunchApp } from "./router/fast-path-router.mjs";

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
 * @property {string} suggested_executor       - executor hint (not final — task-runtime decides)
 * @property {string[]} intent_tags            - multi-label tags from intent-router
 * @property {string[]} suggested_formats      - detected output formats
 */

// ---------------------------------------------------------------------------
// Goal classification rules (word-boundary safe, no substring traps)
// ---------------------------------------------------------------------------

const GOAL_RULES = [
  // translate — highest confidence, check first
  {
    goal: "translate",
    patterns: [/\b(翻译|translate|translation)\b/i]
  },
  // multimodal — image/screenshot/OCR input
  {
    goal: "multimodal_analyze",
    patterns: [/(图片|image|截图|screenshot|ocr|视觉|vision)/i]
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
  // search_and_answer — explicitly needs current/latest data
  {
    goal: "search_and_answer",
    patterns: [
      /\b(搜索|search|最新|latest|recent|新闻|news|动态|资讯|热点|今日|today|tomorrow|weather|forecast)\b/i,
      /(天气|气温|明天|后天|明日|汇率|股价|航班|机票|酒店|价格)/i
    ]
  }
  // fallback: "qa" — handled in classifyGoal()
];

/**
 * Determine the goal family from user text.
 * Returns the first matching goal, or "qa" as fallback.
 * @param {string} text
 * @returns {string}
 */
export function classifyGoal(text) {
  const raw = String(text ?? "");
  if (extractPureLaunchApp(raw)) {
    return "launch_and_act";
  }
  if (isConnectorDomainRequest(raw)) {
    return "search_and_answer";
  }
  for (const rule of GOAL_RULES) {
    if (rule.patterns.some((pat) => pat.test(raw))) {
      return rule.goal;
    }
  }
  return "qa";
}

// ---------------------------------------------------------------------------
// Detect whether user intent needs real-time web data
// ---------------------------------------------------------------------------

const WEB_DATA_PATTERNS = [
  /(最新|最近|今日|今天|今年|本周|这周|周末|下周|本月|明天|后天|明日|天气|气温|新闻|动态|资讯|热点|搜索|局势|行情|变化|价格|汇率|股价|航班|机票|酒店)/i,
  /\b(latest|recent|today|tomorrow|current|news|search|weather|forecast|price|stock|flight|hotel)\b/i
];

function needsCurrentWebData(text) {
  if (isConnectorDomainRequest(text)) return false;
  return WEB_DATA_PATTERNS.some((p) => p.test(text));
}

const NOTE_INTENT_PATTERNS = [
  /(?:笔记|筆記|纪要|會議紀要|会议记录|會議記錄|meeting\s+notes?|study\s+notes?|class\s+notes?)/i,
  /(?:记一下|記一下|记录一下|記錄一下|整理成(?:笔记|筆記|纪要)|总结成(?:笔记|筆記|纪要)|写成(?:笔记|筆記|纪要)|做成(?:笔记|筆記|纪要))/i,
  /\b(?:note|notes|minutes)\b/i
];

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
  if (extractPureLaunchApp(text)) {
    return [];
  }
  return FORMAT_PATTERNS
    .filter(({ pattern }) => pattern.test(text))
    .map(({ format }) => format);
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
  const noteIntent = hasNoteTakingIntent(text, contextPacket);
  const imageDriven = Array.isArray(contextPacket?.image_paths) && contextPacket.image_paths.length > 0;
  let goal = classifyGoal(text);
  if (noteIntent) {
    goal = imageDriven ? "multimodal_analyze" : "analyze_and_report";
  }
  const suggestedFormats = detectFormats(text);
  const explicitFileArtifactKind = noteIntent
    ? (suggestedFormats.includes("md") ? "md" : null)
    : (suggestedFormats.find((f) => FILE_ARTIFACT_FORMATS.has(f)) ?? null);
  const inferredFileArtifactKind = ["generate_document", "analyze_and_report", "transform_existing_file", "multimodal_analyze"].includes(goal)
    ? (noteIntent ? "md" : "docx")
    : null;
  const fileArtifactKind = explicitFileArtifactKind ?? inferredFileArtifactKind;
  const artifactRequired = noteIntent ||
    FILE_ARTIFACT_FORMATS.has(fileArtifactKind) ||
    goal === "generate_document" ||
    goal === "analyze_and_report" ||
    goal === "transform_existing_file";
  const connectorDomainRequest = isConnectorDomainRequest(text);
  const webDataNeeded = !connectorDomainRequest && (
    needsCurrentWebData(text) ||
    goal === "search_and_answer"
  );

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

  const spec = {
    goal,
    user_goal_text: text,
    topic: text.slice(0, 100),
    needs_current_web_data: webDataNeeded,
    artifact: {
      required: artifactRequired,
      kind: fileArtifactKind,
      quality: "draft"
    },
    source,
    constraints: {
      language: "zh-CN",
      can_split: !artifactRequired && !["generate_document", "analyze_and_report", "transform_existing_file"].includes(goal),
      must_use_tools: goal !== "qa",
      must_verify_artifact: artifactRequired
    },
    required_steps: [],
    success_contract: {
      artifact_created: artifactRequired,
      artifact_registered: artifactRequired,
      tool_called: goal !== "qa",
      required_tool_names: []
    },
    // Preserve intent_tags and executor hints from existing router result
    suggested_executor: noteIntent
      ? (imageDriven ? "multi_modal" : "agentic")
      : (intentRouterResult.suggested_executor ?? deriveExecutor(goal, artifactRequired, webDataNeeded)),
    intent_tags: mergedIntentTags,
    suggested_formats: mergedSuggestedFormats
  };

  return applyHardenedRules(spec);
}

// ---------------------------------------------------------------------------
// Derive executor from goal family (fallback when routeIntent result missing)
// ---------------------------------------------------------------------------

function deriveExecutor(goal, artifactRequired, webDataNeeded) {
  if (goal === "translate") return "translate";
  if (goal === "multimodal_analyze") return "multi_modal";
  if (goal === "qa") return "fast";
  if (goal === "generate_document" || goal === "analyze_and_report" || artifactRequired || webDataNeeded) {
    return "agentic";
  }
  return "tool_using";
}

// ---------------------------------------------------------------------------
// applyHardenedRules — enforce non-overridable execution constraints
// ---------------------------------------------------------------------------

/**
 * Mutates spec.required_steps and spec.success_contract in place,
 * then returns the updated spec.
 * @param {TaskSpec} spec
 * @returns {TaskSpec}
 */
export function applyHardenedRules(spec) {
  const steps = [];

  // Rule 1: needs current web data → FIRST step must be web search
  if (spec.needs_current_web_data) {
    steps.push("web_search_fetch");
    if (!spec.success_contract.required_tool_names.includes("web_search_fetch")) {
      spec.success_contract.required_tool_names.push("web_search_fetch");
    }
  }

  // Rule 2: artifact required → must synthesize before generating
  if (spec.artifact.required) {
    if (!steps.includes("web_search_fetch") && spec.goal === "generate_document") {
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
