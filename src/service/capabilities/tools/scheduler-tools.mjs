import { ACTION_TOOL_SCHEMAS } from "../schemas/index.mjs";
import { createActionResult } from "../../action_tools/types.mjs";
import { buildSideEffectContract } from "../../core/policy/side-effect-contracts.mjs";

function getSchedulerRuntime(ctx) {
  const scheduler = ctx.runtime?.scheduler;
  if (!scheduler) {
    throw new Error("Scheduler runtime is unavailable.");
  }
  return scheduler;
}

export const CREATE_SCHEDULED_TASK_TOOL = {
  id: "create_scheduled_task",
  name: "Create Scheduled Task",
  description: "Schedule work for LATER. Use this whenever the user says '过 N 分钟/小时/天后 …' / '明天上午 X 点 …' / 'in 10 minutes …'. Do NOT execute the work now — just create the schedule and return. When the trigger fires, the scheduler wakes the AI up and feeds it action.params.userCommand, which then runs through the normal executor (web_search / email workflow / etc.). Trigger shapes: {natural_language:'5 分钟后'} (easiest), or {type:'at', run_at:'<ISO>'} for a one-shot fire that completes after it runs, or {type:'cron', expression:'0 9 * * *'} for recurring work. Use cron only when the user asks for recurrence such as 每天/每周/every day; do not silently turn a one-time absolute time into a recurring task. Action shape for AI tasks: {type:'task', target:'<short label>', params:{userCommand:'<full natural language instruction including recipient/content>'}}.",
  parameters: ACTION_TOOL_SCHEMAS.create_scheduled_task,
  risk_level: "high",
  required_capabilities: ["schedule_manage"],
  requires_confirmation: true,
  async execute(args, ctx) {
    const packet = ctx?.task?.context_packet ?? {};
    const isRealScheduledFire = packet.selection_metadata?.scheduled_task_fire === true;
    if (isRealScheduledFire) {
      return createActionResult({
        success: false,
        observation: "Cannot create a schedule from inside a scheduled task fire. Execute the action now (notify / send_email / etc.).",
        error: "scheduled_fire_cannot_reschedule"
      });
    }

    const scheduler = getSchedulerRuntime(ctx);
    const actionParams = args.action?.params ?? args.action?.args ?? {};
    const sideEffectContract = buildSideEffectContract({
      runtime: ctx.runtime,
      inferPolicyGroups: true,
      includeEntityValues: true,
      sources: [
        args.name,
        args.description,
        args.action?.target,
        args.action?.tool,
        actionParams.userCommand,
        actionParams.command,
        actionParams.contextText
      ].filter(Boolean)
    });
    const schedule = scheduler.createSchedule({
      name: args.name,
      description: args.description ?? "",
      trigger: args.trigger,
      action: args.action,
      executionMode: args.execution_mode ?? "unattended_safe",
      catchupPolicy: args.catchup_policy ?? "skip",
      category: args.category,
      color: args.color,
      leadTimeMs: args.lead_time_ms,
      userTodo: args.user_todo === true,
      metadata: sideEffectContract ? { side_effect_contract: sideEffectContract } : {}
    }, {
      createdBy: ctx.task ? "agent" : "user"
    });

    return createActionResult({
      success: true,
      observation: `Created schedule ${schedule.schedule_id}`,
      metadata: {
        schedule_id: schedule.schedule_id,
        next_run_at: schedule.next_run_at
      }
    });
  }
};

export const LIST_SCHEDULED_TASKS_TOOL = {
  id: "list_scheduled_tasks",
  name: "List Scheduled Tasks",
  description: "List configured schedules and their current status.",
  parameters: ACTION_TOOL_SCHEMAS.list_scheduled_tasks,
  risk_level: "low",
  required_capabilities: ["schedule_read"],
  requires_confirmation: false,
  async execute(args = {}, ctx) {
    const scheduler = getSchedulerRuntime(ctx);
    const schedules = scheduler.listSchedules()
      .filter((schedule) => args.includeDisabled || schedule.enabled);
    return createActionResult({
      success: true,
      observation: `Listed ${schedules.length} schedules`,
      metadata: {
        schedules
      }
    });
  }
};

export const DELETE_SCHEDULED_TASK_TOOL = {
  id: "delete_scheduled_task",
  name: "Delete Scheduled Task",
  description: "Delete a schedule and its active registrations.",
  parameters: ACTION_TOOL_SCHEMAS.delete_scheduled_task,
  risk_level: "high",
  required_capabilities: ["schedule_manage"],
  requires_confirmation: true,
  async execute(args = {}, ctx) {
    const scheduler = getSchedulerRuntime(ctx);
    const deleted = scheduler.deleteSchedule(args.schedule_id);
    return createActionResult({
      success: Boolean(deleted),
      observation: deleted ? `Deleted schedule ${args.schedule_id}` : `Schedule ${args.schedule_id} not found`,
      metadata: {
        schedule_id: args.schedule_id
      },
      error: deleted ? null : "schedule_not_found"
    });
  }
};

export const PAUSE_SCHEDULED_TASK_TOOL = {
  id: "pause_scheduled_task",
  name: "Pause Scheduled Task",
  description: "Pause or resume a schedule.",
  parameters: ACTION_TOOL_SCHEMAS.pause_scheduled_task,
  risk_level: "medium",
  required_capabilities: ["schedule_manage"],
  requires_confirmation: false,
  async execute(args = {}, ctx) {
    const scheduler = getSchedulerRuntime(ctx);
    const schedule = scheduler.pauseSchedule(args.schedule_id, args.enabled ?? false);
    return createActionResult({
      success: Boolean(schedule),
      observation: schedule
        ? `${schedule.enabled ? "Resumed" : "Paused"} schedule ${args.schedule_id}`
        : `Schedule ${args.schedule_id} not found`,
      metadata: {
        schedule_id: args.schedule_id,
        enabled: schedule?.enabled ?? null
      },
      error: schedule ? null : "schedule_not_found"
    });
  }
};
