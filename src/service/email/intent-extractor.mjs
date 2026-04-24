function parseAbsoluteDate(text) {
  const match = text.match(/(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})/);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function parseTime(text) {
  const match = text.match(/(\d{1,2})[:点时](\d{1,2})?/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  return { hour, minute };
}

function shiftDate(base, days) {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

function parseRelativeDate(text, base = new Date()) {
  if (/后天/.test(text)) return shiftDate(base, 2);
  if (/明天/.test(text)) return shiftDate(base, 1);
  if (/今天/.test(text)) return base;
  if (/tomorrow/i.test(text)) return shiftDate(base, 1);
  if (/today/i.test(text)) return base;
  return null;
}

function buildDueAt(text) {
  const base = new Date();
  const date = parseAbsoluteDate(text) ?? parseRelativeDate(text, base);
  const time = parseTime(text);
  if (!date && !time) return null;
  const due = date ?? base;
  if (time) {
    due.setHours(time.hour, time.minute, 0, 0);
  }
  return due;
}

function detectActionRequired(text) {
  return /(请|需要|务必|回复|完成|提交|review|respond|action|required|deadline)/i.test(text);
}

// Strip the "1. " / "2. " / "**核心诉求**: " / leading-markdown-bold
// prompt-template prefixes from a summary line. The summarizer prompt
// uses a 3-line template (发件人 / 核心诉求 / 行动) — without this clean
// the schedule names showed up literally as "2. 核心诉求: ...".
function cleanSummaryLine(line) {
  return String(line || "")
    .replace(/^\s*\d+[\.、)]\s*/, "")
    .replace(/^\*+\s*/, "")
    .replace(/^[#>\-]+\s*/, "")
    .replace(/^\*\*([^*]+)\*\*\s*[:：]?\s*/, "$1: ")
    .replace(/^(主题的核心诉求|核心诉求|行动|发件人是谁|发件人)\s*[:：]\s*/, "")
    .trim();
}

export function extractEmailIntent(summaryText = "") {
  const dueAt = buildDueAt(summaryText);
  const actionRequired = detectActionRequired(summaryText);
  const confidence = actionRequired && dueAt ? 0.75 : actionRequired ? 0.45 : 0.2;
  const lines = summaryText.split("\n").map(cleanSummaryLine).filter(Boolean);
  // Prefer the action line (line 3 of the prompt template) when it isn't
  // the "无明确行动" placeholder; otherwise fall back to the topic line.
  const actionLine = lines[2] && !/无明确行动/.test(lines[2]) ? lines[2] : null;
  const suggestedTitle = (actionLine ?? lines[1] ?? lines[0] ?? "邮件任务").slice(0, 80);
  return {
    actionRequired,
    dueAt: dueAt ? dueAt.toISOString() : null,
    suggestedTitle,
    confidence
  };
}
