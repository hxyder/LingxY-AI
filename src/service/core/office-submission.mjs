import crypto from "node:crypto";
import { createArtifactStore } from "../store/artifact-store.mjs";
import {
  officeContentEvidenceFromCapture,
  withContentEvidence
} from "./evidence/content-evidence.mjs";
import { routeIntent } from "./router/intent-router.mjs";
import {
  applyExecutorEvent,
  createTaskRecord,
  emitTaskEvent,
  ensureRuntimeServices,
  markTaskFailed,
  markTaskSucceeded,
  registerActiveExecution,
  submitTaskWithConversation,
  unregisterActiveExecution,
  updateTask
} from "./task-runtime.mjs";

function buildOfficeSelectionMetadata(capture) {
  return withContentEvidence({
    office_app: capture.officeApp,
    document_name: capture.documentName,
    document_path: capture.documentPath,
    ...capture.selectionMetadata
  }, officeContentEvidenceFromCapture(capture));
}

export function buildOfficeContextPacket({
  capture,
  traceId,
  contextId,
  capturedAt = new Date().toISOString()
}) {
  return {
    schema_version: "1.0",
    context_id: contextId,
    trace_id: traceId,
    source_type: "office_selection",
    source_app: capture.hostProcess,
    capture_mode: "plugin",
    security_level: "internal",
    redaction_applied: false,
    text: capture.selectionText ?? capture.selectionMetadata?.selected_text ?? "",
    html: capture.html,
    selection_metadata: buildOfficeSelectionMetadata(capture),
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
    sub_status: "office_fast_executor"
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

    if (task.status === "queued" || task.status === "running") {  // P4-RQ G6a: preserve terminal statuses
      updateTask(runtime, task, {
        status: "success",
        sub_status: "completed",
        progress: 1
      }, true);
    }
    markTaskSucceeded(runtime, task);
    return { status: task.status };
  } catch (error) {
    markTaskFailed(runtime, task, error);
    return { status: task.status };
  } finally {
    unregisterActiveExecution(runtime, task.task_id);
  }
}

export async function submitOfficeTask({
  capture,
  userCommand,
  runtime,
  executionMode,
  parentTaskId = null,
  conversationId = null,
  clientMessageId = null,
  projectId = null,
  retryCount = 0,
  executorOverride = null,
  background = false
}) {
  ensureRuntimeServices(runtime);
  const store = runtime.store;
  const queue = runtime.queue;
  const artifactStore = runtime.artifactStore ?? createArtifactStore();
  const route = routeIntent(userCommand);
  const rawContextPacket = buildOfficeContextPacket({
    capture,
    traceId: `trace_${crypto.randomUUID()}`,
    contextId: `ctx_${crypto.randomUUID()}`
  });
  const inspection = runtime.securityBroker.inspectContext(rawContextPacket, {
    trigger: "office_submission"
  });
  const contextPacket = inspection.allowed ? inspection.contextPacket : rawContextPacket;

  const { task } = submitTaskWithConversation({
    route,
    contextPacket,
    userCommand,
    executionMode,
    parentTaskId,
    conversationId,
    clientMessageId,
    projectId,
    retryCount,
    executorOverride,
    submissionKind: "office",
    runtime
  });
  const enqueued = queue.enqueue(task);
  emitTaskEvent({
    runtime,
    taskId: task.task_id,
    eventType: "task_created",
    payload: {
      source_type: contextPacket.source_type,
      office_app: contextPacket.selection_metadata?.office_app ?? null
    }
  });

  if (!inspection.allowed) {
    markTaskFailed(runtime, task, {
      message: `Security broker blocked office capture: ${inspection.reason}`
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

  if (capture.officeApp === "Excel" && (capture.selectionMetadata?.row_count ?? 0) * (capture.selectionMetadata?.col_count ?? 0) > 10000) {
    updateTask(runtime, task, {
      status: "unsupported",
      sub_status: "office_excel_selection_too_large_for_phase_4_base"
    }, true);
    emitTaskEvent({
      runtime,
      taskId: task.task_id,
      eventType: "unsupported",
      payload: {
        reason: "office_excel_selection_too_large_for_phase_4_base"
      }
    });
    queue.markFinished(task.task_id);
    return { task, taskEvents: store.getTaskEvents(task.task_id), artifacts: [] };
  }

  const execute = async () => {
    const outputDir = await artifactStore.createTaskOutputDir(task.task_id, new Date(task.created_at));
    emitTaskEvent({
      runtime,
      taskId: task.task_id,
      eventType: "step_started",
      payload: {
        step: "office_selection_normalized",
        output_dir: outputDir,
        office_app: capture.officeApp
      }
    });
    emitTaskEvent({
      runtime,
      taskId: task.task_id,
      eventType: "step_finished",
      payload: {
        step: "office_selection_normalized"
      }
    });

    await runFastExecutor({ task, runtime });

    return {
      task,
      taskEvents: store.getTaskEvents(task.task_id),
      artifacts: []
    };
  };

  if (background) {
    setTimeout(() => { void execute(); }, 0);
    return { task, taskEvents: store.getTaskEvents(task.task_id), artifacts: [], background: true };
  }

  return execute();
}
