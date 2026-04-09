import crypto from "node:crypto";
import { routeIntent } from "./router/intent-router.mjs";
import {
  applyExecutorEvent,
  createTaskRecord,
  emitTaskEvent,
  ensureRuntimeServices,
  markTaskFailed,
  markTaskSucceeded,
  registerActiveExecution,
  unregisterActiveExecution,
  updateTask
} from "./task-runtime.mjs";

function normalizeContextPacket(contextPacket) {
  return {
    schema_version: "1.0",
    context_id: contextPacket.context_id ?? `ctx_${crypto.randomUUID()}`,
    trace_id: contextPacket.trace_id ?? `trace_${crypto.randomUUID()}`,
    source_type: contextPacket.source_type ?? "clipboard",
    source_app: contextPacket.source_app ?? "uca.runtime",
    capture_mode: contextPacket.capture_mode ?? "manual",
    security_level: contextPacket.security_level ?? "internal",
    redaction_applied: Boolean(contextPacket.redaction_applied),
    text: contextPacket.text ?? "",
    html: contextPacket.html,
    url: contextPacket.url,
    selection_metadata: contextPacket.selection_metadata ?? {},
    file_paths: contextPacket.file_paths,
    image_paths: contextPacket.image_paths,
    captured_at: contextPacket.captured_at ?? new Date().toISOString()
  };
}

function pickRunnableExecutor(task, runtime) {
  if (task.executor === "multi_modal") {
    return runtime.executors?.find((executor) => executor.id === "multi_modal")
      ?? runtime.executors?.find((executor) => executor.id === "fast")
      ?? null;
  }

  if (task.executor === "tool_using") {
    return runtime.executors?.find((executor) => executor.id === "fast") ?? null;
  }

  if (task.executor === "kimi" && !runtime.kimiRuntime) {
    return runtime.executors?.find((executor) => executor.id === "fast") ?? null;
  }

  return runtime.executors?.find((executor) => executor.id === task.executor)
    ?? runtime.executors?.find((executor) => executor.id === "fast")
    ?? null;
}

async function runExecutor({ runtime, task, executor }) {
  const controller = new AbortController();
  registerActiveExecution(runtime, task.task_id, {
    cancel: async () => controller.abort()
  });
  runtime.queue.markRunning(task.task_id);
  updateTask(runtime, task, {
    status: "running",
    sub_status: `${executor.id}_executor`
  }, true);

  try {
    for await (const event of executor.execute(task, { signal: controller.signal })) {
      emitTaskEvent({
        runtime,
        taskId: task.task_id,
        eventType: event.event_type,
        payload: event.payload
      });
      applyExecutorEvent(runtime, task, {
        type: event.event_type,
        ...event.payload
      });
    }

    if (task.status !== "success") {
      updateTask(runtime, task, {
        status: "success",
        sub_status: "completed",
        progress: 1
      }, true);
    }
    markTaskSucceeded(runtime, task);
    return { status: "success" };
  } catch (error) {
    markTaskFailed(runtime, task, error);
    return { status: task.status };
  } finally {
    unregisterActiveExecution(runtime, task.task_id);
  }
}

export async function submitContextTask({
  contextPacket,
  userCommand,
  runtime,
  executionMode,
  parentTaskId = null,
  retryCount = 0,
  executorOverride = null
}) {
  ensureRuntimeServices(runtime);
  const store = runtime.store;
  const queue = runtime.queue;
  const route = routeIntent(userCommand);
  const rawContextPacket = normalizeContextPacket(contextPacket);
  const inspection = runtime.securityBroker.inspectContext(rawContextPacket, {
    trigger: "context_submission"
  });
  const normalizedContextPacket = inspection.allowed ? inspection.contextPacket : rawContextPacket;

  const task = createTaskRecord({
    route,
    contextPacket: normalizedContextPacket,
    userCommand,
    executionMode,
    parentTaskId,
    retryCount,
    executorOverride
  });

  store.insertTask(task);
  const enqueued = queue.enqueue(task);
  emitTaskEvent({
    runtime,
    taskId: task.task_id,
    eventType: "task_created",
    payload: {
      source_type: normalizedContextPacket.source_type,
      executor: task.executor
    }
  });

  if (!inspection.allowed) {
    markTaskFailed(runtime, task, {
      message: `Security broker blocked context capture: ${inspection.reason}`
    });
    return {
      task,
      taskEvents: store.getTaskEvents(task.task_id),
      artifacts: []
    };
  }

  runtime.securityBroker.registerTaskRedactionMap(task.task_id, inspection.redactionMap);

  if (!enqueued.accepted) {
    updateTask(runtime, task, {
      status: "partial_success",
      sub_status: "deduped_recent_submission"
    }, true);
    emitTaskEvent({
      runtime,
      taskId: task.task_id,
      eventType: "partial_success",
      payload: {
        deduped_task_id: enqueued.dedupedTaskId
      }
    });
    markTaskSucceeded(runtime, task);
    return {
      task,
      taskEvents: store.getTaskEvents(task.task_id),
      artifacts: []
    };
  }

  const executor = pickRunnableExecutor(task, runtime);
  if (!executor) {
    markTaskFailed(runtime, task, {
      message: `No runnable executor found for ${task.executor}`
    });
    return {
      task,
      taskEvents: store.getTaskEvents(task.task_id),
      artifacts: []
    };
  }

  await runExecutor({ runtime, task, executor });
  return {
    task,
    taskEvents: store.getTaskEvents(task.task_id),
    artifacts: []
  };
}
