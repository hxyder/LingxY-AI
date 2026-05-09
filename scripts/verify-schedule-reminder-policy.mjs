import assert from "node:assert/strict";
import { createReminderWatcher } from "../src/service/scheduler/reminder-watcher.mjs";

const nowMs = Date.parse("2026-05-08T12:00:00.000Z");
const nextRunAt = new Date(nowMs + 10 * 60_000).toISOString();

function schedule(patch = {}) {
  return {
    schedule_id: `sched_${Math.random().toString(16).slice(2)}`,
    name: "Audit reminder policy",
    enabled: true,
    next_run_at: nextRunAt,
    reminder_sent_at: null,
    completed_at: null,
    last_run_status: null,
    user_todo: false,
    lead_time_ms: null,
    updated_at: "2026-05-08T11:00:00.000Z",
    ...patch
  };
}

function makeRuntime(schedules) {
  const notifications = [];
  return {
    notifications,
    actionToolRegistry: {
      get(id) {
        if (id !== "notify") return null;
        return {
          async execute(payload) {
            notifications.push(payload);
            return { success: true };
          }
        };
      }
    },
    store: {
      listSchedules() {
        return schedules;
      },
      updateSchedule(scheduleId, next) {
        const index = schedules.findIndex((item) => item.schedule_id === scheduleId);
        if (index >= 0) schedules[index] = { ...next };
        return next;
      }
    }
  };
}

{
  const normal = schedule();
  const watcher = createReminderWatcher({ runtime: makeRuntime([normal]) });
  assert.equal(watcher.shouldRemind(normal, nowMs), false, "normal scheduled actions must not pre-remind by default");
}

{
  const todo = schedule({ user_todo: true });
  const runtime = makeRuntime([todo]);
  const watcher = createReminderWatcher({ runtime });
  await watcher.tick({ nowMs });
  assert.equal(runtime.notifications.length, 1, "user todo schedule should receive a reminder");
  assert.ok(runtime.store.listSchedules()[0].reminder_sent_at, "reminder must stamp schedule to prevent duplicates");
  await watcher.tick({ nowMs: nowMs + 1000 });
  assert.equal(runtime.notifications.length, 1, "stamped reminder must not repeat in the same cycle");
}

{
  const explicitLead = schedule({ lead_time_ms: 60 * 60_000 });
  const runtime = makeRuntime([explicitLead]);
  const watcher = createReminderWatcher({ runtime });
  await watcher.tick({ nowMs });
  assert.equal(runtime.notifications.length, 1, "explicit lead_time_ms should opt into pre-run reminder");
}

console.log("schedule reminder policy ok");
