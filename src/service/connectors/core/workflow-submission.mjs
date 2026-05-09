import crypto from "node:crypto";
import {
  auditSubmissionBoundary,
  createTaskRecord,
  emitTaskEvent,
  ensureRuntimeServices,
  markTaskFailed,
  markTaskSucceeded,
  updateTask
} from "../../core/task-runtime.mjs";
import { runConnectorWorkflow } from "./workflow-dispatcher.mjs";

function buildContextPacket({ workflowId, userCommand = "" }) {
  return {
    schema_version: "1.0",
    context_id: `ctx_${crypto.randomUUID()}`,
    trace_id: `trace_${crypto.randomUUID()}`,
    source_type: "connector_workflow",
    source_app: "uca.connector",
    capture_mode: "workflow",
    security_level: "internal",
    redaction_applied: false,
    text: userCommand || workflowId,
    captured_at: new Date().toISOString()
  };
}

function buildWorkflowBoundaryContext({ workflowId, workflow }) {
  const requestedToolIds = new Set(["connector_workflow_run"]);
  for (const step of workflow?.steps ?? []) {
    if (typeof step?.tool === "string" && step.tool.trim()) {
      requestedToolIds.add(step.tool.trim());
    }
  }
  return {
    requestedToolIds: [...requestedToolIds].sort(),
    requestedWorkflowIds: workflowId ? [workflowId] : []
  };
}

function summarizeSubmissionBoundaryBlock(boundary) {
  const tools = Array.isArray(boundary?.blocked_tools)
    ? boundary.blocked_tools.map((tool) => tool.tool_id).filter(Boolean)
    : [];
  const workflows = Array.isArray(boundary?.requested_workflows)
    ? boundary.requested_workflows.filter(Boolean)
    : [];
  const workflowText = workflows.length > 0 ? `workflow "${workflows.join(", ")}"` : "the requested workflow";
  const toolText = tools.length > 0 ? ` because it would call forbidden tool "${tools.join(", ")}"` : "";
  return `Submission blocked by policy: ${workflowText}${toolText}.`;
}

export async function submitConnectorWorkflowTask({
  runtime,
  workflowId,
  input = {},
  state = {},
  userCommand = "",
  executionMode = "interactive",
  bypassDedupe = false
}) {
  ensureRuntimeServices(runtime);
  const workflow = runtime.connectorCatalog?.getWorkflow?.(workflowId) ?? null;
  const route = {
    intent: "connector_workflow",
    executor: "connector_workflow",
    requires_confirmation: false
  };
  const task = createTaskRecord({
    route,
    contextPacket: buildContextPacket({ workflowId, userCommand }),
    userCommand: userCommand || `Run connector workflow ${workflowId}`,
    executionMode,
    bypassDedupe,
    executorOverride: "connector_workflow",
    submissionKind: "connector_workflow",
    boundaryContext: buildWorkflowBoundaryContext({ workflowId, workflow })
  });

  runtime.store.insertTask(task);
  auditSubmissionBoundary(runtime, task);
  if (task.submission_boundary?.blocking) {
    const finalText = summarizeSubmissionBoundaryBlock(task.submission_boundary);
    markTaskFailed(runtime, task, {
      code: "submission_boundary_blocked",
      message: finalText
    });
    return {
      task,
      taskEvents: runtime.store.getTaskEvents(task.task_id),
      blocked: true,
      final_text: finalText,
      workflowResult: {
        status: "failed",
        error: finalText
      }
    };
  }
  runtime.queue.enqueue(task);
  emitTaskEvent({
    runtime,
    taskId: task.task_id,
    eventType: "task_created",
    payload: {
      executor: "connector_workflow",
      workflow_id: workflowId
    }
  });

  runtime.queue.markRunning(task.task_id);
  updateTask(runtime, task, {
    status: "running",
    sub_status: "connector_workflow"
  }, true);

  const emitForTask = (eventType, payload) =>
    emitTaskEvent({
      runtime,
      taskId: task.task_id,
      eventType,
      payload
    });

  try {
    const result = await runConnectorWorkflow({
      runtime,
      workflowId,
      input,
      state,
      task,
      emitTaskEvent: emitForTask
    });

    if (result.status === "waiting_external_decision") {
      updateTask(runtime, task, {
        status: "partial_success",
        sub_status: "waiting_external_decision",
        retryable: true,
        progress: 0.5,
        result_summary: "Waiting for user confirmation."
      }, true);
      markTaskSucceeded(runtime, task);
      return {
        task,
        taskEvents: runtime.store.getTaskEvents(task.task_id),
        pendingApproval: result.approval,
        workflowResult: result
      };
    }

    if (result.status !== "success") {
      markTaskFailed(runtime, task, {
        message: result.error ?? "Connector workflow failed."
      });
      return {
        task,
        taskEvents: runtime.store.getTaskEvents(task.task_id),
        workflowResult: result
      };
    }

    updateTask(runtime, task, {
      status: "success",
      sub_status: "completed",
      progress: 1,
      result_summary: result.result?.observation ?? `${workflowId} completed.`
    }, true);
    emitForTask("success", {
      text: result.result?.observation ?? `${workflowId} completed.`,
      workflow_id: workflowId
    });
    markTaskSucceeded(runtime, task);
    return {
      task,
      taskEvents: runtime.store.getTaskEvents(task.task_id),
      workflowResult: result
    };
  } catch (error) {
    markTaskFailed(runtime, task, error);
    return {
      task,
      taskEvents: runtime.store.getTaskEvents(task.task_id),
      workflowResult: {
        status: "failed",
        error: error.message
      }
    };
  }
}

export async function resumeConnectorWorkflowTask({
  runtime,
  taskId,
  workflowId,
  input = {},
  state = {},
  approvalId = null,
  actor = null
} = {}) {
  ensureRuntimeServices(runtime);
  const task = runtime.store.getTask?.(taskId);
  if (!task) {
    throw new Error(`Cannot resume connector workflow: task not found: ${taskId}`);
  }
  if (task.sub_status !== "waiting_external_decision") {
    throw new Error(`Cannot resume connector workflow: task ${taskId} is not waiting for approval.`);
  }

  runtime.queue.markRunning(task.task_id);
  updateTask(runtime, task, {
    status: "running",
    sub_status: "approval_resuming",
    retryable: true,
    progress: Math.max(task.progress ?? 0, 0.55)
  }, true);

  const emitForTask = (eventType, payload) =>
    emitTaskEvent({
      runtime,
      taskId: task.task_id,
      eventType,
      payload
    });

  emitForTask("approval_resume_started", {
    approval_id: approvalId,
    workflow_id: workflowId,
    actor
  });

  try {
    const result = await runConnectorWorkflow({
      runtime,
      workflowId,
      input,
      state,
      task,
      emitTaskEvent: emitForTask
    });

    if (result.status === "waiting_external_decision") {
      updateTask(runtime, task, {
        status: "partial_success",
        sub_status: "waiting_external_decision",
        retryable: true,
        progress: Math.max(task.progress ?? 0, 0.6),
        result_summary: "Waiting for user confirmation."
      }, true);
      markTaskSucceeded(runtime, task);
      return {
        task,
        taskEvents: runtime.store.getTaskEvents(task.task_id),
        pendingApproval: result.approval,
        workflowResult: result,
        resumed_same_task: true
      };
    }

    if (result.status !== "success") {
      markTaskFailed(runtime, task, {
        message: result.error ?? "Connector workflow resume failed."
      });
      return {
        task,
        taskEvents: runtime.store.getTaskEvents(task.task_id),
        workflowResult: result,
        resumed_same_task: true
      };
    }

    updateTask(runtime, task, {
      status: "success",
      sub_status: "completed",
      progress: 1,
      result_summary: result.result?.observation ?? `${workflowId} completed.`
    }, true);
    emitForTask("success", {
      text: result.result?.observation ?? `${workflowId} completed.`,
      workflow_id: workflowId,
      approval_id: approvalId,
      approval_resumed_same_task: true
    });
    markTaskSucceeded(runtime, task);
    return {
      task,
      taskEvents: runtime.store.getTaskEvents(task.task_id),
      workflowResult: result,
      resumed_same_task: true
    };
  } catch (error) {
    markTaskFailed(runtime, task, error);
    return {
      task,
      taskEvents: runtime.store.getTaskEvents(task.task_id),
      workflowResult: {
        status: "failed",
        error: error.message
      },
      resumed_same_task: true
    };
  }
}
