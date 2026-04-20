/**
 * Pure-code triggers that decide whether an incoming user command needs the
 * TaskPlan pre-execution layer. Zero LLM calls here — just regex + structural
 * checks, so unshifting this in front of the normal submit/route flow costs
 * microseconds.
 *
 * Current Week-1 scope is the time-offset detector: "5 分钟后 / 明天上午 9
 * 点 / in 10 minutes" style phrases. When it fires, the plan-executor
 * redirects the whole command to the scheduler instead of executing now.
 *
 * Future additions (Weeks 2-4) will land here as new detect* functions:
 *   - detectQuantifier ("所有的图片/every file")
 *   - detectMultiVerb ("search 然后 email")
 *   - detectReferenceAmbiguity ("这个文件" with no attachment)
 *   - detectUnderspecifiedAction ("发邮件" without recipient)
 */

import { parseNaturalLanguageTrigger } from "../../scheduler/nl_to_cron.mjs";

// One-shot time expressions. Deliberately does NOT match recurring phrases —
// those still belong to the existing scheduler's NL parser for cron/interval.
const TIME_OFFSET_RE = /((\d+)\s*(分钟|分|小时|时|天|minutes?|mins?|hours?|hrs?|days?)\s*(?:以?后|之后|later|from\s+now)|(?:in|after)\s+(\d+)\s*(分钟|分|小时|时|天|minutes?|mins?|hours?|hrs?|days?)|(今天|今晚|明天|后天|tonight|tomorrow)(?:\s*(上午|下午|晚上|morning|afternoon|evening|night))?\s*(\d{1,2})\s*(?:[:：](\d{1,2}))?\s*(点|时|:00)?(?:\s*(am|pm))?)/i;

const RECURRING_HINT_RE = /(每\s*\d|每天|每周|每月|工作日|every\s+(?:\d|day|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekday|hour|minute)|daily|weekly|monthly|hourly)/i;

/**
 * Detect a one-shot time offset in the user command. Returns structured info
 * if found, null otherwise. Recurring phrases (every / 每) intentionally
 * return null — those route to the existing scheduler NL parser which
 * handles cron/interval shapes.
 */
export function detectTimeOffset(userCommand) {
  const text = String(userCommand ?? "");
  if (!text.trim()) return null;
  if (RECURRING_HINT_RE.test(text)) return null;

  const match = text.match(TIME_OFFSET_RE);
  if (!match) return null;
  const offsetExpr = match[0];
  const parsed = parseNaturalLanguageTrigger(offsetExpr);
  if (!parsed.ok || parsed.trigger.type !== "at") return null;

  const residual = text
    .replace(offsetExpr, " ")
    .replace(/\s+/g, " ")
    .replace(/^[,，.。:：;；、\s]+|[,，.。:：;；、\s]+$/g, "")
    .trim();

  return {
    offsetExpr,
    trigger: parsed.trigger,
    residualCommand: residual
  };
}

/**
 * Top-level gate: does this user command need the TaskPlan layer? Keep this
 * function fast and deterministic — it runs on every submission.
 */
export function shouldRunTaskPlan(userCommand /*, contextPacket */) {
  if (detectTimeOffset(userCommand)) return "time_offset";
  // Week 2+ triggers will add other labels here.
  return null;
}
