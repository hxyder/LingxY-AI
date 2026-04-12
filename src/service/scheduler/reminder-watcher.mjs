/**
 * UCA-046 — Reminder watcher.
 *
 * Ticks once per minute (configurable). On each tick, scans all enabled
 * schedules for ones where:
 *
 *   - `next_run_at` is in the future
 *   - `reminder_sent_at` is null (haven't reminded yet for this cycle)
 *   - `now >= next_run_at - lead_time_ms` (within the lead-time window)
 *   - status is not already completed / cancelled / in_progress
 *
 * For each matching schedule, fires a desktop notification with the
 * schedule name and remaining time, then stamps `reminder_sent_at` so
 * the same reminder isn't sent twice.
 *
 * The watcher is started alongside the scheduler poll in persistent-runtime.
 */

import { computeDefaultLeadTime } from "./store.mjs";

const DEFAULT_TICK_MS = 60_000;

function formatTimeUntil(ms) {
  if (ms <= 0) return "即将到期";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} 分钟后`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时后`;
  const days = Math.round(hours / 24);
  return `${days} 天后`;
}

function shouldRemind(schedule, nowMs) {
  if (!schedule.enabled) return false;
  if (!schedule.next_run_at) return false;
  if (schedule.reminder_sent_at) return false;
  if (schedule.completed_at) return false;

  // Don't remind for schedules that already ran or are running
  const status = schedule.last_run_status;
  if (status === "in_progress") return false;

  const runAtMs = Date.parse(schedule.next_run_at);
  if (Number.isNaN(runAtMs) || runAtMs <= nowMs) return false;

  const leadMs = schedule.lead_time_ms ?? computeDefaultLeadTime(runAtMs - nowMs);
  if (leadMs <= 0) return false;

  const reminderThreshold = runAtMs - leadMs;
  return nowMs >= reminderThreshold;
}

function buildReminderText(schedule, nowMs) {
  const runAtMs = Date.parse(schedule.next_run_at);
  const remaining = runAtMs - nowMs;
  const prefix = schedule.user_todo ? "你有一项待办" : "即将触发";
  return `${prefix}：${schedule.name}（${formatTimeUntil(remaining)}）`;
}

export function createReminderWatcher({ runtime, tickMs = DEFAULT_TICK_MS } = {}) {
  let timer = null;

  async function sendNotification(title, body) {
    const notifyTool = runtime.actionToolRegistry?.get?.("notify");
    if (notifyTool) {
      try {
        await notifyTool.execute({ title, body }, { runtime });
      } catch { /* non-fatal */ }
    }
  }

  async function tick() {
    const nowMs = Date.now();
    const schedules = runtime.store.listSchedules();

    for (const schedule of schedules) {
      if (!shouldRemind(schedule, nowMs)) continue;

      const body = buildReminderText(schedule, nowMs);
      await sendNotification("UCA 提醒", body);

      // Stamp reminder_sent_at to prevent duplicate reminders for this cycle.
      // After the schedule fires and next_run_at advances, reminder_sent_at
      // gets reset (see dispatch.mjs updateScheduleAfterRun).
      schedule.reminder_sent_at = new Date(nowMs).toISOString();
      schedule.updated_at = new Date(nowMs).toISOString();
      runtime.store.updateSchedule(schedule.schedule_id, schedule);
    }
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(() => {
        tick().catch(() => { /* swallow errors — watcher must never crash the runtime */ });
      }, tickMs);
      // Non-blocking: don't keep the process alive just for reminders
      if (typeof timer?.unref === "function") timer.unref();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    // Exposed for verify scripts to call directly without waiting for a timer tick
    tick,
    // Exposed for unit tests
    shouldRemind,
    formatTimeUntil
  };
}
