// UCA-052: Legacy RULES table kept for intent label back-compat only.
// Executor selection is now primarily driven by TaskSpec goal family
// (see classifyGoal() in task-spec.mjs). These keyword lists are word-boundary
// safe and no longer use raw text.includes() which caused false matches
// ("profile" triggering file_action, "lifestyle" triggering file_action, etc.).
// Rule ordering matters: more-specific / higher-priority intents come first.
// Content-processing verbs (总结/翻译/改写) must precede noun-based tool rules
// so "总结剪贴板内容" resolves to summarize, not act.
//
// NOTE on \b: JavaScript \b only works between \w ([a-zA-Z0-9_]) and \W.
// Chinese characters are all \W, so \b never fires between two Chinese chars.
// For Chinese-only alternatives we omit \b; for English we keep it.
// IMPORTANT: these RULES used to be a regex classifier that decided which
// executor a task went to — and because of that, they ate all the problems
// the agent-loop was supposed to solve. Commands containing "图片" went to
// multi_modal without any image attached; commands that didn't match any
// rule defaulted to fast (no tools) and the LLM could only fake a response.
//
// In the single-brain architecture (see docs/task-runtime/ARCHITECTURE.md)
// the LLM in agent-loop is the decision maker. These rules now serve as
// HINTS that upgrade to agentic for file-producing tasks, while everything
// else lands in tool_using — an executor with the full tool belt that can
// ALSO handle trivial Q&A (the LLM just returns {final:"..."} if it doesn't
// need a tool). The retired regex classifier entries live in
// src/service/core/intent/archive/retired-intent-rules.md.
const ANALYZE_ACTION_PATTERN = /(^|[，,。；;\s]|请|帮我|麻烦你)(分析(?!师)|研究(?!生)|\banaly[sz]e\b|\banalysis\b|\bbreak\s*down\b)/i;

const RULES = [
  // Semantic intent labels (preserved for logging / downstream consumers)
  // — these used to route to `fast` and broke tasks like
  // "总结桌面上的 report.pdf" where the LLM needed file_read. They now all
  // land in tool_using; the LLM returns {final:"..."} without a tool call
  // when the content is inline, and can call tools when needed.
  { patterns: [/(总结|摘要|\bsummarize\b|\bsummary\b)/i], intent: "summarize", executor: "tool_using" },
  { patterns: [/(翻译|\btranslate\b)/i], intent: "translate", executor: "translate" },
  { patterns: [/(改写|润色|\brewrite\b|\bpolish\b)/i], intent: "rewrite", executor: "tool_using" },
  { patterns: [/(解释|\bexplain\b)/i], intent: "explain", executor: "tool_using" },
  // Action/tool rules — all land in tool_using (agent-loop with full belt)
  { patterns: [/(报告|\breport\b)/i, ANALYZE_ACTION_PATTERN], intent: "generate_report", executor: "agentic", requires_confirmation: false },
  { patterns: [/(邮件|邮箱|gmail|outlook|连接账户|已连接账户|账户|账号|\bemail\b|\bmail\b|connected\s+accounts?)/i], intent: "act", executor: "tool_using", requires_confirmation: false },
  { patterns: [/(搜索|查一下|查找|查询|帮我查|\bgoogle\b|\bbing\b|\bbaidu\b|百度一下|新闻|最新|最近|动态|资讯|热点|\blatest\b|\brecent\b|\bnews\b|\bcurrent\b|\bsearch\b)/i], intent: "act", executor: "tool_using", requires_confirmation: false },
  { patterns: [/(机票|航班|订票|flight|ticket|hotel|酒店|天气|weather|汇率|exchange.*rate|股价|股票|price.*(?:of|for)|查.*(?:价|票|班|房))/i], intent: "act", executor: "tool_using", requires_confirmation: false },
  { patterns: [/(启动|\blaunch\b)|(打开|\bopen\b|运行|\brun\b).{0,20}(应用|\bapp\b|程序|\bsoftware\b)/i], intent: "act", executor: "tool_using", requires_confirmation: false },
  // Clipboard copy — only when the primary verb is copy/复制, not when it's just the data source
  { patterns: [/(复制|\bcopy\b).{0,20}(剪贴板|\bclipboard\b)|(剪贴板|\bclipboard\b).{0,20}(复制|\bcopy\b)/i], intent: "act", executor: "tool_using", requires_confirmation: false },
  { patterns: [/(通知|\bnotify\b|定时|\bschedule\b|每天|每周|提醒)/i], intent: "act", executor: "tool_using", requires_confirmation: false }
];

// UCA-051/052: import goal classification from task-spec
import { classifyGoal } from "../task-spec.mjs";
import { isConnectorDomainRequest } from "../../connectors/core/connector-intent.mjs";
import { extractLaunchAppCandidates, extractPureLaunchApp } from "./fast-path-router.mjs";

/* ------------------------------------------------------------------------ */
/* UCA-049 commit 2: intent_tags multi-label routing                         */
/*                                                                           */
/* Tag taxonomy (informational — not a hard schema):                         */
/*   analyze, summarize, translate, rewrite, explain, describe_image,        */
/*   generate_report, generate_document, search, launch_app, file_action,    */
/*   clipboard, notify, schedule, act                                        */
/*                                                                           */
/* Format taxonomy:                                                          */
/*   pptx, docx, xlsx, pdf, html, md, json, csv, txt                         */
/*                                                                           */
/* When at least one tag indicates a file-producing or multi-step intent,    */
/* the router suggests the `agentic` executor instead of a single-executor   */
/* fallback. The submission layer is free to override.                       */
/* ------------------------------------------------------------------------ */

const TAG_PATTERNS = [
  { tag: "analyze", patterns: [ANALYZE_ACTION_PATTERN] },
  { tag: "summarize", patterns: [/(总结|summarize|summary|摘要)/i] },
  { tag: "translate", patterns: [/(翻译|translate)/i] },
  { tag: "rewrite", patterns: [/(改写|rewrite|润色|polish)/i] },
  { tag: "explain", patterns: [/(解释|explain)/i] },
  { tag: "describe_image", patterns: [/(图片|image|截图|screenshot|ocr)/i] },
  { tag: "generate_report", patterns: [/(报告|report)/i] },
  { tag: "search", patterns: [/(搜索|search|news|最新|最近|新闻|资讯|查一下|查询|查找|google|bing|机票|航班|天气|weather|flight|hotel|酒店)/i] },
  { tag: "connector", patterns: [/(邮件|邮箱|gmail|outlook|连接账户|已连接账户|账户|账号|google\s*drive|onedrive|日历|calendar|\bemail\b|\bmail\b|connected\s+accounts?)/i] },
  { tag: "launch_app", patterns: [/(启动|launch|打开\s*应用|run\s+app)/i] },
  { tag: "file_action", patterns: [/(\bfile\b|文件|复制到|copy\s+to|move|rename|delete)/i] },
  { tag: "clipboard", patterns: [/(剪贴板|clipboard)/i] },
  { tag: "notify", patterns: [/(通知|notify|提醒)/i] },
  { tag: "schedule", patterns: [/(定时|schedule|每天|每周|cron|(?:提醒.*(?:明天|今天|上午|下午|\d+\s*点))|(?:(?:明天|今天|上午|下午|\d+\s*点).*提醒))/i] },
  { tag: "act", patterns: [/(打开|open|运行|run)/i] }
];

const FORMAT_PATTERNS = [
  { format: "pptx", patterns: [/(\.pptx|pptx|powerpoint|\bppt\b|幻灯片|演示文稿|演示文档|slides?|slideshow)/i] },
  { format: "docx", patterns: [/(\.docx|docx|word\s*文档|word\s*文件|\bword\b|文档格式)/i] },
  { format: "xlsx", patterns: [/(\.xlsx|xlsx|excel|电子表格|表格文件|spreadsheet)/i] },
  { format: "pdf", patterns: [/(\.pdf|pdf)/i] },
  { format: "html", patterns: [/(\.html|\.htm|html|网页格式|网页文件)/i] },
  { format: "json", patterns: [/(\.json|json)/i] },
  { format: "csv", patterns: [/(\.csv|csv|逗号分隔)/i] },
  { format: "md", patterns: [/(\.md|markdown)/i] },
  { format: "txt", patterns: [/(\.txt|txt|纯文本|文本文件)/i] }
];

const FILE_PRODUCING_FORMATS = new Set(["pptx", "docx", "xlsx", "pdf"]);
const AGENTIC_TRIGGERING_TAGS = new Set([
  "act",
  "analyze",
  "clipboard",
  "file_action",
  "generate_report",
  "launch_app",
  "notify",
  "schedule",
  "search"
]);

function deriveIntentTags(text) {
  const connectorDomainRequest = isConnectorDomainRequest(text);
  const tags = [];
  if (extractPureLaunchApp(text) || extractLaunchAppCandidates(text).length > 0) {
    return connectorDomainRequest ? ["act"] : ["launch_app", "act"];
  }
  for (const rule of TAG_PATTERNS) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      if (connectorDomainRequest && rule.tag === "search") continue;
      tags.push(rule.tag);
    }
  }
  return tags;
}

function deriveSuggestedFormats(text) {
  if (extractPureLaunchApp(text) || extractLaunchAppCandidates(text).length > 0) {
    return [];
  }
  const formats = [];
  for (const rule of FORMAT_PATTERNS) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      formats.push(rule.format);
    }
  }
  return formats;
}

export function routeIntent(userCommand = "") {
  const raw = String(userCommand ?? "");
  const pureLaunchApp = extractPureLaunchApp(raw);
  const launchTargets = extractLaunchAppCandidates(raw);
  const connectorDomainRequest = (pureLaunchApp || launchTargets.length > 0) ? false : isConnectorDomainRequest(raw);

  // UCA-051/052: classify goal family first (word-boundary safe, no substring traps)
  const goal = classifyGoal(raw);

  // UCA-052: use pattern matching instead of text.includes() to avoid false positives
  const matched = RULES.find((rule) => rule.patterns.some((pattern) => pattern.test(raw)));

  const intent_tags = deriveIntentTags(raw);
  const suggested_formats = deriveSuggestedFormats(raw);

  // Decide whether to prefer the agentic executor. We upgrade the suggestion
  // when the request clearly needs multi-step tool use:
  //   1. Output format is a file that the universal tool belt can produce
  //   2. The intent tags include analyze / generate_report / search
  //   3. Goal family requires multi-step execution
  const requiresFileArtifact = suggested_formats.some((format) => FILE_PRODUCING_FORMATS.has(format));
  const hasAgenticTag = intent_tags.some((tag) => AGENTIC_TRIGGERING_TAGS.has(tag));
  const goalRequiresAgentic = ["generate_document", "analyze_and_report", "search_and_answer", "open_or_reveal_file", "transform_existing_file", "launch_and_act"].includes(goal)
    && !(connectorDomainRequest && goal === "search_and_answer");

  if (!matched) {
    // Default to tool_using, not fast. The agent-loop with its full tool
    // belt can trivially handle Q&A (just return {final:"..."}) AND has
    // access to tools when the LLM decides the command needs one. fast has
    // no tools, so routing action-intent commands there guarantees
    // hallucinated "I did X" text without X ever happening. Image goals
    // only route to multi_modal here if the submission path didn't already
    // know about an attachment (submitImageTask sets executorOverride
    // directly for real images).
    const suggested_executor = requiresFileArtifact || hasAgenticTag || goalRequiresAgentic
      ? "agentic"
      : goal === "translate" ? "translate"
      : "tool_using";
    return {
      intent: "general",
      goal,
      executor: suggested_executor,
      suggested_executor,
      intent_tags,
      suggested_formats,
      requires_confirmation: false
    };
  }

  // Upgrade the matched executor to agentic when the request needs
  // multi-step tool use or a generated file artifact. Vision tasks keep their
  // multi_modal first hop; otherwise "summarize into pptx/docx" must not stay
  // on the cheap single-shot fast executor.
  const isVisionFirst = matched.executor === "multi_modal";
  const suggested_executor = (!isVisionFirst && (requiresFileArtifact || hasAgenticTag || goalRequiresAgentic))
    ? "agentic"
    : matched.executor;

  return {
    intent: matched.intent,
    goal,
    executor: suggested_executor,
    suggested_executor,
    intent_tags,
    suggested_formats,
    requires_confirmation: matched.requires_confirmation ?? false
  };
}
