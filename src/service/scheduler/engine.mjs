import { appendAuditLog } from "../security/audit-log.mjs";
import { parseNaturalLanguageTrigger } from "./nl_to_cron.mjs";
import { applyMisfirePolicy, computeMissedRunTimes, computeNextRunAt } from "./misfire.mjs";
import { createPendingApprovalService } from "./pending-approvals.mjs";
import { dispatchSchedule } from "./dispatch.mjs";
import { executeProposedAction } from "./execute-action.mjs";
import {
  MAX_SCHEDULE_COUNT,
  buildScheduleTriggerSummary,
  cloneSchedule,
  createScheduleRecord
} from "./store.mjs";

function ensureTrigger(trigger) {
  if (trigger?.type) {
    return trigger;
  }

  if (trigger?.natural_language) {
    const parsed = parseNaturalLanguageTrigger(trigger.natural_language, trigger.timezone);
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    return parsed.trigger;
  }

  throw new Error("Schedule trigger is required.");
}

export function createSchedulerRuntime({ runtime, maxSchedules = MAX_SCHEDULE_COUNT } = {}) {
  runtime.pendingApprovals = createPendingApprovalService({
    runtime,
    executeApprovedAction: (approval) =>
      executeProposedAction({
        runtime,
        actionType: approval.proposed_action,
        actionTarget: approval.proposed_target,
        actionParams: approval.proposed_params,
        executionMode: "interactive",
        sourceLabel: approval.preview_text || `Approved ${approval.proposed_target}`,
        sourceId: approval.source_id
      })
  });

  return {
    createSchedule(input, { createdBy = "user" } = {}) {
      if (runtime.store.listSchedules().length >= maxSchedules) {
        throw new Error(`Schedule limit reached: ${maxSchedules}`);
      }

      const schedule = createScheduleRecord({
        ...input,
        trigger: ensureTrigger(input.trigger),
        createdBy
      });
      schedule.next_run_at = computeNextRunAt(schedule, { after: schedule.created_at });
      runtime.store.insertSchedule(schedule);
      appendAuditLog(runtime, "tool.call", {
        tool_id: "create_scheduled_task",
        schedule_id: schedule.schedule_id,
        trigger: buildScheduleTriggerSummary(schedule)
      });
      return cloneSchedule(schedule);
    },
    listSchedules() {
      return runtime.store.listSchedules().map(cloneSchedule);
    },
    getSchedule(scheduleId) {
      const schedule = runtime.store.getSchedule(scheduleId);
      return schedule ? cloneSchedule(schedule) : null;
    },
    deleteSchedule(scheduleId) {
      const deleted = runtime.store.deleteSchedule(scheduleId);
      if (deleted) {
        appendAuditLog(runtime, "tool.call", {
          tool_id: "delete_scheduled_task",
          schedule_id: scheduleId
        });
      }
      return deleted;
    },
    pauseSchedule(scheduleId, enabled = false) {
      const schedule = runtime.store.getSchedule(scheduleId);
      if (!schedule) {
        return null;
      }

      schedule.enabled = enabled;
      schedule.updated_at = new Date().toISOString();
      if (enabled) {
        schedule.next_run_at = computeNextRunAt(schedule, { after: schedule.updated_at });
      }
      runtime.store.updateSchedule(scheduleId, schedule);
      appendAuditLog(runtime, "tool.call", {
        tool_id: "pause_scheduled_task",
        schedule_id: scheduleId,
        enabled
      });
      return cloneSchedule(schedule);
    },
    async dispatch(scheduleId, reason = "manual", triggerPayload = {}) {
      return dispatchSchedule({
        runtime,
        scheduleId,
        reason,
        triggerPayload
      });
    },
    async runDueSchedules({ now = new Date().toISOString() } = {}) {
      const dueSchedules = runtime.store.listSchedules()
        .filter((schedule) => schedule.enabled && schedule.next_run_at && schedule.next_run_at <= now);

      const results = [];
      for (const schedule of dueSchedules) {
        results.push(await dispatchSchedule({
          runtime,
          scheduleId: schedule.schedule_id,
          reason: "due"
        }));
      }
      return results;
    },
    async recoverSchedules({ now = new Date().toISOString() } = {}) {
      const runs = [];
      for (const schedule of runtime.store.listSchedules().filter((item) => item.enabled)) {
        const missed = computeMissedRunTimes(schedule, { now });
        const selected = applyMisfirePolicy(schedule, missed);
        if (missed.length > 0) {
          appendAuditLog(runtime, "schedule.misfire_handled", {
            schedule_id: schedule.schedule_id,
            missed_count: missed.length,
            selected_count: selected.length,
            policy: schedule.catchup_policy
          });
        }

        for (const runAt of selected) {
          runs.push(await dispatchSchedule({
            runtime,
            scheduleId: schedule.schedule_id,
            reason: "misfire",
            triggerPayload: { missed_run_at: runAt }
          }));
        }

        if (missed.length > 0 && selected.length === 0) {
          schedule.next_run_at = computeNextRunAt(schedule, { after: now });
          schedule.updated_at = now;
          runtime.store.updateSchedule(schedule.schedule_id, schedule);
        }
      }
      return runs;
    },
    async handleFileWatchEvent(scheduleId, fileEvent) {
      return dispatchSchedule({
        runtime,
        scheduleId,
        reason: "file_event",
        triggerPayload: fileEvent
      });
    },
    listScheduleRuns(scheduleId) {
      return runtime.store.listScheduleRuns(scheduleId);
    },
    approvePendingApproval(approvalId, options) {
      return runtime.pendingApprovals.approve(approvalId, options);
    },
    rejectPendingApproval(approvalId, options) {
      return runtime.pendingApprovals.reject(approvalId, options);
    },
    sweepExpiredApprovals(options) {
      return runtime.pendingApprovals.sweepExpired(options);
    }
  };
}
