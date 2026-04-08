import crypto from "node:crypto";
import { buildFileContextPacket } from "../extractors/file-ingest.mjs";
import { createArtifactStore } from "../store/artifact-store.mjs";
import { buildKimiTaskPackage } from "../executors/kimi/task-package-builder.mjs";
import { executeKimiTask } from "../executors/kimi/kimi-cli-executor.mjs";
import { routeIntent } from "./router/intent-router.mjs";

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export async function submitFileTask({
  filePaths,
  userCommand,
  captureMode = "shell_menu",
  sourceApp = "explorer.exe",
  executionMode,
  runtime
}) {
  const store = runtime.store;
  const eventBus = runtime.eventBus;
  const queue = runtime.queue;
  const artifactStore = runtime.artifactStore ?? createArtifactStore();
  const route = routeIntent(userCommand);
  const contextPacket = await buildFileContextPacket({
    filePaths,
    captureMode,
    sourceApp,
    traceId: createId("trace"),
    contextId: createId("ctx")
  });

  const task = {
    task_id: createId("task"),
    created_at: nowIso(),
    updated_at: nowIso(),
    status: "queued",
    intent: route.intent,
    executor: route.executor,
    user_command: userCommand,
    execution_mode: executionMode ?? (route.requires_confirmation ? "approval_required" : "interactive"),
    context_packet: contextPacket
  };

  store.insertTask(task);
  queue.enqueue(task);

  const createdEvent = {
    event_id: createId("evt"),
    task_id: task.task_id,
    ts: nowIso(),
    event_type: "task_created",
    payload: {
      source_type: contextPacket.source_type,
      file_count: filePaths.length
    }
  };
  store.appendEvent(createdEvent);
  eventBus.publish(createdEvent);

  if (route.executor !== "kimi" || !runtime.kimiRuntime) {
    return { task, taskEvents: [createdEvent], artifacts: [] };
  }

  task.status = "running";
  task.updated_at = nowIso();
  const outputDir = await artifactStore.createTaskOutputDir(task.task_id, new Date(task.created_at));
  const taskPackage = buildKimiTaskPackage({ task, outputDir });
  const execution = await executeKimiTask({
    command: runtime.kimiRuntime.command,
    args: runtime.kimiRuntime.args,
    env: runtime.kimiRuntime.env,
    taskPackage,
    maxRuntimeSeconds: runtime.kimiRuntime.maxRuntimeSeconds ?? 600,
    onEvent(event) {
      const record = {
        event_id: createId("evt"),
        task_id: task.task_id,
        ts: new Date(event.ts).toISOString(),
        event_type: event.type,
        payload: event
      };
      store.appendEvent(record);
      eventBus.publish(record);
    }
  });

  task.status = execution.status;
  task.updated_at = nowIso();

  const artifactRecords = execution.artifacts.map((artifact) =>
    artifactStore.registerArtifact(task.task_id, artifact.path, artifact.mime_type)
  );

  for (const artifactRecord of artifactRecords) {
    store.appendArtifact(artifactRecord);
  }

  return {
    task,
    taskEvents: store.taskEvents.filter((event) => event.task_id === task.task_id),
    artifacts: artifactRecords,
    stderrPath: execution.stderrPath
  };
}
