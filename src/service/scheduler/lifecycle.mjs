import { computeNextRunAt } from "./misfire.mjs";

export function isOneShotSchedule(schedule = {}) {
  const triggerType = schedule.trigger_type
    ?? schedule.trigger?.type
    ?? schedule.trigger?.kind
    ?? schedule.trigger?.trigger_type;
  return triggerType === "at" || schedule.metadata?.one_shot === true;
}

export function advanceScheduleAfterRun(schedule, { now = new Date().toISOString() } = {}) {
  if (isOneShotSchedule(schedule)) {
    schedule.enabled = false;
    schedule.next_run_at = null;
    return schedule;
  }

  schedule.next_run_at = computeNextRunAt(schedule, { after: now });
  return schedule;
}

export function claimScheduleForRun(schedule, { now = new Date().toISOString() } = {}) {
  const claimed = { ...schedule, updated_at: now };
  if (isOneShotSchedule(claimed)) {
    claimed.enabled = false;
    claimed.next_run_at = null;
    return claimed;
  }

  claimed.next_run_at = computeNextRunAt(claimed, { after: now });
  return claimed;
}

export function resumeSchedule(schedule, { now = new Date().toISOString() } = {}) {
  schedule.updated_at = now;
  schedule.next_run_at = computeNextRunAt(schedule, { after: now });
  if (isOneShotSchedule(schedule) && !schedule.next_run_at) {
    schedule.enabled = false;
    return schedule;
  }

  schedule.enabled = true;
  return schedule;
}

export function normalizeTerminalOneShotSchedule(schedule, { now = new Date().toISOString() } = {}) {
  if (!isOneShotSchedule(schedule) || schedule.next_run_at) {
    return false;
  }

  const runCount = Number(schedule.run_count ?? 0);
  const hasRun = Boolean(schedule.last_run_at) || runCount > 0;
  const runAtMs = Date.parse(schedule.trigger_config?.run_at ?? schedule.trigger_config?.at ?? "");
  const nowMs = Date.parse(now);
  const expired = Number.isFinite(runAtMs) && Number.isFinite(nowMs) && runAtMs <= nowMs;
  if (!hasRun && !expired) {
    return false;
  }

  schedule.enabled = false;
  schedule.updated_at = now;
  return true;
}
