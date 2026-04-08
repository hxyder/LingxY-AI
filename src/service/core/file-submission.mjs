import crypto from "node:crypto";
import { buildFileContextPacket } from "../extractors/file-ingest.mjs";
import { createArtifactStore } from "../store/artifact-store.mjs";
import { buildKimiTaskPackage } from "../executors/kimi/task-package-builder.mjs";
import { executeKimiTask } from "../executors/kimi/kimi-cli-executor.mjs";
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

export async function submitFileTask({
  filePaths,
  userCommand,
  captureMode = "shell_menu",
  sourceApp = "explorer.exe",
  executionMode,
  parentTaskId = null,
  retryCount = 0,
  executorOverride = null,
  runtime
}) {
  ensureRuntimeServices(runtime);
  const store = runtime.store;
  const queue = runtime.queue;
  const artifactStore = runtime.artifactStore ?? createArtifactStore();
  const route = routeIntent(userCommand);
  const rawContextPacket = await buildFileContextPacket({
    filePaths,
    captureMode,
    sourceApp,
    traceId: `trace_${crypto.randomUUID()}`,
    contextId: `ctx_${crypto.randomUUID()}`
  });
  const inspection = runtime.securityBroker.inspectContext(rawContextPacket, {
    trigger: "file_submission"
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
      file_count: filePaths.length
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

  if (task.executor !== "kimi" || !runtime.kimiRuntime) {
    return { task, taskEvents: store.getTaskEvents(task.task_id), artifacts: [] };
  }

  const controller = new AbortController();
  registerActiveExecution(runtime, task.task_id, {
    cancel: async () => controller.abort()
  });

  try {
    queue.markRunning(task.task_id);
    updateTask(runtime, task, {
      status: "running",
      sub_status: "starting_executor"
    }, true);

    const outputDir = await artifactStore.createTaskOutputDir(task.task_id, new Date(task.created_at));
    const taskPackage = buildKimiTaskPackage({ task, outputDir });
    const execution = await executeKimiTask({
      command: runtime.kimiRuntime.command,
      args: runtime.kimiRuntime.args,
      env: runtime.kimiRuntime.env,
      taskPackage,
      maxRuntimeSeconds: runtime.kimiRuntime.maxRuntimeSeconds ?? 600,
      abortSignal: controller.signal,
      onEvent(event) {
        emitTaskEvent({
          runtime,
          taskId: task.task_id,
          eventType: event.type,
          payload: event
        });
        applyExecutorEvent(runtime, task, event);
      }
    });

    if (execution.status === "cancelled") {
      markTaskFailed(runtime, task, {
        code: "ABORT_ERR",
        summary: "Kimi CLI execution cancelled by user."
      });
      return {
        task,
        taskEvents: store.getTaskEvents(task.task_id),
        artifacts: [],
        stderrPath: execution.stderrPath
      };
    }

    if (execution.status !== "success") {
      markTaskFailed(runtime, task, {
        exitCode: execution.exitCode,
        stderr: execution.stderrPath,
        message: `Kimi CLI failed with exit code ${execution.exitCode ?? "unknown"}`
      });
      return {
        task,
        taskEvents: store.getTaskEvents(task.task_id),
        artifacts: [],
        stderrPath: execution.stderrPath
      };
    }

    const artifactRecords = execution.artifacts.map((artifact) =>
      artifactStore.registerArtifact(task.task_id, artifact.path, artifact.mime_type)
    );

    for (const artifactRecord of artifactRecords) {
      store.appendArtifact(artifactRecord);
    }

    if (task.status !== "success") {
      updateTask(runtime, task, {
        status: "success",
        sub_status: "completed",
        progress: 1
      }, true);
    }
    markTaskSucceeded(runtime, task);

    return {
      task,
      taskEvents: store.getTaskEvents(task.task_id),
      artifacts: artifactRecords,
      stderrPath: execution.stderrPath
    };
  } catch (error) {
    markTaskFailed(runtime, task, error);
    return {
      task,
      taskEvents: store.getTaskEvents(task.task_id),
      artifacts: []
    };
  } finally {
    unregisterActiveExecution(runtime, task.task_id);
  }
}
