import { appendAuditLog } from "../security/audit-log.mjs";
import { evaluateToolRisk } from "../action_tools/risk_matrix.mjs";
import { executeProposedAction } from "./execute-action.mjs";
import { applyScheduleRunOutcome } from "./failure_guard.mjs";
import { computeNextRunAt } from "./misfire.mjs";
import {
  buildScheduleActionPreview,
  createScheduleRunRecord
} from "./store.mjs";

function shouldCreatePendingApproval(schedule, runtime) {
  if (schedule.execution_mode === "approval_required") {
    return true;
  }

  if (schedule.execution_mode !== "unattended_safe" || schedule.action_type !== "action_tool") {
    return false;
  }

  const tool = runtime.actionToolRegistry.get(schedule.action_target);
  if (!tool) {
    return false;
  }

  const risk = evaluateToolRisk(tool, schedule.action_params, runtime.toolContext ?? {});
  return risk.requires_confirmation || risk.risk_level === "high";
}

function updateRun(store, runId, patch) {
  return store.updateScheduleRun(runId, patch);
}

function updateScheduleAfterRun(runtime, schedule, runStatus, now, taskId = null) {
  schedule.updated_at = now;
  schedule.last_run_at = now;
  schedule.last_run_status = runStatus;
  // Carry the task id through so the UI can link "failed" schedule
  // rows directly to the failing task detail. Null for runs that
  // bypassed the task store (pending_approval, dispatcher-side errors).
  schedule.last_run_task_id = taskId;
  schedule.run_count += 1;
  // UCA-046: reset reminder_sent_at so the next cycle's lead-time window
  // produces a fresh reminder instead of being suppressed by a stale stamp.
  schedule.reminder_sent_at = null;
  if (schedule.metadata?.one_shot) {
    schedule.enabled = false;
    schedule.next_run_at = null;
  } else {
    schedule.next_run_at = computeNextRunAt(schedule, { after: now });
  }

  const outcome = applyScheduleRunOutcome(schedule, runStatus);
  runtime.store.updateSchedule(schedule.schedule_id, schedule);

  if (outcome.thresholdReached) {
    appendAuditLog(runtime, "schedule.misfire_handled", {
      schedule_id: schedule.schedule_id,
      action: "auto_disabled_after_failures",
      consecutive_failure_count: schedule.consecutive_failure_count
    });
  }
}

// UCA-098: Guard against double-dispatch when the scheduler tick fires
// again while a previous dispatch is still awaiting executeProposedAction.
// For a task that takes 30+ seconds to run, the 5-second scheduler tick
// would find the schedule still claiming `next_run_at <= now` and dispatch
// it a second time — the second run's task got deduped by the queue, but
// the auto-notify still fired, producing a duplicate "completed"
// notification. This in-memory set locks the schedule id until dispatch
// finishes; the first thing dispatchSchedule does synchronously is also
// advance `next_run_at` past `now` so a fresh process (or manual
// runDueSchedules call) still won't re-pick it.
const IN_FLIGHT_SCHEDULES = new Set();

export function isScheduleInFlight(scheduleId) {
  return IN_FLIGHT_SCHEDULES.has(scheduleId);
}

function claimInFlight(runtime, schedule, now) {
  IN_FLIGHT_SCHEDULES.add(schedule.schedule_id);
  // Advance next_run_at synchronously so a concurrent tick sees the
  // schedule as "not due right now". For one-shot at-triggers we clear
  // it entirely; for recurring triggers we compute the next occurrence.
  const claimed = { ...schedule };
  if (claimed.metadata?.one_shot) {
    claimed.next_run_at = null;
  } else {
    claimed.next_run_at = computeNextRunAt(claimed, { after: now });
  }
  claimed.updated_at = now;
  runtime.store.updateSchedule(claimed.schedule_id, claimed);
  return claimed;
}

function releaseInFlight(scheduleId) {
  IN_FLIGHT_SCHEDULES.delete(scheduleId);
}

export async function dispatchSchedule({
  runtime,
  scheduleId,
  reason = "manual",
  triggerPayload = {}
}) {
  const schedule = runtime.store.getSchedule(scheduleId);
  if (!schedule || !schedule.enabled) {
    return null;
  }

  // Reject a concurrent dispatch for the same schedule. See IN_FLIGHT_SCHEDULES.
  if (IN_FLIGHT_SCHEDULES.has(schedule.schedule_id)) {
    return null;
  }

  const now = new Date().toISOString();
  const claimedSchedule = claimInFlight(runtime, schedule, now);
  Object.assign(schedule, claimedSchedule);

  const run = createScheduleRunRecord({
    scheduleId,
    triggerReason: reason,
    metadata: triggerPayload
  });
  runtime.store.appendScheduleRun(run);

  appendAuditLog(runtime, "schedule.trigger", {
    schedule_id: schedule.schedule_id,
    trigger_reason: reason,
    execution_mode: schedule.execution_mode
  });

  if (shouldCreatePendingApproval(schedule, runtime)) {
    const approval = runtime.pendingApprovals.create({
      sourceType: "schedule_trigger",
      sourceId: schedule.schedule_id,
      proposedAction: schedule.action_type,
      proposedTarget: schedule.action_target,
      proposedParams: {
        ...schedule.action_params,
        __schedule_id: schedule.schedule_id,
        __schedule_name: schedule.name
      },
      previewText: buildScheduleActionPreview(schedule.action_type, schedule.action_target, schedule.action_params),
      metadata: {
        schedule_id: schedule.schedule_id,
        run_id: run.run_id,
        execution_mode: schedule.execution_mode
      }
    });

    updateRun(runtime.store, run.run_id, {
      status: "pending_approval",
      approval_id: approval.approval_id
    });
    updateScheduleAfterRun(runtime, schedule, "pending_approval", now);
    releaseInFlight(schedule.schedule_id);
    return {
      status: "pending_approval",
      approval,
      run: runtime.store.getScheduleRun(run.run_id)
    };
  }

  try {
    const result = await executeProposedAction({
      runtime,
      actionType: schedule.action_type,
      actionTarget: schedule.action_target,
      actionParams: schedule.action_params,
      executionMode: schedule.execution_mode,
      sourceLabel: `Scheduled run: ${schedule.name}`,
      sourceId: schedule.schedule_id
    });

    const taskStatus = result.task?.status ?? "failed";
    const runStatus = ["success", "partial_success"].includes(taskStatus) ? taskStatus : "failed";
    updateRun(runtime.store, run.run_id, {
      status: runStatus,
      task_id: result.task?.task_id ?? null,
      error_message: runStatus === "failed" ? result.task?.failure_user_message ?? "Scheduled action failed." : null
    });
    updateScheduleAfterRun(runtime, schedule, runStatus, now, result.task?.task_id ?? null);
    return {
      status: runStatus,
      task: result.task,
      run: runtime.store.getScheduleRun(run.run_id)
    };
  } catch (error) {
    updateRun(runtime.store, run.run_id, {
      status: "failed",
      error_message: error.message
    });
    updateScheduleAfterRun(runtime, schedule, "failed", now, null);
    return {
      status: "failed",
      error
    };
  } finally {
    releaseInFlight(schedule.schedule_id);
  }
}
