import { appendAuditLog } from "../security/audit-log.mjs";

function nowIso() {
  return new Date().toISOString();
}

export function createThreadTracker({ runtime }) {
  const state = new Map();

  function trackThread({ threadId, scheduleId, accountId }) {
    if (!threadId || !scheduleId) return;
    state.set(threadId, {
      threadId,
      scheduleId,
      accountId,
      completed: false,
      updated_at: nowIso()
    });
  }

  function getThread(threadId) {
    return state.get(threadId) ?? null;
  }

  function markCompleted(threadId) {
    const entry = state.get(threadId);
    if (!entry) return null;
    entry.completed = true;
    entry.updated_at = nowIso();
    state.set(threadId, entry);
    return entry;
  }

  function updateSchedule(scheduleId, patch) {
    const schedule = runtime.store.getSchedule(scheduleId);
    if (!schedule) return null;
    const next = {
      ...schedule,
      ...patch,
      updated_at: nowIso()
    };
    runtime.store.updateSchedule(scheduleId, next);
    appendAuditLog(runtime, "email.schedule_updated", {
      schedule_id: scheduleId,
      patch
    });
    return next;
  }

  return {
    trackThread,
    getThread,
    markCompleted,
    updateSchedule
  };
}
