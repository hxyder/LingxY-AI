import crypto from "node:crypto";
import { buildFileContextPacket } from "../extractors/file-ingest.mjs";
import { createArtifactStore } from "../store/artifact-store.mjs";
import { buildKimiTaskPackage } from "../executors/kimi/task-package-builder.mjs";
import { executeKimiTask } from "../executors/kimi/kimi-cli-executor.mjs";
import {
  resolveKimiRuntimeForTask,
  resolveProviderForTask,
  describeCodeCliRuntime
} from "../executors/shared/provider-resolver.mjs";
import { appendAuditLog } from "../security/audit-log.mjs";
import { submitContextTask } from "./context-submission.mjs";

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
import { routeIntent } from "./router/intent-router.mjs";
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

export async function submitFileTask({
  filePaths,
  userCommand,
  captureMode = "shell_menu",
  sourceApp = "explorer.exe",
  executionMode,
  parentTaskId = null,
  retryCount = 0,
  executorOverride = null,
  background = false,
  runtime
}) {
  ensureRuntimeServices(runtime);
  const store = runtime.store;
  const queue = runtime.queue;
  const artifactStore = runtime.artifactStore ?? createArtifactStore();
  const route = routeIntent(userCommand);
  const preflightTaskSpec = createTaskSpec(userCommand, {
    source_type: "file",
    source_app: sourceApp,
    capture_mode: captureMode,
    file_paths: Array.isArray(filePaths) ? filePaths : []
  }, route);
  const cliRuntime = resolveKimiRuntimeForTask("file_analysis", runtime.kimiRuntime);
  // file-submission specialises in file-backed analysis, which the code_cli
  // runtime handles natively via its task package. When the router upgrades the
  // executor to agentic (because analyze+generate_report tags trigger the
  // new planner), we still prefer the CLI runtime here IF one is available —
  // the agentic planner doesn't currently read attached files, and the
  // existing CLI path is the authoritative file-analysis flow. Commit 3
  // will add an agentic file-reading branch; until then "agentic on files"
  // degrades gracefully to "code_cli on files".
  const preferredExecutorOverride = executorOverride
    ?? ((cliRuntime && ["fast", "none", "agentic"].includes(route.executor)) ? "code_cli" : null);
  const rawContextPacket = await buildFileContextPacket({
    filePaths,
    captureMode,
    sourceApp,
    traceId: `trace_${crypto.randomUUID()}`,
    contextId: `ctx_${crypto.randomUUID()}`
  });

  const fileFocusedGoals = new Set([
    "generate_document",
    "analyze_and_report",
    "transform_existing_file",
    "open_or_reveal_file"
  ]);
  const fileFocusedIntentTags = new Set([
    "analyze",
    "summarize",
    "rewrite",
    "explain",
    "generate_report",
    "file_action"
  ]);
  const shouldPreferContextPipeline = !fileFocusedGoals.has(preflightTaskSpec.goal)
    && !((route.intent_tags ?? []).some((tag) => fileFocusedIntentTags.has(tag)));

  if (shouldPreferContextPipeline) {
    return submitContextTask({
      contextPacket: rawContextPacket,
      userCommand,
      runtime,
      executionMode,
      parentTaskId,
      retryCount,
      executorOverride: executorOverride ?? null,
      skipDecomposition: false
    });
  }

  // User chose an API provider (DeepSeek / Anthropic API / OpenAI / Ollama)
  // for file analysis — we have no Code CLI to drive, but the context packet
  // already carries the extracted file text. Hand off to the normal context
  // pipeline so the API provider can answer over that text.
  const fileAnalysisProvider = resolveProviderForTask("file_analysis");
  const apiProviderAvailable = fileAnalysisProvider && fileAnalysisProvider.kind !== "code_cli";
  if (!cliRuntime && apiProviderAvailable) {
    return submitContextTask({
      contextPacket: rawContextPacket,
      userCommand,
      runtime,
      executionMode,
      parentTaskId,
      retryCount,
      executorOverride: executorOverride ?? null,
      skipDecomposition: false
    });
  }
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
    executorOverride: preferredExecutorOverride,
    runtime  // G3b: enables parent_task_summary enrichment
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

  // Use user-routed CLI for file_analysis if configured, else boot-time kimiRuntime.
  // Resolved per-task so provider switches in the UI apply to the next submission.
  // Note: the API-provider fast path above already handles the "no CLI but has
  // DeepSeek/OpenAI/..." case. Reaching here means neither CLI nor API are
  // configured for file_analysis.
  if ((task.executor !== "kimi" && task.executor !== "code_cli") || !cliRuntime) {
    markTaskFailed(runtime, task, {
      message: cliRuntime
        ? `No runnable file executor found for ${task.executor}.`
        : "没有可用于文件分析的 provider。请在 Console → Settings 里给 File Analysis 分配一个 Code CLI provider（Claude Code / Cursor / Kimi），或配置一个 API provider（DeepSeek / OpenAI / Anthropic / Ollama）。"
    });
    return { task, taskEvents: store.getTaskEvents(task.task_id), artifacts: [] };
  }

  const providerDescriptor = describeCodeCliRuntime(cliRuntime);

  const execute = async () => {
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

      emitTaskEvent({
        runtime,
        taskId: task.task_id,
        eventType: "provider_resolved",
        payload: attachProviderFieldsToEvent(providerDescriptor, { task_type: "file_analysis" })
      });
      appendAuditLog(runtime, "ai.provider_resolved", {
        task_id: task.task_id,
        task_type: "file_analysis",
        ...providerDescriptor
      }, task.task_id);

      const outputDir = await artifactStore.createTaskOutputDir(task.task_id, new Date(task.created_at));
      const taskPackage = buildKimiTaskPackage({ task, outputDir });
      const execution = await executeKimiTask({
        command: cliRuntime.command,
        args: cliRuntime.args,
        env: cliRuntime.env,
        taskPackage,
        transport: cliRuntime.transport,
        model: cliRuntime.model,
        reasoningEffort: cliRuntime.reasoningEffort ?? "",
        configFile: cliRuntime.configFile,
        mcpConfigFiles: cliRuntime.mcpConfigFiles,
        maxRuntimeSeconds: cliRuntime.maxRuntimeSeconds ?? 600,
        abortSignal: controller.signal,
        onEvent(event) {
          emitTaskEvent({
            runtime,
            taskId: task.task_id,
            eventType: event.type,
            payload: attachProviderFieldsToEvent(providerDescriptor, event)
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

      if (task.status === "queued" || task.status === "running") {  // P4-RQ G6a: preserve terminal statuses
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
  };

  if (background) {
    setTimeout(() => { void execute(); }, 0);
    return { task, taskEvents: store.getTaskEvents(task.task_id), artifacts: [], background: true };
  }

  return execute();
}
