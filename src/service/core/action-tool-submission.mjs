import crypto from "node:crypto";
import { routeIntent } from "./router/intent-router.mjs";
import {
  createTaskRecord,
  emitTaskEvent,
  ensureRuntimeServices,
  markTaskFailed,
  markTaskSucceeded,
  updateTask
} from "./task-runtime.mjs";
import { runToolAgentLoop } from "../executors/tool_using/agent-loop.mjs";

function buildActionContextPacket({ userCommand, sourceApp = "uca.console", captureMode = "manual" }) {
  return {
    schema_version: "1.0",
    context_id: `ctx_${crypto.randomUUID()}`,
    trace_id: `trace_${crypto.randomUUID()}`,
    source_type: "clipboard",
    source_app: sourceApp,
    capture_mode: captureMode,
    security_level: "internal",
    redaction_applied: false,
    text: userCommand,
    captured_at: new Date().toISOString()
  };
}

export async function submitActionToolTask({
  userCommand,
  executionMode = "interactive",
  sourceApp = "uca.console",
  captureMode = "manual",
  parentTaskId = null,
  retryCount = 0,
  runtime
}) {
  ensureRuntimeServices(runtime);
  const contextPacket = buildActionContextPacket({
    userCommand,
    sourceApp,
    captureMode
  });
  const route = routeIntent(userCommand);
  const task = createTaskRecord({
    route,
    contextPacket,
    userCommand,
    executionMode,
    parentTaskId,
    retryCount,
    executorOverride: "tool_using"
  });

  runtime.store.insertTask(task);
  runtime.queue.enqueue(task);

  const emitExecutorEvent = (eventType, payload) =>
    emitTaskEvent({
      runtime,
      taskId: task.task_id,
      eventType,
      payload
    });

  emitExecutorEvent("task_created", {
    source_type: contextPacket.source_type,
    executor: task.executor
  });

  const inspection = runtime.securityBroker.inspectContext(contextPacket, {
    taskId: task.task_id,
    trigger: "action_tool_submission"
  });
  if (!inspection.allowed) {
    markTaskFailed(runtime, task, {
      message: `Security broker blocked action tool task: ${inspection.reason}`
    });
    return {
      task,
      taskEvents: runtime.store.getTaskEvents(task.task_id),
      artifacts: []
    };
  }

  task.context_packet = inspection.contextPacket;
  runtime.store.updateTask(task.task_id, task);
  runtime.securityBroker.registerTaskRedactionMap(task.task_id, inspection.redactionMap);

  updateTask(runtime, task, {
    status: "running",
    sub_status: "tool_loop"
  }, true);
  runtime.queue.markRunning(task.task_id);

  try {
    const loopResult = await runToolAgentLoop({
      task,
      runtime: {
        ...runtime,
        emitTaskEvent: emitExecutorEvent
      }
    });

    if (loopResult.status === "waiting_external_decision") {
      updateTask(runtime, task, {
        status: "partial_success",
        sub_status: "waiting_external_decision",
        retryable: true
      }, true);
      markTaskSucceeded(runtime, task);
      return {
        task,
        taskEvents: runtime.store.getTaskEvents(task.task_id),
        pendingApproval: loopResult.approval
      };
    }

    if (loopResult.status === "partial_success") {
      updateTask(runtime, task, {
        status: "partial_success",
        sub_status: "tool_loop_stopped"
      }, true);
      emitExecutorEvent("partial_success", {
        summary: loopResult.final_text
      });
      markTaskSucceeded(runtime, task);
      return {
        task,
        taskEvents: runtime.store.getTaskEvents(task.task_id),
        artifacts: loopResult.artifacts ?? []
      };
    }

    if (loopResult.status !== "success") {
      markTaskFailed(runtime, task, {
        message: loopResult.error ?? "Tool loop failed."
      });
      return {
        task,
        taskEvents: runtime.store.getTaskEvents(task.task_id),
        artifacts: []
      };
    }

    updateTask(runtime, task, {
      status: "success",
      sub_status: "completed",
      progress: 1
    }, true);
    emitExecutorEvent("success", {
      summary: loopResult.final_text
    });
    markTaskSucceeded(runtime, task);

    return {
      task,
      taskEvents: runtime.store.getTaskEvents(task.task_id),
      artifacts: loopResult.artifacts ?? []
    };
  } catch (error) {
    markTaskFailed(runtime, task, error);
    return {
      task,
      taskEvents: runtime.store.getTaskEvents(task.task_id),
      artifacts: []
    };
  }
}
