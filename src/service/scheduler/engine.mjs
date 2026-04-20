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

// IANA timezone of the machine the scheduler is running on. Falls back to
// UTC only when the runtime has no Intl data (shouldn't happen on modern
// Node but guarded for safety). This is the default we inject into
// triggers that arrive without an explicit timezone — "every day at 9am"
// means 9am wall-clock time where the user lives, not 9am UTC.
function getSystemTimezone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz || "UTC";
  } catch {
    return "UTC";
  }
}

// Derive a human-readable schedule name when the caller/LLM omits one.
// The scheduler's DB column is NOT NULL, and the tool description doesn't
// always lead the LLM to supply `name`, so crashing on missing name
// surfaces a confusing SQL error instead of just working.
function deriveScheduleName(input) {
  const direct = typeof input?.name === "string" ? input.name.trim() : "";
  if (direct) return direct;

  const params = input?.action?.params ?? input?.action?.args ?? {};
  const userCommand = typeof params.userCommand === "string" ? params.userCommand.trim()
    : typeof params.command === "string" ? params.command.trim()
      : "";
  if (userCommand) {
    return userCommand.length > 80 ? userCommand.slice(0, 77) + "…" : userCommand;
  }

  const target = input?.action?.target ?? input?.action?.tool;
  if (typeof target === "string" && target.trim()) {
    return `Scheduled ${target.trim()}`;
  }

  const nl = input?.trigger?.natural_language;
  if (typeof nl === "string" && nl.trim()) {
    return `Scheduled: ${nl.trim()}`;
  }

  return "Scheduled task";
}

function ensureTrigger(trigger) {
  // Accept any of the field names the prompt docs / LLM training data tend
  // to produce (type / kind / trigger_type) rather than blowing up with
  // "trigger is required" on a semantically valid payload.
  const typeValue = trigger?.type ?? trigger?.kind ?? trigger?.trigger_type;
  if (typeValue) {
    // Inject local timezone if the caller didn't specify one. LLM-produced
    // schedules frequently omit it, which previously made cron expressions
    // silently run on UTC wall-clock (e.g. "0 9 * * *" fires at 17:00 in
    // UTC+8). Persisting the resolved timezone also means the UI can show
    // the user the exact tz the schedule will fire in.
    const timezone = trigger.timezone ?? getSystemTimezone();
    return { ...trigger, type: typeValue, timezone };
  }

  if (trigger?.natural_language) {
    const parsed = parseNaturalLanguageTrigger(
      trigger.natural_language,
      trigger.timezone ?? getSystemTimezone()
    );
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
    executeApprovedAction: (approval, { overrides = null } = {}) => {
      // User-edited field overrides (subject/body/to/...) from the approval
      // card get merged into the stored input before the workflow resumes.
      let actionParams = approval.proposed_params;
      if (overrides && typeof overrides === "object" && Object.keys(overrides).length > 0) {
        actionParams = {
          ...actionParams,
          input: { ...(actionParams?.input ?? {}), ...overrides }
        };
      }
      return executeProposedAction({
        runtime,
        actionType: approval.proposed_action,
        actionTarget: approval.proposed_target,
        actionParams,
        executionMode: "interactive",
        sourceLabel: approval.preview_text || `Approved ${approval.proposed_target}`,
        sourceId: approval.source_id
      });
    }
  });

  return {
    createSchedule(input, { createdBy = "user" } = {}) {
      if (runtime.store.listSchedules().length >= maxSchedules) {
        throw new Error(`Schedule limit reached: ${maxSchedules}`);
      }

      const schedule = createScheduleRecord({
        ...input,
        name: deriveScheduleName(input),
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
