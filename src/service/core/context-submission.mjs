import crypto from "node:crypto";
import { createArtifactStore } from "../store/artifact-store.mjs";
import { detectRequestedOutputFormat, writeRequestedArtifacts } from "../executors/kimi/output-format.mjs";
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
  const artifactStore = runtime.artifactStore ?? createArtifactStore();
  const generatedArtifacts = [];
  let inlineText = "";
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
      if (event.event_type === "inline_result" || event.event_type === "success") {
        inlineText = event.payload?.text ?? event.payload?.summary ?? inlineText;
      }
      if (event.event_type === "artifact_created" && event.payload?.path) {
        const artifactRecord = artifactStore.registerArtifact(task.task_id, event.payload.path, event.payload.mime ?? event.payload.mime_type);
        runtime.store.appendArtifact(artifactRecord);
        generatedArtifacts.push(artifactRecord);
      }
      applyExecutorEvent(runtime, task, {
        type: event.event_type,
        ...event.payload
      });
    }

    const requestedFormat = detectRequestedOutputFormat(task.user_command);
    if (requestedFormat.id !== "conversational" && generatedArtifacts.length === 0) {
      const outputDir = await artifactStore.createTaskOutputDir(task.task_id, new Date(task.created_at));
      const artifacts = await writeRequestedArtifacts({
        assistantText: inlineText || task.context_packet?.text || task.user_command,
        outputDir,
        requestedFormat
      });
      for (const artifact of artifacts) {
        const artifactRecord = artifactStore.registerArtifact(task.task_id, artifact.path, artifact.mime_type);
        runtime.store.appendArtifact(artifactRecord);
        generatedArtifacts.push(artifactRecord);
        emitTaskEvent({
          runtime,
          taskId: task.task_id,
          eventType: "artifact_created",
          payload: {
            path: artifact.path,
            mime: artifact.mime_type
          }
        });
      }
    }

    if (task.status !== "success") {
      updateTask(runtime, task, {
        status: "success",
        sub_status: "completed",
        progress: 1
      }, true);
    }
    markTaskSucceeded(runtime, task);
    return { status: "success", artifacts: generatedArtifacts };
  } catch (error) {
    markTaskFailed(runtime, task, error);
    return { status: task.status, artifacts: generatedArtifacts };
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

  const executionResult = await runExecutor({ runtime, task, executor });
  return {
    task,
    taskEvents: store.getTaskEvents(task.task_id),
    artifacts: executionResult.artifacts ?? []
  };
}
