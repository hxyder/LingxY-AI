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
      reasoningEffort: activeCliRuntime.reasoningEffort ?? "",
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

const CONNECTOR_FILE_SEND_RE = /(发给|发送给|发到|forward\s+to|send\s+(?:to|this|the\s+file))|附件.*(?:发|send)|attach.*(?:send|to)/i;

function looksLikeConnectorFileSend(userCommand = "") {
  const text = String(userCommand ?? "");
  return CONNECTOR_FILE_SEND_RE.test(text)
    && /(@|邮件|邮箱|email|gmail|outlook|给.+发|sophie|接收者|收件人|to)/i.test(text);
}

// task_f8816920 regression: "打开它" (open this image) was forced into
// multi_modal and the LLM only described the image content. The agent-loop
// with open_file / copy / reveal / attachment tools is the right home for
// any non-analysis action on an attached image. We still default to
// multi_modal when the command clearly asks to analyse/describe/OCR — that
// path actually needs the vision model.
const VISION_ANALYSIS_RE = /(分析|识别|描述|说说.*(?:里面|内容)|看看.*(?:里面|内容|是什么)|里面.*是什么|(?:里面|内容).*(?:是什么|有什么)|什么东西|读出来|认一认|\bocr\b|\banalyze\b|\banalyse\b|\bdescribe\b|\bidentify\b|what\s+(?:is|are)\s+in|what\s+(?:does|do)\s+.*\s+show|read\s+(?:the\s+)?text)/i;

function looksLikeVisionAnalysisIntent(userCommand = "") {
  return VISION_ANALYSIS_RE.test(String(userCommand ?? ""));
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
  executorOverride = "multi_modal",
  background = false
}) {
  // If the user's command is anything OTHER than a vision-analysis request
  // ("分析/描述/识别" etc), route to tool_using so the agent-loop can reach
  // open_file / copy / account_send_email / etc. The image paths are still
  // surfaced in the context_packet so the planner knows the attachment
  // exists. We only keep multi_modal for the actual vision-analysis case.
  if (executorOverride === "multi_modal"
      && (looksLikeConnectorFileSend(userCommand) || !looksLikeVisionAnalysisIntent(userCommand))) {
    const { submitContextTask } = await import("./context-submission.mjs");
    return submitContextTask({
      runtime,
      userCommand,
      executionMode,
      contextPacket: {
        schema_version: "1.0",
        context_id: `ctx_${crypto.randomUUID()}`,
        trace_id: `trace_${crypto.randomUUID()}`,
        source_type: "file",
        source_app: sourceApp,
        capture_mode: "attachment",
        security_level: "internal",
        redaction_applied: false,
        text: `File attached by user for sending: ${imagePaths.join(", ")}`,
        file_paths: imagePaths,
        image_paths: imagePaths,
        captured_at: new Date().toISOString()
      },
      executorOverride: "tool_using",
      parentTaskId,
      retryCount
    });
  }
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

  const execute = async () => {
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
  };

  if (background) {
    setTimeout(() => { void execute(); }, 0);
    return { task, taskEvents: store.getTaskEvents(task.task_id), artifacts: [], background: true };
  }

  return execute();
}
