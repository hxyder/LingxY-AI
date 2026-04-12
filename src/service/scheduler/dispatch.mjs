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

function updateScheduleAfterRun(runtime, schedule, runStatus, now) {
  schedule.updated_at = now;
  schedule.last_run_at = now;
  schedule.last_run_status = runStatus;
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

  const now = new Date().toISOString();
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
    updateScheduleAfterRun(runtime, schedule, runStatus, now);
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
    updateScheduleAfterRun(runtime, schedule, "failed", now);
    return {
      status: "failed",
      error
    };
  }
}
