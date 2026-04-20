/**
 * Pre-execution triggers.
 *
 * The trigger is *only* a cheap detector — it answers "does this command
 * mention any one-shot time phrase?" — nothing else. The meaning of that
 * phrase (scheduling delay vs event-time data vs reminder argument) is
 * decided by the understanding LLM (see understand.mjs).
 *
 * History: Week 1 initially shipped a "fast path" that tried to bypass the
 * LLM when the time phrase looked simple enough. That was the exact
 * regex-classifier anti-pattern we were trying to delete — it mis-routed
 *   "打开 outlook，在日历里新建一个 30 分钟的任务，标题叫吃饭。时间在明天下午1点"
 *   "明天下午1点在日历里加一个 30 分钟的吃饭"
 * as schedules for later instead of immediate calendar-event creation with
 * the time as event data. The fix is not "add more heuristics", it's "stop
 * pretending regex can tell scheduling-time from event-time". Week 1-revised
 * deletes the fast path: every time-phrase command goes through the LLM.
 */

const TIME_PHRASE_RE = /((\d+)\s*(分钟|分|小时|时|天|minutes?|mins?|hours?|hrs?|days?)\s*(?:以?后|之后|later|from\s+now)|(?:in|after)\s+(\d+)\s*(分钟|分|小时|时|天|minutes?|mins?|hours?|hrs?|days?)|(今天|今晚|明天|后天|tonight|tomorrow)(?:\s*(上午|下午|晚上|morning|afternoon|evening|night))?\s*(\d{1,2})\s*(?:[:：](\d{1,2}))?\s*(点|时|:00)?(?:\s*(am|pm))?)/i;

const RECURRING_HINT_RE = /(每\s*\d|每天|每周|每月|工作日|every\s+(?:\d|day|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekday|hour|minute)|daily|weekly|monthly|hourly)/i;

/**
 * Does the command mention any one-shot time phrase? Recurring phrases
 * (every / 每) are excluded because they're handled by the existing
 * scheduler cron/interval path.
 */
export function hasTimePhrase(userCommand) {
  const text = String(userCommand ?? "");
  if (!text.trim()) return false;
  if (RECURRING_HINT_RE.test(text)) return false;
  return TIME_PHRASE_RE.test(text);
}

export function shouldRunTaskPlan(userCommand /*, contextPacket */) {
  if (hasTimePhrase(userCommand)) return "time_phrase";
  return null;
}
