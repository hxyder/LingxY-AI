/**
 * TaskPlan executor.
 *
 * Week 1 revised — the trigger now only detects whether a time phrase is
 * present; interpretation goes to the understanding LLM whenever the
 * command isn't trivially a "<time phrase> <short residual>" shape. This
 * fixes task_829f8d61 where the old regex-only path classified
 *   "打开 outlook，在日历里新建一个 30 分钟的任务，标题叫吃饭。时间在明天下午1点"
 * as a 15-hour-later schedule, stripping the event time and leaving a
 * truncated residual.
 *
 * Dispatch:
 * - No time phrase                       → return null, fall through
 * - Trivial "N 分钟后 X" (≤40 chars X)    → deterministic schedule, 0 LLM
 * - Any other time-phrase command        → 1 LLM call (understandCommand)
 *                                          which returns schedule / immediate /
 *                                          needs_clarification; we act on
 *                                          that classification.
 */

import crypto from "node:crypto";
import {
  createTaskRecord,
  emitTaskEvent,
  ensureRuntimeServices,
  markTaskSucceeded,
  updateTask
} from "../task-runtime.mjs";
import { hasTimePhrase } from "./trigger.mjs";
import { understandCommand } from "./understand.mjs";

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

function createScheduledTaskRecord({
  runtime,
  userCommand,
  contextPacket,
  executionMode,
  replyText,
  schedule
}) {
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
      residual_command: schedule.action_params?.userCommand ?? null
    }
  });
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
  return task;
}

function createClarifyTaskRecord({
  runtime,
  userCommand,
  contextPacket,
  executionMode,
  clarificationQuestion
}) {
  const planContextPacket = buildPlanContextPacket({
    userCommand,
    originalContextPacket: contextPacket
  });
  const task = createTaskRecord({
    route: {
      intent: "clarify",
      executor: "plan_clarify",
      requires_confirmation: false
    },
    contextPacket: planContextPacket,
    userCommand,
    executionMode,
    executorOverride: "plan_clarify"
  });
  runtime.store.insertTask(task);
  emitTaskEvent({
    runtime,
    taskId: task.task_id,
    eventType: "task_created",
    payload: { kind: "plan_clarify" }
  });
  updateTask(runtime, task, {
    status: "success",
    sub_status: "clarify",
    progress: 1,
    result_summary: clarificationQuestion
  }, true);
  emitTaskEvent({
    runtime,
    taskId: task.task_id,
    eventType: "inline_result",
    payload: { text: clarificationQuestion }
  });
  emitTaskEvent({
    runtime,
    taskId: task.task_id,
    eventType: "success",
    payload: { text: clarificationQuestion }
  });
  markTaskSucceeded(runtime, task);
  return task;
}

function buildScheduleFromDecision({ runtime, userCommand, contextPacket, executionMode, runAtIso, residualCommand }) {
  const scheduler = runtime?.scheduler;
  if (!scheduler) return null;
  try {
    return scheduler.createSchedule({
      name: `Scheduled: ${residualCommand.slice(0, 60)}`,
      description: `原始指令："${userCommand}"`,
      trigger: { type: "at", run_at: runAtIso },
      action: {
        type: "task",
        target: residualCommand.slice(0, 60),
        params: {
          userCommand: residualCommand,
          contextText: userCommand,
          file_paths: contextPacket?.file_paths ?? [],
          image_paths: contextPacket?.image_paths ?? []
        }
      },
      executionMode: executionMode ?? "unattended_safe",
      catchupPolicy: "skip"
    }, { createdBy: "plan_executor" });
  } catch {
    return null;
  }
}

export async function maybeHandleAsPlan({
  runtime,
  userCommand,
  contextPacket,
  executionMode,
  // Dependency injection for tests — defaults to the real LLM understanding
  // call but can be overridden with a stub that returns a fixed decision.
  understand = understandCommand
}) {
  ensureRuntimeServices(runtime);
  if (!hasTimePhrase(userCommand)) return null;

  // Time phrase detected — the LLM decides what it means. No regex
  // "looks simple enough, skip the LLM" fast path: that was the exact
  // classifier-in-disguise we were trying to remove. When the LLM is
  // unavailable, we fall through so the normal executor handles it.
  let decision;
  try {
    decision = await understand({ userCommand });
  } catch {
    return null;
  }
  if (!decision) return null;

  if (decision.interpretation === "immediate") {
    return null;
  }

  if (decision.interpretation === "needs_clarification" && decision.clarification_question) {
    const task = createClarifyTaskRecord({
      runtime, userCommand, contextPacket, executionMode,
      clarificationQuestion: decision.clarification_question
    });
    return { handled: true, task, message: decision.clarification_question };
  }

  if (decision.interpretation === "schedule"
    && decision.schedule_at
    && decision.residual_command) {
    const schedule = buildScheduleFromDecision({
      runtime,
      userCommand,
      contextPacket,
      executionMode,
      runAtIso: decision.schedule_at,
      residualCommand: decision.residual_command
    });
    if (schedule) {
      const replyText = `已安排 ${formatRunAtRelative(schedule.next_run_at)} 执行：${decision.residual_command}`;
      const task = createScheduledTaskRecord({
        runtime, userCommand, contextPacket, executionMode, replyText, schedule
      });
      return { handled: true, task, schedule, message: replyText };
    }
  }

  return null;
}
