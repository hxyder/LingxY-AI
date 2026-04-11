const RULES = [
  { keywords: ["图片", "image", "截图", "screenshot", "ocr"], intent: "describe_image", executor: "multi_modal", requires_confirmation: false },
  { keywords: ["报告", "report", "分析", "analyze", "analyse"], intent: "generate_report", executor: "kimi", requires_confirmation: true },
  { keywords: ["邮件", "email", "搜索", "search", "新闻", "消息", "要闻", "时政", "最新", "最近", "动态", "资讯", "热点", "latest", "recent", "news", "current", "打开", "open", "启动", "运行", "launch", "start", "run", "复制", "clipboard", "通知", "notify", "定时", "schedule", "每天", "每周", "提醒"], intent: "act", executor: "tool_using", requires_confirmation: false },
  { keywords: ["总结", "summarize", "summary"], intent: "summarize", executor: "fast" },
  { keywords: ["翻译", "translate"], intent: "translate", executor: "translate" },
  { keywords: ["改写", "rewrite"], intent: "rewrite", executor: "fast" },
  { keywords: ["解释", "explain"], intent: "explain", executor: "fast" }
];

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
  { tag: "analyze", patterns: [/(分析|analyze|analyse|breakdown|研究)/i] },
  { tag: "summarize", patterns: [/(总结|summarize|summary|摘要)/i] },
  { tag: "translate", patterns: [/(翻译|translate)/i] },
  { tag: "rewrite", patterns: [/(改写|rewrite|润色|polish)/i] },
  { tag: "explain", patterns: [/(解释|explain)/i] },
  { tag: "describe_image", patterns: [/(图片|image|截图|screenshot|ocr)/i] },
  { tag: "generate_report", patterns: [/(报告|report)/i] },
  { tag: "search", patterns: [/(搜索|search|news|最新|最近|新闻|资讯)/i] },
  { tag: "launch_app", patterns: [/(启动|launch|打开\s*应用|run\s+app)/i] },
  { tag: "file_action", patterns: [/(\bfile\b|文件|复制到|copy\s+to|move|rename|delete)/i] },
  { tag: "clipboard", patterns: [/(剪贴板|clipboard)/i] },
  { tag: "notify", patterns: [/(通知|notify|提醒)/i] },
  { tag: "schedule", patterns: [/(定时|schedule|每天|每周|cron)/i] },
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
  "analyze",
  "generate_report",
  "search"
]);

function deriveIntentTags(text) {
  const tags = [];
  for (const rule of TAG_PATTERNS) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      tags.push(rule.tag);
    }
  }
  return tags;
}

function deriveSuggestedFormats(text) {
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
  const text = raw.toLowerCase();
  const matched = RULES.find((rule) => rule.keywords.some((keyword) => text.includes(keyword.toLowerCase())));

  const intent_tags = deriveIntentTags(raw);
  const suggested_formats = deriveSuggestedFormats(raw);

  // Decide whether to prefer the agentic executor. We upgrade the suggestion
  // when the request clearly needs multi-step tool use:
  //   1. Output format is a file that the universal tool belt can produce
  //   2. The intent tags include analyze / generate_report / search
  //   3. There's both a single-shot tag (e.g. summarize) *and* a file format
  const requiresFileArtifact = suggested_formats.some((format) => FILE_PRODUCING_FORMATS.has(format));
  const hasAgenticTag = intent_tags.some((tag) => AGENTIC_TRIGGERING_TAGS.has(tag));

  if (!matched) {
    const suggested_executor = requiresFileArtifact || hasAgenticTag ? "agentic" : "fast";
    return {
      intent: "general",
      executor: suggested_executor,
      suggested_executor,
      intent_tags,
      suggested_formats,
      requires_confirmation: false
    };
  }

  // Upgrade the matched executor to agentic when the request needs
  // multi-step tool use. The dedicated translate/rewrite/explain paths
  // stay on their single-shot executor — they're cheap and deterministic.
  // multi_modal keeps its vision-first routing; an image analysis task
  // stays on the multi_modal executor even if "analyze" is a tag.
  const isSingleShot = matched.executor === "translate"
    || matched.executor === "multi_modal"
    || (matched.executor === "fast" && ["rewrite", "explain", "summarize"].includes(matched.intent));
  const suggested_executor = (!isSingleShot && (requiresFileArtifact || hasAgenticTag))
    ? "agentic"
    : matched.executor;

  return {
    intent: matched.intent,
    executor: suggested_executor,
    suggested_executor,
    intent_tags,
    suggested_formats,
    requires_confirmation: matched.requires_confirmation ?? false
  };
}
