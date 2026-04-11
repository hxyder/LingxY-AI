import crypto from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createArtifactStore } from "../store/artifact-store.mjs";
import { buildKimiTaskPackage } from "../executors/kimi/task-package-builder.mjs";
import { executeKimiTask } from "../executors/kimi/kimi-cli-executor.mjs";
import { submitImageTask } from "./image-submission.mjs";
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
    return [
      `Link URL: ${capture.url}`,
      capture.anchorText ? `Anchor text: ${capture.anchorText}` : ""
    ].filter(Boolean).join("\n");
  }

  if (capture.sourceType === "webpage" && capture.url) {
    return [
      `Webpage URL: ${capture.url}`,
      capture.pageTitle ? `Page title: ${capture.pageTitle}` : ""
    ].filter(Boolean).join("\n");
  }

  if (capture.sourceType === "image" && capture.imageUrl) {
    return [
      `Image URL: ${capture.imageUrl}`,
      capture.pageTitle ? `Page title: ${capture.pageTitle}` : ""
    ].filter(Boolean).join("\n");
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

import {
  hasAnyConfiguredProvider,
  resolveProviderForTask,
  resolveCodeCliRuntimeForTask,
  describeCodeCliRuntime,
  describeResolvedProvider
} from "../executors/shared/provider-resolver.mjs";
import { appendAuditLog } from "../security/audit-log.mjs";

function hasFastProvider() {
  return hasAnyConfiguredProvider();
}

function chatRoutedToCodeCli() {
  const provider = resolveProviderForTask("chat");
  return provider?.kind === "code_cli";
}

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

function pickRunnableExecutor(task, runtime) {
  if (task.executor === "multi_modal") {
    return runtime.executors?.find((executor) => executor.id === "multi_modal")
      ?? runtime.executors?.find((executor) => executor.id === "fast")
      ?? null;
  }

  if (task.executor === "tool_using") {
    return runtime.executors?.find((executor) => executor.id === "tool_using")
      ?? runtime.executors?.find((executor) => executor.id === "fast")
      ?? null;
  }

  if (task.executor === "agentic") {
    const provider = resolveProviderForTask("chat");
    const agenticExecutor = runtime.executors?.find((executor) => executor.id === "agentic");
    if (agenticExecutor && provider) {
      return agenticExecutor;
    }
    return runtime.executors?.find((executor) => executor.id === "fast") ?? null;
  }

  if ((task.executor === "kimi" || task.executor === "code_cli") && !resolveCodeCliRuntimeForTask("chat", runtime.kimiRuntime)) {
    return runtime.executors?.find((executor) => executor.id === "fast") ?? null;
  }

  return runtime.executors?.find((executor) => executor.id === task.executor)
    ?? runtime.executors?.find((executor) => executor.id === "fast")
    ?? null;
}

async function runBrowserExecutor({ task, runtime }) {
  const artifactStore = runtime.artifactStore ?? createArtifactStore();

  // The dedicated `translate` executor uses the free translator client and
  // must not be redirected to a Kimi/CLI provider even when chat is routed
  // there. `agentic` also bypasses the kimi branch — the agentic planner
  // honours multi-step tool use regardless of chat routing.
  const shouldUseKimi = task.executor !== "translate"
    && task.executor !== "agentic"
    && ((task.executor === "kimi" || task.executor === "code_cli")
      || (task.executor === "fast" && !hasFastProvider())
      || (task.executor === "general" && !hasFastProvider())
      || chatRoutedToCodeCli());

  const resolvedCliRuntime = resolveCodeCliRuntimeForTask("chat", runtime.kimiRuntime);

  if (shouldUseKimi && resolvedCliRuntime) {
    const providerDescriptor = describeCodeCliRuntime(resolvedCliRuntime);
    return runKimiExecutor({ task, runtime, artifactStore, cliRuntime: resolvedCliRuntime, providerDescriptor });
  }

  const executor = pickRunnableExecutor(task, runtime);
  if (!executor) {
    return { status: "queued", artifacts: [] };
  }

  const controller = new AbortController();
  registerActiveExecution(runtime, task.task_id, {
    cancel: async () => controller.abort()
  });
  runtime.queue.markRunning(task.task_id);
  updateTask(runtime, task, {
    status: "running",
    sub_status: `${executor.id}_executor`
  }, true);

  // Stash runtime on task so executors that need runtime context (e.g. tool_using) can access it
  task.__runtime = runtime;

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
    return { status: "success", artifacts: [] };
  } catch (error) {
    markTaskFailed(runtime, task, error);
    return { status: task.status, artifacts: [] };
  } finally {
    unregisterActiveExecution(runtime, task.task_id);
  }
}

async function runKimiExecutor({ task, runtime, artifactStore, cliRuntime = null, providerDescriptor = null }) {
  const store = runtime.store;
  const queue = runtime.queue;
  const controller = new AbortController();
  registerActiveExecution(runtime, task.task_id, {
    cancel: async () => controller.abort()
  });

  const activeCliRuntime = cliRuntime ?? resolveCodeCliRuntimeForTask("chat", runtime.kimiRuntime);
  if (!activeCliRuntime) {
    markTaskFailed(runtime, task, { message: "No code_cli runtime resolved for task." });
    unregisterActiveExecution(runtime, task.task_id);
    return { status: "failed", artifacts: [] };
  }
  const activeDescriptor = providerDescriptor ?? describeCodeCliRuntime(activeCliRuntime);

  try {
    queue.markRunning(task.task_id);
    updateTask(runtime, task, {
      status: "running",
      sub_status: "starting_executor"
    }, true);

    emitTaskEvent({
      runtime,
      taskId: task.task_id,
      eventType: "provider_resolved",
      payload: attachProviderFieldsToEvent(activeDescriptor, { task_type: "chat" })
    });
    appendAuditLog(runtime, "ai.provider_resolved", {
      task_id: task.task_id,
      task_type: "chat",
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

    if (execution.status === "cancelled") {
      markTaskFailed(runtime, task, {
        code: "ABORT_ERR",
        summary: "Kimi CLI execution cancelled by user."
      });
      return { status: task.status, artifacts: [] };
    }

    if (execution.status !== "success") {
      markTaskFailed(runtime, task, {
        exitCode: execution.exitCode,
        stderr: execution.stderrPath,
        message: `Kimi CLI failed with exit code ${execution.exitCode ?? "unknown"}`
      });
      return { status: task.status, artifacts: [] };
    }

    const artifactRecords = execution.artifacts.map((artifact) =>
      artifactStore.registerArtifact(task.task_id, artifact.path, artifact.mime_type)
    );
    for (const record of artifactRecords) {
      store.appendArtifact(record);
    }

    if (task.status !== "success") {
      updateTask(runtime, task, {
        status: "success",
        sub_status: "completed",
        progress: 1
      }, true);
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
    // Return the ORIGINAL task's events + artifacts so callers (including the
    // browser extension's runQuickAction) actually see the cached result
    // instead of an empty payload. Previously re-triggering translate on the
    // same selection produced "(无内容)" because the new deduped task carried
    // no inline_result events of its own.
    const dedupedTaskId = enqueued.dedupedTaskId;
    const originalTask = dedupedTaskId ? store.getTask(dedupedTaskId) : null;
    const originalEvents = dedupedTaskId ? store.getTaskEvents(dedupedTaskId) : [];
    const originalArtifacts = dedupedTaskId ? store.getArtifactsForTask(dedupedTaskId) : [];
    return {
      task: originalTask ?? task,
      taskEvents: originalEvents.length > 0 ? originalEvents : store.getTaskEvents(task.task_id),
      artifacts: originalArtifacts
    };
  }

  if (capture.sourceType === "image") {
    const outputDir = await artifactStore.createTaskOutputDir(task.task_id, new Date(task.created_at));
    const imageArtifactPath = path.join(outputDir, "browser-image.txt");
    await writeFile(imageArtifactPath, `Browser image placeholder for ${capture.imageUrl ?? capture.url ?? "image"}`, "utf8");
    const delegated = await submitImageTask({
      imagePaths: [imageArtifactPath],
      userCommand,
      source: "browser",
      sourceApp: capture.browser,
      captureMode: "extension",
      runtime,
      parentTaskId: task.task_id
    });
    updateTask(runtime, task, {
      status: "success",
      sub_status: "delegated_to_image_pipeline",
      progress: 1
    }, true);
    markTaskSucceeded(runtime, task);
    return {
      task,
      taskEvents: store.getTaskEvents(task.task_id),
      artifacts: delegated.artifacts ?? []
    };
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

  const executionResult = await runBrowserExecutor({ task, runtime });

  return {
    task,
    taskEvents: store.getTaskEvents(task.task_id),
    artifacts: executionResult.artifacts ?? []
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
