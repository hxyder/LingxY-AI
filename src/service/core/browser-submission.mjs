import crypto from "node:crypto";
import { createArtifactStore } from "../store/artifact-store.mjs";
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

function createSelectionMetadata(capture) {
  return {
    page_title: capture.pageTitle,
    context_before: capture.contextBefore,
    context_after: capture.contextAfter,
    anchor_text: capture.anchorText,
    image_url: capture.imageUrl,
    tab_id: capture.tabId
  };
}

function normalizeCaptureText(capture) {
  if (capture.text) {
    return capture.text;
  }

  if (capture.sourceType === "text_selection") {
    return capture.selectionText ?? "";
  }

  if (capture.sourceType === "link" && capture.url) {
    return `Fetched content placeholder for ${capture.url}`;
  }

  if (capture.sourceType === "webpage" && capture.url) {
    return `Webpage placeholder extraction for ${capture.url}`;
  }

  if (capture.sourceType === "image" && capture.imageUrl) {
    return `Image capture placeholder for ${capture.imageUrl}`;
  }

  return "";
}

export function buildBrowserContextPacket({
  capture,
  traceId,
  contextId,
  capturedAt = new Date().toISOString()
}) {
  const text = normalizeCaptureText(capture);

  return {
    schema_version: "1.0",
    context_id: contextId,
    trace_id: traceId,
    source_type: capture.sourceType,
    source_app: capture.browser,
    capture_mode: "extension",
    security_level: "public",
    redaction_applied: false,
    text,
    html: capture.html,
    url: capture.url,
    selection_metadata: createSelectionMetadata(capture),
    captured_at: capturedAt
  };
}

async function runFastExecutor({ task, runtime }) {
  const fastExecutor = runtime.executors?.find((executor) => executor.id === "fast");
  if (!fastExecutor) {
    return { status: "queued" };
  }

  const controller = new AbortController();
  registerActiveExecution(runtime, task.task_id, {
    cancel: async () => controller.abort()
  });
  runtime.queue.markRunning(task.task_id);
  updateTask(runtime, task, {
    status: "running",
    sub_status: "fast_executor"
  }, true);

  try {
    for await (const event of fastExecutor.execute(task, { signal: controller.signal })) {
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

export async function submitBrowserTask({
  capture,
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
  const artifactStore = runtime.artifactStore ?? createArtifactStore();
  const route = routeIntent(userCommand);
  const rawContextPacket = buildBrowserContextPacket({
    capture,
    traceId: `trace_${crypto.randomUUID()}`,
    contextId: `ctx_${crypto.randomUUID()}`
  });
  const inspection = runtime.securityBroker.inspectContext(rawContextPacket, {
    trigger: "browser_submission"
  });
  const contextPacket = inspection.allowed ? inspection.contextPacket : rawContextPacket;

  const task = createTaskRecord({
    route,
    contextPacket,
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
      source_type: contextPacket.source_type,
      url: contextPacket.url ?? null
    }
  });

  if (!inspection.allowed) {
    markTaskFailed(runtime, task, {
      message: `Security broker blocked context capture: ${inspection.reason}`
    });
    return { task, taskEvents: store.getTaskEvents(task.task_id), artifacts: [] };
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
    return { task, taskEvents: store.getTaskEvents(task.task_id), artifacts: [] };
  }

  if (capture.sourceType === "image") {
    updateTask(runtime, task, {
      status: "unsupported",
      sub_status: "image_pipeline_not_available_in_phase_1c"
    }, true);
    emitTaskEvent({
      runtime,
      taskId: task.task_id,
      eventType: "unsupported",
      payload: {
        reason: "image_pipeline_not_available_in_phase_1c"
      }
    });
    queue.markFinished(task.task_id);
    return { task, taskEvents: store.getTaskEvents(task.task_id), artifacts: [] };
  }

  if (capture.sourceType === "link" && !capture.html) {
    const outputDir = await artifactStore.createTaskOutputDir(task.task_id, new Date(task.created_at));
    emitTaskEvent({
      runtime,
      taskId: task.task_id,
      eventType: "step_started",
      payload: {
        step: "web_fetch_placeholder",
        output_dir: outputDir
      }
    });
    emitTaskEvent({
      runtime,
      taskId: task.task_id,
      eventType: "step_finished",
      payload: {
        step: "web_fetch_placeholder"
      }
    });
  }

  await runFastExecutor({ task, runtime });

  return {
    task,
    taskEvents: store.getTaskEvents(task.task_id),
    artifacts: []
  };
}

export function listRecentTasks(store, limit = 5) {
  return store.listTasks()
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
    .slice(0, limit)
    .map((task) => ({
      task_id: task.task_id,
      status: task.status,
      intent: task.intent,
      source_type: task.context_packet.source_type,
      url: task.context_packet.url ?? null,
      created_at: task.created_at
    }));
}
