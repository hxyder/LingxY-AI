import { appendAuditLog } from "../security/audit-log.mjs";
import { parseNaturalLanguageTrigger } from "./nl_to_cron.mjs";
import { applyMisfirePolicy, computeMissedRunTimes, computeNextRunAt } from "./misfire.mjs";
import { normalizeTerminalOneShotSchedule, resumeSchedule } from "./lifecycle.mjs";
import { createPendingApprovalService } from "./pending-approvals.mjs";
import { dispatchSchedule } from "./dispatch.mjs";
import { recoverStaleScheduleRuns } from "./stale-runs.mjs";
import { executeProposedAction } from "./execute-action.mjs";
import { getSystemTimezone, getUserLocation } from "../utils/location.mjs";
import {
  MAX_SCHEDULE_COUNT,
  buildScheduleTriggerSummary,
  cloneSchedule,
  createScheduleRecord
} from "./store.mjs";
import {
  deriveScheduleTitle,
  normalizeScheduleRecordTitle
} from "../core/policy/scheduled-work-policy.mjs";

function pickScheduleName(input) {
  const derived = deriveScheduleTitle(input);
  return { name: derived.title, audit: derived.audit };
}

// Back-compat shim — older callers expect a string return.
function deriveScheduleName(input) {
  return pickScheduleName(input).name;
}

function normalizeStoredSchedule(runtime, schedule) {
  const normalized = normalizeScheduleRecordTitle(schedule);
  if (normalized.changed) {
    runtime.store.updateSchedule(schedule.schedule_id, normalized.schedule);
  }
  return normalized.schedule;
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
    // Location at create-time is an *optional* snapshot of where the user
    // was when they scheduled this. Only captured if they've granted
    // geolocation — we don't guess from timezone. UI can render "scheduled
    // while you were in Shanghai" when present, just the timezone otherwise.
    const createdLocation = trigger.location ?? getUserLocation();
    return {
      ...trigger,
      type: typeValue,
      timezone,
      ...(createdLocation ? { location: createdLocation } : {})
    };
  }

  if (trigger?.natural_language) {
    const parsed = parseNaturalLanguageTrigger(
      trigger.natural_language,
      trigger.timezone ?? getSystemTimezone()
    );
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    const parsedTrigger = parsed.trigger;
    const createdLocation = parsedTrigger.location ?? getUserLocation();
    return createdLocation
      ? { ...parsedTrigger, location: createdLocation }
      : parsedTrigger;
  }

  throw new Error("Schedule trigger is required.");
}

function applyTriggerToSchedule(schedule, trigger) {
  const triggerType = trigger.type ?? trigger.kind ?? trigger.trigger_type;
  const {
    type: _type,
    kind: _kind,
    trigger_type: _triggerType,
    ...triggerConfig
  } = trigger;
  schedule.trigger_type = triggerType;
  schedule.trigger_config = triggerConfig;
}

export function createSchedulerRuntime({ runtime, maxSchedules = MAX_SCHEDULE_COUNT } = {}) {
  runtime.pendingApprovals = createPendingApprovalService({
    runtime,
    executeApprovedAction: (approval, { overrides = null } = {}) => {
      // User-edited field overrides (subject/body/to/...) from the approval
      // card. The merge target depends on the approval shape:
      //
      //   - connector_workflow approvals store proposed_params as
      //     { input: {...}, state: {...} } — overrides belong in `input`
      //     so the workflow resumes with the edited recipient/body.
      //   - agent_tool_call / action_tool approvals store proposed_params
      //     as the flat tool args ({ to, subject, body, ... }) — overrides
      //     must merge at the TOP level. UCA-181 follow-up: previously
      //     overrides were always wrapped under `input`, so editing `to`
      //     in the approval card put the new value at args.input.to while
      //     the tool only reads args.to → the edit was silently ignored
      //     and only the original first recipient received the email.
      let actionParams = approval.proposed_params;
      if (overrides && typeof overrides === "object" && Object.keys(overrides).length > 0) {
        if (approval.proposed_action === "connector_workflow") {
          actionParams = {
            ...actionParams,
            input: { ...(actionParams?.input ?? {}), ...overrides }
          };
        } else {
          actionParams = { ...actionParams, ...overrides };
        }
      }
      return executeProposedAction({
        runtime,
        actionType: approval.proposed_action,
        actionTarget: approval.proposed_target,
        actionParams,
        executionMode: "interactive",
        sourceLabel: approval.preview_text || `Approved ${approval.proposed_target}`,
        sourceId: approval.source_id,
        resumeTaskId: approval.proposed_action === "connector_workflow"
          ? approval.metadata?.task_id ?? null
          : null,
        approvalId: approval.approval_id,
        actor: approval.decided_by ?? null
      });
    }
  });

  return {
    createSchedule(input, { createdBy = "user" } = {}) {
      if (runtime.store.listSchedules().length >= maxSchedules) {
        throw new Error(`Schedule limit reached: ${maxSchedules}`);
      }

      const { name: pickedName, audit: namingAudit } = pickScheduleName(input);
      const inheritedMetadata = input.metadata ?? {};
      const schedule = createScheduleRecord({
        ...input,
        name: pickedName,
        metadata: { ...inheritedMetadata, naming_audit: namingAudit },
        trigger: ensureTrigger(input.trigger),
        createdBy
      });
      schedule.next_run_at = computeNextRunAt(schedule, { after: schedule.created_at });
      normalizeTerminalOneShotSchedule(schedule, { now: schedule.created_at });
      runtime.store.insertSchedule(schedule);
      appendAuditLog(runtime, "tool.call", {
        tool_id: "create_scheduled_task",
        schedule_id: schedule.schedule_id,
        trigger: buildScheduleTriggerSummary(schedule)
      });
      return cloneSchedule(schedule);
    },
    listSchedules() {
      recoverStaleScheduleRuns({ runtime });
      return runtime.store.listSchedules()
        .map((schedule) => normalizeStoredSchedule(runtime, schedule))
        .map(cloneSchedule);
    },
    getSchedule(scheduleId) {
      const schedule = runtime.store.getSchedule(scheduleId);
      return schedule ? cloneSchedule(normalizeStoredSchedule(runtime, schedule)) : null;
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

      schedule.updated_at = new Date().toISOString();
      if (enabled) {
        resumeSchedule(schedule, { now: schedule.updated_at });
      } else {
        schedule.enabled = false;
      }
      runtime.store.updateSchedule(scheduleId, schedule);
      appendAuditLog(runtime, "tool.call", {
        tool_id: "pause_scheduled_task",
        schedule_id: scheduleId,
        enabled
      });
      return cloneSchedule(schedule);
    },
    // Re-trigger an existing schedule with a new natural-language /
    // structured trigger. Recomputes next_run_at on the spot so the
    // schedule actually fires at the new time. Run history (run_count
    // / last_run_at) is preserved — only the trigger and its
    // derivative fields change.
    rescheduleSchedule(scheduleId, triggerInput) {
      const schedule = runtime.store.getSchedule(scheduleId);
      if (!schedule) {
        return null;
      }
      const nextTrigger = ensureTrigger(triggerInput);
      schedule.updated_at = new Date().toISOString();
      applyTriggerToSchedule(schedule, nextTrigger);
      schedule.next_run_at = computeNextRunAt(schedule, { after: schedule.updated_at });
      normalizeTerminalOneShotSchedule(schedule, { now: schedule.updated_at });
      runtime.store.updateSchedule(scheduleId, schedule);
      appendAuditLog(runtime, "tool.call", {
        tool_id: "reschedule_scheduled_task",
        schedule_id: scheduleId,
        trigger: buildScheduleTriggerSummary(schedule)
      });
      return cloneSchedule(schedule);
    },
    async dispatch(scheduleId, reason = "manual", triggerPayload = {}) {
      const schedule = runtime.store.getSchedule(scheduleId);
      if (schedule) normalizeStoredSchedule(runtime, schedule);
      return dispatchSchedule({
        runtime,
        scheduleId,
        reason,
        triggerPayload
      });
    },
    async runDueSchedules({ now = new Date().toISOString() } = {}) {
      recoverStaleScheduleRuns({ runtime, now });
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
      recoverStaleScheduleRuns({ runtime, now });
      const runs = [];
      for (const schedule of runtime.store.listSchedules().filter((item) => item.enabled)) {
        if (normalizeTerminalOneShotSchedule(schedule, { now })) {
          runtime.store.updateSchedule(schedule.schedule_id, schedule);
          continue;
        }

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
          normalizeTerminalOneShotSchedule(schedule, { now });
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
      recoverStaleScheduleRuns({ runtime, scheduleId });
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
