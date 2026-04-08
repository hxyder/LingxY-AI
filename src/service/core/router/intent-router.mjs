const RULES = [
  { keywords: ["报告", "report", "分析", "analyze", "analyse"], intent: "generate_report", executor: "kimi", requires_confirmation: true },
  { keywords: ["邮件", "email", "搜索", "search", "打开", "open", "复制", "clipboard", "通知", "notify", "定时", "schedule", "每天", "每周", "提醒"], intent: "act", executor: "tool_using", requires_confirmation: false },
  { keywords: ["总结", "summarize", "summary"], intent: "summarize", executor: "fast" },
  { keywords: ["翻译", "translate"], intent: "translate", executor: "fast" },
  { keywords: ["改写", "rewrite"], intent: "rewrite", executor: "fast" },
  { keywords: ["解释", "explain"], intent: "explain", executor: "fast" }
];

export function routeIntent(userCommand) {
  const text = userCommand.toLowerCase();
  const matched = RULES.find((rule) => rule.keywords.some((keyword) => text.includes(keyword.toLowerCase())));
  if (!matched) {
    return {
      intent: "unknown",
      executor: "none",
      requires_confirmation: false
    };
  }

  return {
    intent: matched.intent,
    executor: matched.executor,
    requires_confirmation: matched.requires_confirmation ?? false
  };
}
