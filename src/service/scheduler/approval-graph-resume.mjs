import crypto from "node:crypto";
import { resolveApprovalResumeMetadata } from "./approval-resume-state.mjs";

function nowIso() {
  return new Date().toISOString();
}

function eventId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function appendTaskEvent(runtime, taskId, eventType, payload = {}, ts = nowIso()) {
  const event = {
    event_id: eventId("evt"),
    task_id: taskId,
    ts,
    event_type: eventType,
    payload
  };
  runtime.store?.appendEvent?.(event);
  runtime.eventBus?.publish?.(event);
  return event;
}

function patchTask(runtime, task, patch) {
  Object.assign(task, patch);
  runtime.store?.updateTask?.(task.task_id, task);
  return task;
}

function mergeApprovalOverrides(approval, overrides = null) {
  if (!overrides || typeof overrides !== "object" || Object.keys(overrides).length === 0) {
    return approval;
  }
  return {
    ...approval,
    proposed_params: {
      ...(approval.proposed_params ?? {}),
      ...overrides
    }
  };
}

export async function resumeAgentToolApprovalInOriginalTask({
  runtime,
  approval,
  overrides = null,
  actor = null,
  decidedAt = nowIso()
} = {}) {
  const executableApproval = mergeApprovalOverrides(approval, overrides);
  if (executableApproval?.source_type !== "agent_tool_call") {
    return null;
  }
  const taskId = executableApproval.metadata?.task_id;
  const toolId = executableApproval.proposed_target || executableApproval.metadata?.tool_id;
  if (!taskId || !toolId) {
    return { same_task_resume: false, executed: false, reason: "missing_task_or_tool", tool_id: toolId ?? null };
  }
  const task = runtime.store?.getTask?.(taskId);
  const tool = runtime.actionToolRegistry?.get?.(toolId);
  if (!task || !tool || typeof tool.execute !== "function") {
    return {
      same_task_resume: false,
      executed: false,
      reason: task ? "tool_not_found" : "task_not_found",
      tool_id: toolId
    };
  }

  const approvalResume = resolveApprovalResumeMetadata(executableApproval.metadata, {
    decision: "approved",
    decidedAt,
    actor,
    resultingTaskId: taskId
  }).approval_resume ?? executableApproval.metadata?.approval_resume ?? null;
  patchTask(runtime, task, {
    status: "running",
    sub_status: "approval_resuming",
    updated_at: decidedAt
  });
  appendTaskEvent(runtime, taskId, "approval_resume_started", {
    approval_id: executableApproval.approval_id,
    tool_id: toolId,
    same_task_resume: true,
    approval_resume: approvalResume
  }, decidedAt);

  const deferredToolContext = executableApproval.metadata?.deferred_tool_context ?? {};
  let result = null;
  try {
    result = await tool.execute(executableApproval.proposed_params ?? {}, {
      ...(runtime.toolContext ?? {}),
      runtime,
      task,
      outputDir: runtime.toolContext?.outputDir ?? null,
      transcript: Array.isArray(deferredToolContext.transcript)
        ? deferredToolContext.transcript
        : []
    });
  } catch (error) {
    result = {
      success: false,
      observation: error?.message ?? String(error),
      error
    };
  }

  const success = result?.success !== false;
  const observation = String(result?.observation ?? (success ? `Completed ${toolId}.` : `Failed ${toolId}.`));
  appendTaskEvent(runtime, taskId, "tool_call_completed", {
    tool_id: toolId,
    success,
    observation,
    args: executableApproval.proposed_params ?? {},
    approval_id: executableApproval.approval_id,
    same_task_resume: true,
    approval_resume: approvalResume
  });

  const terminalType = success ? "success" : "failed";
  const terminalPatch = success
    ? {
      status: "success",
      sub_status: "completed",
      progress: 1,
      result_summary: observation,
      updated_at: nowIso()
    }
    : {
      status: "failed",
      sub_status: "failed",
      progress: task.progress ?? 0.95,
      result_summary: observation,
      failure_category: "tool_execution_failed",
      failure_user_message: observation,
      retryable: true,
      updated_at: nowIso()
    };
  patchTask(runtime, task, terminalPatch);
  appendTaskEvent(runtime, taskId, terminalType, {
    text: observation,
    approval_id: executableApproval.approval_id,
    tool_id: toolId,
    same_task_resume: true,
    approval_resume: approvalResume
  });

  return {
    same_task_resume: true,
    executed: true,
    tool_id: toolId,
    success,
    observation,
    task,
    toolResult: result
  };
}
