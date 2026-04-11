import crypto from "node:crypto";

export const DEFAULT_PENDING_APPROVAL_TTL_DAYS = 7;
export const MAX_SCHEDULE_COUNT = 50;
export const FAILURE_DISABLE_THRESHOLD = 3;

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeTrigger(trigger = {}) {
  const triggerType = trigger.type ?? trigger.trigger_type;
  if (!triggerType) {
    throw new Error("Schedule trigger type is required.");
  }

  return {
    trigger_type: triggerType,
    trigger_config: {
      ...trigger,
      type: undefined,
      trigger_type: undefined
    }
  };
}

function normalizeAction(action = {}) {
  if (!action.type || !action.target) {
    throw new Error("Schedule action must include type and target.");
  }

  return {
    action_type: action.type,
    action_target: action.target,
    action_params: action.params ?? {}
  };
}

export function buildScheduleActionPreview(actionType, actionTarget, actionParams = {}) {
  if (actionType === "action_tool") {
    return `拟执行工具 ${actionTarget}`;
  }

  if (actionType === "task") {
    return `拟执行 AI 任务 ${actionParams.userCommand ?? actionTarget}`;
  }

  return `拟执行模板 ${actionTarget}`;
}

export function buildScheduleTriggerSummary(schedule) {
  switch (schedule.trigger_type) {
    case "cron":
      return `cron ${schedule.trigger_config.expression}`;
    case "interval":
      return `every ${schedule.trigger_config.seconds}s`;
    case "at":
      return `at ${schedule.trigger_config.run_at}`;
    case "file_watch":
      return `watch ${schedule.trigger_config.path}`;
    case "clipboard_watch":
      return `clipboard every ${schedule.trigger_config.poll_interval_ms ?? 2000}ms`;
    default:
      return schedule.trigger_type;
  }
}

export function createScheduleRecord({
  name,
  description = "",
  trigger,
  action,
  createdBy = "user",
  executionMode = "unattended_safe",
  catchupPolicy = "skip",
  maxRuntimeSeconds = 600,
  enabled = true,
  metadata = {},
  now = nowIso()
}) {
  const normalizedTrigger = normalizeTrigger(trigger);
  const normalizedAction = normalizeAction(action);

  return {
    schedule_id: createId("sched"),
    name,
    description,
    enabled,
    created_at: now,
    updated_at: now,
    created_by: createdBy,
    trigger_type: normalizedTrigger.trigger_type,
    trigger_config: normalizedTrigger.trigger_config,
    action_type: normalizedAction.action_type,
    action_target: normalizedAction.action_target,
    action_params: normalizedAction.action_params,
    execution_mode: executionMode,
    catchup_policy: catchupPolicy,
    max_runtime_seconds: maxRuntimeSeconds,
    next_run_at: null,
    last_run_at: null,
    last_run_status: null,
    run_count: 0,
    failure_count: 0,
    consecutive_failure_count: 0,
    metadata
  };
}

export function createScheduleRunRecord({
  scheduleId,
  triggerReason,
  status = "triggered",
  triggeredAt = nowIso(),
  taskId = null,
  approvalId = null,
  errorMessage = null,
  metadata = {}
}) {
  return {
    run_id: createId("run"),
    schedule_id: scheduleId,
    task_id: taskId,
    approval_id: approvalId,
    triggered_at: triggeredAt,
    trigger_reason: triggerReason,
    status,
    error_message: errorMessage,
    metadata
  };
}

export function createPendingApprovalRecord({
  sourceType,
  sourceId,
  proposedAction,
  proposedTarget,
  proposedParams = {},
  previewText = "",
  ttlDays = DEFAULT_PENDING_APPROVAL_TTL_DAYS,
  metadata = {},
  createdAt = nowIso()
}) {
  return {
    approval_id: createId("appr"),
    created_at: createdAt,
    expires_at: new Date(Date.parse(createdAt) + ttlDays * 24 * 60 * 60 * 1000).toISOString(),
    source_type: sourceType,
    source_id: sourceId,
    proposed_action: proposedAction,
    proposed_target: proposedTarget,
    proposed_params: proposedParams,
    preview_text: previewText,
    status: "pending",
    decided_at: null,
    decided_by: null,
    resulting_task_id: null,
    metadata
  };
}

export function cloneSchedule(schedule) {
  return JSON.parse(JSON.stringify(schedule));
}
