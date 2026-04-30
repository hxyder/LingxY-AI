/**
 * TaskPlan executor — schedule / clarify task-record builders.
 *
 * History: this file used to host both the LLM-driven schedule/clarify
 * dispatcher (`maybeHandleAsPlan` calling `understandCommand`) AND the
 * task-record builders that materialise those dispatch outcomes. After the
 * front-classifier merge, the SemanticRouter emits a unified
 * `interpretation` field (immediate / schedule / needs_clarification) on
 * the same tool call that already drove routing. `triage.mjs` reads that
 * field and calls the builders below directly. The dispatcher / understand
 * LLM is gone — there is exactly one front LLM and exactly one place that
 * branches on its verdict.
 */

import crypto from "node:crypto";
import {
  createTaskRecord,
  emitTaskEvent,
  ensureRuntimeServices,
  markTaskSucceeded,
  updateTask
} from "../task-runtime.mjs";
import { buildSideEffectContract } from "../policy/side-effect-contracts.mjs";

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
export function formatRunAtRelative(isoString) {
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

export function createScheduledTaskRecord({
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

export function createClarifyTaskRecord({
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

export function buildScheduleFromDecision({ runtime, userCommand, contextPacket, executionMode, runAtIso, residualCommand, decision = null }) {
  const scheduler = runtime?.scheduler;
  if (!scheduler) return null;
  const sideEffectContract = buildSideEffectContract({
    policyGroups: decision?.required_policy_groups ?? [],
    runtime,
    inferPolicyGroups: true,
    sources: [userCommand, residualCommand],
    task: {
      user_command: residualCommand,
      task_spec: {
        user_goal_text: residualCommand,
        success_contract: {
          required_policy_groups: decision?.required_policy_groups ?? []
        }
      },
      context_packet: {
        ...(contextPacket ?? {}),
        text: [contextPacket?.text, userCommand, residualCommand].filter(Boolean).join("\n")
      }
    }
  });
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
      catchupPolicy: "skip",
      metadata: sideEffectContract ? { side_effect_contract: sideEffectContract } : {}
    }, { createdBy: "plan_executor" });
  } catch {
    return null;
  }
}
