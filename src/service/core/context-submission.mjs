import crypto from "node:crypto";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createArtifactStore } from "../store/artifact-store.mjs";
import { buildKimiTaskPackage } from "../executors/kimi/task-package-builder.mjs";
import { executeKimiTask } from "../executors/kimi/kimi-cli-executor.mjs";
import { detectRequestedOutputFormat, writeRequestedArtifacts } from "../executors/kimi/output-format.mjs";
import { routeIntent } from "./router/intent-router.mjs";
import { decomposeUserCommand } from "./router/decomposer.mjs";
import { submitCompositeTask } from "./composite-submission.mjs";
import { createTaskSpec } from "./task-spec.mjs";
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

function hasChatApiProvider() {
  const provider = resolveProviderForTask("chat");
  return Boolean(provider && provider.kind !== "code_cli");
}

function hasFileOrImageContext(contextPacket = {}) {
  return Boolean(contextPacket.file_paths?.length || contextPacket.image_paths?.length);
}

function shouldSaveToDesktop(userCommand = "") {
  return /(?:桌面|desktop)/i.test(userCommand);
}

async function createOutputDirForTask({ runtime, artifactStore, task }) {
  if (shouldSaveToDesktop(task.user_command)) {
    const desktopDir = path.join(os.homedir(), "Desktop", "UCA", task.task_id);
    await mkdir(desktopDir, { recursive: true });
    return desktopDir;
  }
  // UCA-048: honour configStore.output.defaultDir when set. The user can
  // configure a global output directory via Console → Settings so artifacts
  // don't scatter across %APPDATA%/UCA/outputs/<taskId>/.
  const configuredDir = runtime?.configStore?.load?.()?.output?.defaultDir;
  if (typeof configuredDir === "string" && configuredDir.trim()) {
    const taskDir = path.join(configuredDir.trim(), task.task_id);
    await mkdir(taskDir, { recursive: true });
    return taskDir;
  }
  return artifactStore.createTaskOutputDir(task.task_id, new Date(task.created_at));
}

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
    return runtime.executors?.find((executor) => executor.id === "tool_using")
      ?? runtime.executors?.find((executor) => executor.id === "fast")
      ?? null;
  }

  if (task.executor === "agentic") {
    // Agentic executor accepts every provider kind. Native function-calling
    // providers (anthropic / openai / ollama) drive the planner directly;
    // code_cli providers go through the JSON planning-mode bridge in
    // code-cli-bridge.mjs. Falls back to fast only if no provider is
    // configured at all.
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

function canDecomposeFromTaskSpec(taskSpec) {
  if (!taskSpec) return true;
  if (taskSpec.constraints?.can_split === false) return false;
  if (taskSpec.artifact?.required === true) return false;
  if (taskSpec.success_contract?.artifact_created === true) return false;
  return true;
}

function assertArtifactContract(task, generatedArtifacts) {
  if (task.task_spec?.artifact?.required !== true) return;
  if (generatedArtifacts.length > 0) return;
  throw new Error(`Task requires a ${task.task_spec.artifact.kind ?? "file"} artifact, but no artifact was created.`);
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

function isEmptyPlannerResponse(text = "") {
  const normalized = String(text ?? "").trim();
  return !normalized
    || normalized === "(no response from agentic planner)"
    || normalized === "(no result)"
    || normalized === "(no output)"
    || normalized === "No response.";
}

async function runKimiExecutor({ task, runtime, store, queue, artifactStore, markFailure = true, cliRuntime = null, providerDescriptor = null }) {
  const controller = new AbortController();
  registerActiveExecution(runtime, task.task_id, {
    cancel: async () => controller.abort()
  });

  const activeCliRuntime = cliRuntime ?? resolveCodeCliRuntimeForTask("chat", runtime.kimiRuntime);
  if (!activeCliRuntime) {
    if (markFailure) {
      markTaskFailed(runtime, task, { message: "No code_cli runtime resolved for task." });
    }
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

    const outputDir = await createOutputDirForTask({ runtime, artifactStore, task });
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
      if (markFailure) {
        markTaskFailed(runtime, task, { code: "ABORT_ERR", summary: "Kimi CLI execution cancelled." });
      }
      return { status: task.status, artifacts: [] };
    }

    if (execution.status !== "success") {
      if (markFailure) {
        markTaskFailed(runtime, task, { exitCode: execution.exitCode, message: `Kimi CLI failed with exit code ${execution.exitCode ?? "unknown"}` });
      }
      return { status: "failed", artifacts: [], stderrPath: execution.stderrPath, exitCode: execution.exitCode };
    }

    const artifactRecords = execution.artifacts.map((artifact) =>
      artifactStore.registerArtifact(task.task_id, artifact.path, artifact.mime_type)
    );
    for (const record of artifactRecords) {
      store.appendArtifact(record);
    }

    assertArtifactContract(task, artifactRecords);

    if (task.status !== "success") {
      updateTask(runtime, task, { status: "success", sub_status: "completed", progress: 1 }, true);
    }
    markTaskSucceeded(runtime, task);
    return { status: "success", artifacts: artifactRecords };
  } catch (error) {
    if (markFailure) {
      markTaskFailed(runtime, task, error);
    }
    return { status: "failed", artifacts: [], error };
  } finally {
    unregisterActiveExecution(runtime, task.task_id);
  }
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

  // Surface the provider that this task is actually going to call. The fast /
  // tool_using / multi_modal executors each resolve the provider themselves,
  // but we record it here so Console + verify scripts see one canonical
  // `provider_resolved` event per task.
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

  // Stash runtime on task so executors that need runtime context (e.g.
  // tool_using / agentic) can access it. We use a non-enumerable property so
  // that sqlite-store's `JSON.stringify(task)` does NOT try to serialize the
  // runtime — which contains live setInterval Timers and a circular
  // `_idlePrev / _idleNext / TimersList` reference that would otherwise
  // crash `upsertTask` with a "Converting circular structure to JSON" error.
  Object.defineProperty(task, "__runtime", {
    value: runtime,
    enumerable: false,
    configurable: true,
    writable: true
  });

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
      if (event.event_type === "inline_result" || event.event_type === "success") {
        const candidateText = event.payload?.text ?? event.payload?.summary ?? "";
        if (!isEmptyPlannerResponse(candidateText)) {
          inlineText = candidateText;
        }
      }
      if (event.event_type === "artifact_created" && event.payload?.path) {
        const artifactRecord = artifactStore.registerArtifact(task.task_id, event.payload.path, event.payload.mime ?? event.payload.mime_type);
        runtime.store.appendArtifact(artifactRecord);
        generatedArtifacts.push(artifactRecord);
      }
      // Agentic executor yields artifact_paths on the success event (not artifact_created).
      // Collect them here so they are visible via getArtifactsForTask.
      if (event.event_type === "success" && Array.isArray(event.payload?.artifact_paths)) {
        for (const filePath of event.payload.artifact_paths) {
          if (!filePath) continue;
          const alreadySaved = generatedArtifacts.some((a) => a.path === filePath);
          if (!alreadySaved) {
            const artifactRecord = artifactStore.registerArtifact(task.task_id, filePath, null);
            runtime.store.appendArtifact(artifactRecord);
            generatedArtifacts.push(artifactRecord);
          }
        }
      }
      applyExecutorEvent(runtime, task, {
        type: event.event_type,
        ...event.payload
      });
    }

    const requestedFormat = detectRequestedOutputFormat(task.user_command);
    if (requestedFormat.id !== "conversational" && generatedArtifacts.length === 0) {
      const outputDir = await createOutputDirForTask({ runtime, artifactStore, task });
      const artifacts = await writeRequestedArtifacts({
        assistantText: isEmptyPlannerResponse(inlineText)
          ? (task.context_packet?.text || task.user_command)
          : inlineText,
        outputDir,
        requestedFormat,
        preferredFileName: task.context_packet?.source_type === "audio_note"
          ? "录音转录结构化笔记.md"
          : null
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

    assertArtifactContract(task, generatedArtifacts);

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
  childIndex = null,
  retryCount = 0,
  executorOverride = null,
  skipDecomposition = false
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
  const preflightTaskSpec = createTaskSpec(userCommand, normalizedContextPacket, route);

  if (inspection.allowed && canDecomposeFromTaskSpec(preflightTaskSpec) && !skipDecomposition && !parentTaskId) {
    const decomposition = await decomposeUserCommand({
      userCommand,
      runtime,
      contextPacket: normalizedContextPacket
    });
    if (decomposition.subtasks.length > 1) {
      return submitCompositeTask({
        runtime,
        contextPacket: normalizedContextPacket,
        userCommand,
        executionMode,
        subtasks: decomposition.subtasks,
        submitChild: ({ subtask, index, parentTaskId: compositeId }) =>
          submitContextTask({
            contextPacket: normalizedContextPacket,
            userCommand: subtask.command,
            runtime,
            executionMode,
            parentTaskId: compositeId,
            childIndex: index,
            executorOverride: subtask.suggested_executor ?? null,
            skipDecomposition: true
          })
      });
    }
  }

  const task = createTaskRecord({
    route,
    contextPacket: normalizedContextPacket,
    userCommand,
    executionMode,
    parentTaskId,
    childIndex,
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
    // Return the original task's events+artifacts so clients see the cached result
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

  // route to code_cli (Kimi/Claude CLI/etc.) if:
  // 1. task explicitly uses the kimi/code_cli executor
  // 2. fast executor has no API provider configured
  // 3. user routed chat to a code_cli provider (e.g. their own Kimi/Claude CLI)
  // The dedicated `translate` executor never delegates — it uses the free
  // translator client directly. Neither does `agentic`: if the user asked
  // for multi-step tool use, we honour that intent and let pickRunnableExecutor
  // decide whether to actually run the agentic executor or fall back to fast.
  const shouldUseKimi = task.executor !== "translate"
    && task.executor !== "agentic"
    && ((task.executor === "kimi" || task.executor === "code_cli")
      || (task.executor === "fast" && !hasFastProvider())
      || (task.executor === "general" && !hasFastProvider())
      || chatRoutedToCodeCli());

  const requestedFormat = detectRequestedOutputFormat(task.user_command);
  const shouldPreferProviderArtifactFlow = requestedFormat.id !== "conversational"
    && hasChatApiProvider()
    && !hasFileOrImageContext(normalizedContextPacket);

  if (shouldPreferProviderArtifactFlow && (task.executor === "kimi" || task.executor === "code_cli")) {
    task.executor = "fast";
    store.updateTask(task.task_id, task);
  }

  // Resolve the code_cli runtime *per task* so that provider switches in the
  // UI take effect on the next submission without needing a service restart.
  const resolvedCliRuntime = resolveCodeCliRuntimeForTask("chat", runtime.kimiRuntime);

  if (shouldUseKimi && resolvedCliRuntime && !shouldPreferProviderArtifactFlow) {
    const artifactStore = runtime.artifactStore ?? createArtifactStore();
    const allowFallback = !hasFileOrImageContext(normalizedContextPacket);
    const providerDescriptor = describeCodeCliRuntime(resolvedCliRuntime);
    const kimiResult = await runKimiExecutor({
      task,
      runtime,
      store,
      queue,
      artifactStore,
      markFailure: !allowFallback,
      cliRuntime: resolvedCliRuntime,
      providerDescriptor
    });
    if (kimiResult.status !== "success" && allowFallback) {
      const fallbackExecutor = runtime.executors?.find((executor) => executor.id === "fast");
      if (fallbackExecutor) {
        updateTask(runtime, task, {
          status: "queued",
          sub_status: "fallback_to_fast_executor",
          failure_category: null,
          failure_user_message: null,
          failure_internal_log_excerpt: null
        }, true);
        task.executor = "fast";
        store.updateTask(task.task_id, task);
        const fallbackResult = await runExecutor({ runtime, task, executor: fallbackExecutor });
        return {
          task,
          taskEvents: store.getTaskEvents(task.task_id),
          artifacts: fallbackResult.artifacts ?? []
        };
      }
      markTaskFailed(runtime, task, {
        message: `Kimi CLI failed with exit code ${kimiResult.exitCode ?? "unknown"}`
      });
    }
    return {
      task,
      taskEvents: store.getTaskEvents(task.task_id),
      artifacts: kimiResult.artifacts ?? []
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
