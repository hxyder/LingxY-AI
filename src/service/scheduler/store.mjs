import crypto from "node:crypto";

export const DEFAULT_PENDING_APPROVAL_TTL_DAYS = 7;
export const MAX_SCHEDULE_COUNT = 50;
export const FAILURE_DISABLE_THRESHOLD = 3;

/* ────────────────────────────────────────────────────────────────────────── */
/* UCA-046: category + color palette, shared with UCA-041 projects           */
/* ────────────────────────────────────────────────────────────────────────── */

export const SCHEDULE_CATEGORIES = Object.freeze([
  { id: "general",  label: "General",  color: "#6366f1" },
  { id: "work",     label: "Work",     color: "#3b82f6" },
  { id: "email",    label: "Email",    color: "#ef4444" },
  { id: "reminder", label: "Reminder", color: "#f59e0b" },
  { id: "health",   label: "Health",   color: "#10b981" },
  { id: "custom",   label: "Custom",   color: "#8b5cf6" }
]);

export const CATEGORY_COLOR_MAP = Object.freeze(
  Object.fromEntries(SCHEDULE_CATEGORIES.map((c) => [c.id, c.color]))
);

export function resolveScheduleColor(category, explicitColor = null) {
  if (explicitColor) return explicitColor;
  return CATEGORY_COLOR_MAP[category] ?? CATEGORY_COLOR_MAP.general;
}

/**
 * Default lead-time rules per UCA-046 §4.
 * @param {number} msUntilRun — milliseconds from now to next_run_at
 * @returns {number} lead time in ms
 */
export function computeDefaultLeadTime(msUntilRun) {
  const HOUR = 3600_000;
  const DAY = 86400_000;
  const WEEK = 7 * DAY;
  const MONTH = 30 * DAY;

  if (msUntilRun <= 0) return 0;
  if (msUntilRun <= 8 * HOUR) return 1 * HOUR;
  if (msUntilRun <= 1 * DAY)  return 1 * HOUR;
  if (msUntilRun <= 1 * WEEK) return 1 * DAY;
  if (msUntilRun <= 1 * MONTH) return 3 * DAY;
  return 1 * WEEK;
}

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeTrigger(trigger = {}) {
  // Accept type / kind / trigger_type interchangeably — the prompt docs and
  // several LLM training corpora use "kind" for cron/interval/file_watch,
  // and demanding the canonical "type" surfaced as spurious
  // "trigger type is required" failures that caused the agent to abandon
  // scheduling and write a script instead.
  const triggerType = trigger.type ?? trigger.kind ?? trigger.trigger_type;
  if (!triggerType) {
    throw new Error("Schedule trigger type is required.");
  }

  return {
    trigger_type: triggerType,
    trigger_config: {
      ...trigger,
      type: undefined,
      kind: undefined,
      trigger_type: undefined
    }
  };
}

function normalizeAction(action = {}) {
  // Accept a few common LLM-synonyms so the agent doesn't trip over field
  // naming: {tool, args} and {type, target, params} both describe the same
  // action. If only {tool, args} is present, infer type=action_tool.
  const actionType = action.type
    ?? (action.tool || action.action_tool ? "action_tool" : undefined)
    ?? (action.template_id || action.template ? "template" : undefined);
  const actionTarget = action.target
    ?? action.tool
    ?? action.action_tool
    ?? action.template_id
    ?? action.template
    ?? action.userCommand;
  const actionParams = action.params ?? action.args ?? {};

  if (!actionType || !actionTarget) {
    throw new Error("Schedule action must include type and target (or tool).");
  }

  return {
    action_type: actionType,
    action_target: actionTarget,
    action_params: actionParams
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
  // UCA-046: category + lead time + user todo
  category = "general",
  color = null,
  leadTimeMs = null,
  userTodo = false,
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
    last_run_task_id: null,
    run_count: 0,
    failure_count: 0,
    consecutive_failure_count: 0,
    // UCA-046 fields
    category: category || "general",
    color: resolveScheduleColor(category, color),
    lead_time_ms: leadTimeMs,
    user_todo: Boolean(userTodo),
    reminder_sent_at: null,
    completed_at: null,
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
