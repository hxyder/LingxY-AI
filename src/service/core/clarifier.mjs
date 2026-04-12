/**
 * UCA-059 — Ambiguity detection (Clarify-Before-Act).
 *
 * Checks whether a user command contains an unresolvable reference that would
 * cause the executor to either fail or make a wrong guess. When detected, the
 * caller should return a `clarification_needed` response and show a follow-up
 * question bubble instead of creating a task.
 *
 * Design philosophy (LangGraph human-in-the-loop / AutoGen human proxy):
 *   Only block when the missing information is REQUIRED to make any progress.
 *   A command like "帮我搜索最新 AI 新闻" is complete — don't ask questions.
 *   A command like "发邮件" with no recipient is incomplete — ask.
 */

const AMBIGUITY_RULES = [
  // ── Bare pronoun references ─────────────────────────────────────────────
  // "打开它" / "那个文件" / "上次的那个" need a referent.
  {
    id: "unresolved_pronoun",
    pattern: /(?:^|[\s，,。])(?:打开|处理|分析|总结|翻译|发|找|查看)?\s*(?:那个|这个|它(?!们)|上次|之前|the\s+(?:file|document|one)|that\s+one)/i,
    question: "你指的是哪个文件或内容？请告诉我文件名或具体描述。"
  },

  // ── Email without recipient ─────────────────────────────────────────────
  // "帮我发邮件" / "起草邮件" with no "给 X" / "to X" / "@"
  {
    id: "email_no_recipient",
    pattern: /(?:发|起草|写|compose|draft|send)\s*(?:一封|an?\s+)?\s*(?:邮件|email)/i,
    check(cmd) {
      // passes (no ambiguity) when a recipient is already present
      return !/(给|to\s+\w|@\w)/.test(cmd);
    },
    question: "这封邮件发给谁？（可以告诉我姓名或邮箱地址）"
  },

  // ── Bare reminder with no content ──────────────────────────────────────
  // "提醒我" alone — missing both content and time.
  {
    id: "remind_no_content",
    pattern: /^(?:请?帮(?:我|我)?)?提醒(?:我|一下)?[。！!]?\s*$/i,
    question: "提醒你什么内容？以及什么时间？"
  },

  // ── File open without any path or identifier ────────────────────────────
  // "打开文件" / "open the file" — no extension, path, or name.
  {
    id: "open_file_no_path",
    pattern: /(?:打开|open)\s*(?:这个|那个|the)?\s*(?:文件|file)\s*(?:[。！!，,]|$)/i,
    check(cmd) {
      // passes when a real path, extension, or quoted name is present
      return !(/[./\\]|[""'"]/.test(cmd));
    },
    question: "请问是哪个文件？可以告诉我文件名、路径或关键词吗？"
  }
];

/**
 * Detect whether a user command contains an unresolvable ambiguity.
 *
 * @param {string} userCommand
 * @returns {{ needsClarification: boolean, question?: string, ruleId?: string }}
 */
export function detectAmbiguity(userCommand) {
  if (!userCommand || typeof userCommand !== "string") {
    return { needsClarification: false };
  }

  const cmd = userCommand.trim();

  for (const rule of AMBIGUITY_RULES) {
    if (!rule.pattern.test(cmd)) continue;
    // If the rule has an additional predicate, it must return true to trigger
    if (typeof rule.check === "function" && !rule.check(cmd)) continue;

    return {
      needsClarification: true,
      question: rule.question,
      ruleId: rule.id
    };
  }

  return { needsClarification: false };
}
