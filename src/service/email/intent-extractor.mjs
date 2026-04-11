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

export function extractEmailIntent(summaryText = "") {
  const dueAt = buildDueAt(summaryText);
  const actionRequired = detectActionRequired(summaryText);
  const confidence = actionRequired && dueAt ? 0.75 : actionRequired ? 0.45 : 0.2;
  return {
    actionRequired,
    dueAt: dueAt ? dueAt.toISOString() : null,
    suggestedTitle: summaryText.split("\n")[1] ?? "邮件任务",
    confidence
  };
}
