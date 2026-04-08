import crypto from "node:crypto";
import { createArtifactStore } from "../store/artifact-store.mjs";
import { routeIntent } from "./router/intent-router.mjs";

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function emitTaskEvent({ store, eventBus, taskId, eventType, payload }) {
  const record = {
    event_id: createId("evt"),
    task_id: taskId,
    ts: nowIso(),
    event_type: eventType,
    payload
  };

  store.appendEvent(record);
  eventBus.publish(record);
  return record;
}

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

async function runFastExecutor({ task, runtime, store, eventBus }) {
  const fastExecutor = runtime.executors?.find((executor) => executor.id === "fast");
  if (!fastExecutor) {
    return { status: "queued" };
  }

  task.status = "running";
  task.updated_at = nowIso();

  for await (const event of fastExecutor.execute(task)) {
    emitTaskEvent({
      store,
      eventBus,
      taskId: task.task_id,
      eventType: event.event_type,
      payload: event.payload
    });
  }

  task.status = "success";
  task.updated_at = nowIso();
  return { status: "success" };
}

export async function submitBrowserTask({
  capture,
  userCommand,
  runtime,
  executionMode
}) {
  const store = runtime.store;
  const eventBus = runtime.eventBus;
  const queue = runtime.queue;
  const artifactStore = runtime.artifactStore ?? createArtifactStore();
  const route = routeIntent(userCommand);
  const contextPacket = buildBrowserContextPacket({
    capture,
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
  emitTaskEvent({
    store,
    eventBus,
    taskId: task.task_id,
    eventType: "task_created",
    payload: {
      source_type: contextPacket.source_type,
      url: contextPacket.url ?? null
    }
  });

  if (capture.sourceType === "image") {
    task.status = "unsupported";
    task.updated_at = nowIso();
    emitTaskEvent({
      store,
      eventBus,
      taskId: task.task_id,
      eventType: "unsupported",
      payload: {
        reason: "image_pipeline_not_available_in_phase_1c"
      }
    });
    return { task, taskEvents: store.taskEvents.filter((event) => event.task_id === task.task_id), artifacts: [] };
  }

  if (capture.sourceType === "link" && !capture.html) {
    const outputDir = await artifactStore.createTaskOutputDir(task.task_id, new Date(task.created_at));
    emitTaskEvent({
      store,
      eventBus,
      taskId: task.task_id,
      eventType: "step_started",
      payload: {
        step: "web_fetch_placeholder",
        output_dir: outputDir
      }
    });
    emitTaskEvent({
      store,
      eventBus,
      taskId: task.task_id,
      eventType: "step_finished",
      payload: {
        step: "web_fetch_placeholder"
      }
    });
  }

  await runFastExecutor({ task, runtime, store, eventBus });

  return {
    task,
    taskEvents: store.taskEvents.filter((event) => event.task_id === task.task_id),
    artifacts: []
  };
}

export function listRecentTasks(store, limit = 5) {
  return [...store.tasks.values()]
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
