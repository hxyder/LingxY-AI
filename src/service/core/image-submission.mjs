import crypto from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import { runImageOcr } from "../extractors/image_ocr.mjs";
import { createArtifactStore } from "../store/artifact-store.mjs";
import { buildKimiTaskPackage } from "../executors/kimi/task-package-builder.mjs";
import { executeKimiTask } from "../executors/kimi/kimi-cli-executor.mjs";
import {
  resolveProviderForTask,
  resolveCodeCliRuntimeForTask,
  describeCodeCliRuntime,
  describeResolvedProvider
} from "../executors/shared/provider-resolver.mjs";
import { appendAuditLog } from "../security/audit-log.mjs";
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

function attachProviderFieldsToEvent(descriptor, payload) {
  if (!descriptor) return payload ?? {};
  const base = payload ?? {};
  return {
    ...base,
    provider_id: descriptor.provider_id ?? null,
    provider_kind: descriptor.provider_kind ?? null,
    provider_name: descriptor.provider_name ?? null,
    model: descriptor.model ?? null,
    transport: descriptor.transport ?? null
  };
}

export function buildImageContextPacket({
  imagePaths,
  source = "file",
  sourceApp = "uca.helper",
  captureMode = "manual",
  ocrResult = null,
  traceId,
  contextId,
  capturedAt = new Date().toISOString()
}) {
  const primaryImagePath = imagePaths[0];
  return {
    schema_version: "1.0",
    context_id: contextId,
    trace_id: traceId,
    source_type: "image",
    source_app: sourceApp,
    capture_mode: captureMode,
    security_level: "internal",
    redaction_applied: false,
    text: ocrResult?.ocr_text ?? "",
    image_paths: imagePaths,
    selection_metadata: {
      image_source: source,
      primary_image_path: primaryImagePath
    },
    image_metadata: {
      source,
      ocr_text: ocrResult?.ocr_text ?? null,
      ocr_confidence: ocrResult?.ocr_confidence ?? null,
      ocr_low_confidence_regions: ocrResult?.ocr_low_confidence_regions ?? [],
      ocr_engine: ocrResult?.ocr_engine ?? null
    },
    captured_at: capturedAt
  };
}

async function runKimiImageFallback({ task, runtime, artifactStore, store, queue, cliRuntime = null, providerDescriptor = null }) {
  const controller = new AbortController();
  registerActiveExecution(runtime, task.task_id, { cancel: async () => controller.abort() });

  const activeCliRuntime = cliRuntime ?? resolveCodeCliRuntimeForTask("vision", runtime.kimiRuntime);
  if (!activeCliRuntime) {
    markTaskFailed(runtime, task, { message: "No code_cli runtime resolved for image fallback." });
    unregisterActiveExecution(runtime, task.task_id);
    return { status: "failed", artifacts: [] };
  }
  const activeDescriptor = providerDescriptor ?? describeCodeCliRuntime(activeCliRuntime);

  try {
    queue.markRunning(task.task_id);
    updateTask(runtime, task, { status: "running", sub_status: "kimi_image_fallback" }, true);

    emitTaskEvent({
      runtime,
      taskId: task.task_id,
      eventType: "provider_resolved",
      payload: attachProviderFieldsToEvent(activeDescriptor, { task_type: "vision" })
    });
    appendAuditLog(runtime, "ai.provider_resolved", {
      task_id: task.task_id,
      task_type: "vision",
      ...activeDescriptor
    }, task.task_id);

    const outputDir = await artifactStore.createTaskOutputDir(task.task_id, new Date(task.created_at));
    const taskPackage = buildKimiTaskPackage({ task, outputDir });
    const execution = await executeKimiTask({
      command: activeCliRuntime.command,
      args: activeCliRuntime.args,
      env: activeCliRuntime.env,
      taskPackage,
      transport: activeCliRuntime.transport,
      model: activeCliRuntime.model,
      configFile: activeCliRuntime.configFile,
      mcpConfigFiles: activeCliRuntime.mcpConfigFiles,
      maxRuntimeSeconds: activeCliRuntime.maxRuntimeSeconds ?? 600,
      abortSignal: controller.signal,
      onEvent(event) {
        emitTaskEvent({
          runtime,
          taskId: task.task_id,
          eventType: event.type,
          payload: attachProviderFieldsToEvent(activeDescriptor, event)
        });
        applyExecutorEvent(runtime, task, event);
      }
    });

    if (execution.status !== "success") {
      markTaskFailed(runtime, task, {
        exitCode: execution.exitCode,
        stderr: execution.stderrPath,
        message: `Kimi CLI failed with exit code ${execution.exitCode ?? "unknown"}. stderr: ${execution.stderrPath ?? "not captured"}`
      });
      return { status: task.status, artifacts: [] };
    }

    const artifactRecords = execution.artifacts.map((a) => artifactStore.registerArtifact(task.task_id, a.path, a.mime_type));
    for (const r of artifactRecords) store.appendArtifact(r);

    if (task.status !== "success") {
      updateTask(runtime, task, { status: "success", sub_status: "completed", progress: 1 }, true);
    }
    markTaskSucceeded(runtime, task);
    return { status: "success", artifacts: artifactRecords };
  } catch (error) {
    markTaskFailed(runtime, task, error);
    return { status: task.status, artifacts: [] };
  } finally {
    unregisterActiveExecution(runtime, task.task_id);
  }
}

async function runExecutor({ task, runtime }) {
  const executor = runtime.executors?.find((item) => item.id === "multi_modal")
    ?? runtime.executors?.find((item) => item.id === "fast");
  if (!executor) {
    return { status: "queued" };
  }

  const controller = new AbortController();
  registerActiveExecution(runtime, task.task_id, {
    cancel: async () => controller.abort()
  });
  runtime.queue.markRunning(task.task_id);
  updateTask(runtime, task, {
    status: "running",
    sub_status: executor.id === "multi_modal" ? "multi_modal_executor" : "fast_executor"
  }, true);

  const resolvedProvider = resolveProviderForTask(executor.id === "multi_modal" ? "vision" : "chat");
  const executorDescriptor = describeResolvedProvider(resolvedProvider);
  if (executorDescriptor) {
    emitTaskEvent({
      runtime,
      taskId: task.task_id,
      eventType: "provider_resolved",
      payload: attachProviderFieldsToEvent(executorDescriptor, {
        task_type: executor.id === "multi_modal" ? "vision" : "chat",
        executor_id: executor.id
      })
    });
    appendAuditLog(runtime, "ai.provider_resolved", {
      task_id: task.task_id,
      task_type: executor.id === "multi_modal" ? "vision" : "chat",
      executor_id: executor.id,
      ...executorDescriptor
    }, task.task_id);
  }

  try {
    for await (const event of executor.execute(task, { signal: controller.signal })) {
      emitTaskEvent({
        runtime,
        taskId: task.task_id,
        eventType: event.event_type,
        payload: executorDescriptor
          ? attachProviderFieldsToEvent(executorDescriptor, event.payload)
          : event.payload
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

export async function submitImageTask({
  imagePaths,
  userCommand,
  source = "file",
  sourceApp = "uca.helper",
  captureMode = "manual",
  runtime,
  executionMode,
  parentTaskId = null,
  retryCount = 0,
  executorOverride = "multi_modal"
}) {
  ensureRuntimeServices(runtime);
  const store = runtime.store;
  const queue = runtime.queue;
  const artifactStore = runtime.artifactStore ?? createArtifactStore();
  const route = routeIntent(userCommand);

  const fileStats = await Promise.all(imagePaths.map((imagePath) => stat(imagePath)));
  const ocrResult = await runImageOcr(imagePaths[0]);
  const rawContextPacket = buildImageContextPacket({
    imagePaths,
    source,
    sourceApp,
    captureMode,
    ocrResult,
    traceId: `trace_${crypto.randomUUID()}`,
    contextId: `ctx_${crypto.randomUUID()}`
  });
  const inspection = runtime.securityBroker.inspectContext(rawContextPacket, {
    trigger: "image_submission"
  });
  const contextPacket = inspection.allowed ? inspection.contextPacket : rawContextPacket;
  contextPacket.selection_metadata = {
    ...contextPacket.selection_metadata,
    total_size_bytes: fileStats.reduce((sum, entry) => sum + entry.size, 0)
  };

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
      image_count: imagePaths.length
    }
  });

  if (!inspection.allowed) {
    markTaskFailed(runtime, task, {
      message: `Security broker blocked image capture: ${inspection.reason}`
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

  const outputDir = await artifactStore.createTaskOutputDir(task.task_id, new Date(task.created_at));
  emitTaskEvent({
    runtime,
    taskId: task.task_id,
    eventType: "step_started",
    payload: {
      step: "image_ocr",
      output_dir: outputDir,
      ocr_engine: ocrResult.ocr_engine
    }
  });
  emitTaskEvent({
    runtime,
    taskId: task.task_id,
    eventType: "step_finished",
    payload: {
      step: "image_ocr",
      ocr_confidence: ocrResult.ocr_confidence
    }
  });

  // if multi_modal executor has no Vision API key, fallback to code_cli
  const visionProvider = resolveProviderForTask("vision");
  const hasVisionApiProvider = Boolean(visionProvider && visionProvider.kind !== "code_cli");
  const visionCliRuntime = resolveCodeCliRuntimeForTask("vision", runtime.kimiRuntime);

  if (!hasVisionApiProvider && visionCliRuntime) {
    const providerDescriptor = describeCodeCliRuntime(visionCliRuntime);
    const kimiResult = await runKimiImageFallback({
      task,
      runtime,
      artifactStore,
      store,
      queue,
      cliRuntime: visionCliRuntime,
      providerDescriptor
    });
    return {
      task,
      taskEvents: store.getTaskEvents(task.task_id),
      artifacts: kimiResult.artifacts ?? []
    };
  }

  await runExecutor({ task, runtime });

  return {
    task,
    taskEvents: store.getTaskEvents(task.task_id),
    artifacts: []
  };
}
