import { appendAuditLog } from "../security/audit-log.mjs";
import { applyScheduleRunOutcome } from "./failure_guard.mjs";
import { advanceScheduleAfterRun, isOneShotSchedule } from "./lifecycle.mjs";

const ACTIVE_RUN_STATUSES = new Set(["triggered"]);
const TERMINAL_TASK_STATUSES = new Set(["success", "failed", "partial_success", "cancelled", "canceled"]);
const STALE_RUN_GRACE_MS = 60_000;

function nowIso() {
  return new Date().toISOString();
}

function maxRuntimeMs(schedule = {}) {
  const seconds = Number(schedule.max_runtime_seconds ?? 600);
  const bounded = Number.isFinite(seconds) ? Math.max(1, Math.min(seconds, 86_400)) : 600;
  return bounded * 1000;
}

function isStaleTriggeredRun(run = {}, schedule = {}, now = nowIso()) {
  if (!ACTIVE_RUN_STATUSES.has(run.status)) return false;
  const started = Date.parse(run.triggered_at ?? "");
  const nowMs = Date.parse(now);
  if (!Number.isFinite(started) || !Number.isFinite(nowMs)) return false;
  return started + maxRuntimeMs(schedule) + STALE_RUN_GRACE_MS <= nowMs;
}

function classifyTaskRunStatus(task = null) {
  if (!task || !TERMINAL_TASK_STATUSES.has(task.status)) return null;
  if (task.status === "success") return "success";
  if (task.status === "partial_success" && task.sub_status === "waiting_external_decision") {
    return "partial_success";
  }
  if (task.status === "partial_success") return "failed";
  return "failed";
}

function recoveryErrorMessage({ task = null } = {}) {
  if (task?.failure_user_message) return task.failure_user_message;
  if (task?.status) return `Scheduled action ended as ${task.status}, but the scheduler run was not closed.`;
  return "Scheduled action did not create a task before the runtime stopped or timed out.";
}

function updateScheduleForRecoveredRun(runtime, schedule, {
  run,
  status,
  taskId = null,
  now = nowIso()
} = {}) {
  const next = { ...schedule };
  next.updated_at = now;
  next.last_run_at = run.triggered_at ?? now;
  next.last_run_status = status;
  next.last_run_task_id = taskId;
  next.run_count = Number(next.run_count ?? 0) + 1;
  next.reminder_sent_at = null;
  advanceScheduleAfterRun(next, { now: next.last_run_at });
  if (isOneShotSchedule(next)) {
    next.enabled = false;
  }
  const outcome = applyScheduleRunOutcome(next, status);
  runtime.store.updateSchedule(next.schedule_id, next);
  if (outcome.thresholdReached) {
    appendAuditLog(runtime, "schedule.misfire_handled", {
      schedule_id: next.schedule_id,
      action: "auto_disabled_after_failures",
      consecutive_failure_count: next.consecutive_failure_count,
      source: "stale_run_recovery"
    });
  }
  return next;
}

export function recoverStaleScheduleRuns({ runtime, now = nowIso(), scheduleId = null } = {}) {
  if (!runtime?.store || typeof runtime.store.listScheduleRuns !== "function") return [];
  const allRuns = runtime.store.listScheduleRuns(scheduleId);
  const recovered = [];
  for (const run of allRuns) {
    if (!ACTIVE_RUN_STATUSES.has(run.status)) continue;
    const schedule = runtime.store.getSchedule?.(run.schedule_id);
    if (!schedule || !isStaleTriggeredRun(run, schedule, now)) continue;
    const task = run.task_id && typeof runtime.store.getTask === "function"
      ? runtime.store.getTask(run.task_id)
      : null;
    const taskStatus = classifyTaskRunStatus(task);
    const status = taskStatus ?? "failed";
    const errorMessage = status === "failed" ? recoveryErrorMessage({ task }) : null;
    const nextRun = runtime.store.updateScheduleRun(run.run_id, {
      status,
      task_id: run.task_id ?? task?.task_id ?? null,
      error_message: errorMessage,
      metadata: {
        ...(run.metadata ?? {}),
        stale_run_recovered_at: now,
        stale_run_recovery_reason: task
          ? "task_terminal_or_timeout"
          : "missing_task"
      }
    });
    const nextSchedule = updateScheduleForRecoveredRun(runtime, schedule, {
      run,
      status,
      taskId: nextRun?.task_id ?? null,
      now
    });
    appendAuditLog(runtime, "schedule.stale_run_recovered", {
      schedule_id: run.schedule_id,
      run_id: run.run_id,
      status,
      task_id: nextRun?.task_id ?? null,
      reason: nextRun?.metadata?.stale_run_recovery_reason ?? null
    });
    recovered.push({ run: nextRun, schedule: nextSchedule });
  }
  return recovered;
}
