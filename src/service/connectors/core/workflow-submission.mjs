import crypto from "node:crypto";
import {
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

export async function submitConnectorWorkflowTask({
  runtime,
  workflowId,
  input = {},
  state = {},
  userCommand = "",
  executionMode = "interactive"
}) {
  ensureRuntimeServices(runtime);
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
    executorOverride: "connector_workflow"
  });

  runtime.store.insertTask(task);
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
