/**
 * TaskPlan executor (Week 1).
 *
 * Currently handles only the time-offset case: when the user's command
 * contains a one-shot temporal offset, register a schedule and return a
 * "scheduled" task record immediately — no LLM, no executor loop, no web
 * searches for stale data. The trigger (at the scheduled moment) re-enters
 * the normal executor via submitContextTask with the residual userCommand.
 *
 * Future weeks will extend `maybeHandleAsPlan` to dispatch quantifier
 * fan-outs ("open all images"), multi-verb chains ("search then email"),
 * and clarification prompts. Each extension slots a new branch in without
 * touching existing call sites.
 */

import crypto from "node:crypto";
import {
  createTaskRecord,
  emitTaskEvent,
  ensureRuntimeServices,
  markTaskSucceeded,
  updateTask
} from "../task-runtime.mjs";
import { detectTimeOffset } from "./trigger.mjs";

function buildPlanContextPacket({ userCommand, originalContextPacket = null }) {
  return {
    schema_version: "1.0",
    context_id: `ctx_${crypto.randomUUID()}`,
    trace_id: `trace_${crypto.randomUUID()}`,
    source_type: originalContextPacket?.source_type ?? "task_plan",
    source_app: originalContextPacket?.source_app ?? "lingxy.plan",
    capture_mode: "plan",
    security_level: originalContextPacket?.security_level ?? "internal",
    redaction_applied: false,
    text: userCommand,
    // Preserve attachments so they're still available when the schedule
    // fires and submitContextTask re-enters the executor.
    file_paths: originalContextPacket?.file_paths ?? [],
    image_paths: originalContextPacket?.image_paths ?? [],
    captured_at: new Date().toISOString()
  };
}

function formatRunAtRelative(isoString) {
  try {
    const d = new Date(isoString);
    const diffMs = d.getTime() - Date.now();
    if (diffMs < 0) return "立即";
    const mins = Math.round(diffMs / 60000);
    if (mins < 60) return `${mins} 分钟后`;
    const hours = Math.round(diffMs / 3600000);
    if (hours < 24) return `${hours} 小时后`;
    return d.toLocaleString("zh-CN");
  } catch {
    return isoString;
  }
}

/**
 * Entry point for submission paths (context/image/etc). Returns null when no
 * plan handling is needed (caller should fall through to normal routing),
 * or a {handled:true, task, schedule, message} record when the plan layer
 * took over. In that case the caller should return the record as-is — the
 * task is already inserted + emitted + marked succeeded, and the schedule
 * is persisted.
 */
export async function maybeHandleAsPlan({
  runtime,
  userCommand,
  contextPacket,
  executionMode
}) {
  ensureRuntimeServices(runtime);

  const offset = detectTimeOffset(userCommand);
  if (offset) {
    return handleTimeOffset({
      runtime,
      userCommand,
      contextPacket,
      executionMode,
      offset
    });
  }

  // Future: other trigger branches here. For now return null so the caller
  // falls through to the normal submission path.
  return null;
}

async function handleTimeOffset({
  runtime,
  userCommand,
  contextPacket,
  executionMode,
  offset
}) {
  if (!offset.residualCommand) {
    // User typed only the temporal phrase ("5 分钟后") with nothing to run.
    // Fall through so the normal executor can ask for clarification.
    return null;
  }
  const scheduler = runtime?.scheduler;
  if (!scheduler) return null;

  let schedule;
  try {
    schedule = scheduler.createSchedule({
      name: `Scheduled: ${offset.residualCommand.slice(0, 60)}`,
      description: `原始指令："${userCommand}"`,
      trigger: offset.trigger,
      action: {
        type: "task",
        target: offset.residualCommand.slice(0, 60),
        params: {
          userCommand: offset.residualCommand,
          // Attachments on the original request must survive into the
          // scheduled run so the scheduled executor can reach them too.
          contextText: userCommand,
          executorOverride: executionMode === "interactive" ? null : undefined,
          file_paths: contextPacket?.file_paths ?? [],
          image_paths: contextPacket?.image_paths ?? []
        }
      },
      executionMode: executionMode ?? "unattended_safe",
      catchupPolicy: "skip"
    }, { createdBy: "plan_executor" });
  } catch (error) {
    // Scheduler rejected the plan (trigger parse, limit reached, etc).
    // Fall through — the LLM path may still recover.
    return { handled: false, error: error.message };
  }

  const planContextPacket = buildPlanContextPacket({
    userCommand,
    originalContextPacket: contextPacket
  });
  const task = createTaskRecord({
    route: {
      intent: "scheduled_plan",
      executor: "plan_scheduler",
      requires_confirmation: false
    },
    contextPacket: planContextPacket,
    userCommand,
    executionMode,
    executorOverride: "plan_scheduler"
  });

  runtime.store.insertTask(task);
  emitTaskEvent({
    runtime,
    taskId: task.task_id,
    eventType: "task_created",
    payload: {
      kind: "scheduled_plan",
      schedule_id: schedule.schedule_id,
      next_run_at: schedule.next_run_at,
      residual_command: offset.residualCommand
    }
  });

  const replyText = `已安排 ${formatRunAtRelative(schedule.next_run_at)} 执行：${offset.residualCommand}`;
  updateTask(runtime, task, {
    status: "success",
    sub_status: "scheduled",
    progress: 1,
    result_summary: replyText
  }, true);
  emitTaskEvent({
    runtime,
    taskId: task.task_id,
    eventType: "inline_result",
    payload: { text: replyText, schedule_id: schedule.schedule_id }
  });
  emitTaskEvent({
    runtime,
    taskId: task.task_id,
    eventType: "success",
    payload: { text: replyText, schedule_id: schedule.schedule_id }
  });
  markTaskSucceeded(runtime, task);

  return {
    handled: true,
    task,
    schedule,
    message: replyText
  };
}
