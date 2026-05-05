import crypto from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createArtifactStore } from "../store/artifact-store.mjs";
import { buildKimiTaskPackage } from "../executors/kimi/task-package-builder.mjs";
import { executeKimiTask } from "../executors/kimi/kimi-cli-executor.mjs";
import { detectRequestedOutputFormat, writeRequestedArtifacts } from "../executors/kimi/output-format.mjs";
import { submitImageTask } from "./image-submission.mjs";
import { routeIntent } from "./router/intent-router.mjs";
import { decomposeUserCommand } from "./router/decomposer.mjs";
import { submitCompositeTask } from "./composite-submission.mjs";
import { createTaskSpec, validateTaskSpec } from "./task-spec.mjs";
import { applySemanticRouterPreflight } from "./intent/router-preflight.mjs";
import { classifyContextSources } from "./intent/context-sources.mjs";
import {
  artifactRegistrationOptionsForPath,
  rememberArtifactMetadataFromToolEvent
} from "./artifact-action-contract.mjs";
import {
  createFileGenerationAttemptState,
  recordArtifactGenerated,
  recordFileGenerationToolEvent,
  shouldSynthesizeRequestedFallbackArtifact
} from "./artifact-fallback-policy.mjs";
import {
  EXECUTION_PHASES,
  EXECUTION_STATES,
  runExecutionPhase
} from "./runtime/execution-graph.mjs";
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

const MAX_BROWSER_FETCH_BYTES = 5 * 1024 * 1024;
const MAX_BROWSER_CONTEXT_CHARS = 12000;

function runtimeWithTaskEmitter(runtime, taskId) {
  if (runtime?.emitTaskEvent) return runtime;
  return {
    ...(runtime ?? {}),
    emitTaskEvent: (eventType, payload) => emitTaskEvent({ runtime, taskId, eventType, payload })
  };
}

function createSelectionMetadata(capture) {
  return {
    page_title: capture.pageTitle,
    context_before: capture.contextBefore,
    context_after: capture.contextAfter,
    anchor_text: capture.anchorText,
    image_url: capture.imageUrl,
    tab_id: capture.tabId,
    browser_capture: capture.metadata && typeof capture.metadata === "object" ? capture.metadata : null
  };
}

// P4-03 follow-up: browser captures of webpage / link / image WITHOUT
// user-selected text are SYNTHETIC METADATA (active-tab URL + page
// title), not the user's selection. Pre-fix the C1 context-source
// classifier saw "non-empty text ≠ command" and defaulted to
// `real_selection=true`, which made source-scope anchor the task to
// the page and forbid web search. Tagging the synthetic text with the
// `[browser_metadata · ...]` sentinel lets the classifier separate
// "user is on this page" (background metadata) from "user pasted
// content from this page" (real selection — anchor).
const BROWSER_METADATA_SENTINEL =
  "[browser_metadata · 浏览器自动捕获 · 仅作背景信息，不构成用户选区]";

function normalizeCaptureText(capture) {
  if (capture.sourceType === "chat") {
    return capture.text ?? "";
  }

  if (capture.sourceType === "webpage" && capture.metadata?.hasPageContent === false && capture.url) {
    return [
      BROWSER_METADATA_SENTINEL,
      `Webpage URL: ${capture.url}`,
      capture.pageTitle ? `Page title: ${capture.pageTitle}` : ""
    ].filter(Boolean).join("\n");
  }

  if (capture.text) {
    return capture.text;
  }

  if (capture.sourceType === "text_selection") {
    // Real user-selected content — anchor.
    return capture.selectionText ?? "";
  }

  if (capture.sourceType === "link" && capture.url) {
    return [
      BROWSER_METADATA_SENTINEL,
      `Link URL: ${capture.url}`,
      capture.anchorText ? `Anchor text: ${capture.anchorText}` : ""
    ].filter(Boolean).join("\n");
  }

  if (capture.sourceType === "webpage" && capture.url) {
    return [
      BROWSER_METADATA_SENTINEL,
      `Webpage URL: ${capture.url}`,
      capture.pageTitle ? `Page title: ${capture.pageTitle}` : ""
    ].filter(Boolean).join("\n");
  }

  if (capture.sourceType === "image" && capture.imageUrl) {
    return [
      BROWSER_METADATA_SENTINEL,
      `Image URL: ${capture.imageUrl}`,
      capture.pageTitle ? `Page title: ${capture.pageTitle}` : ""
    ].filter(Boolean).join("\n");
  }

  return "";
}

function getFetchImpl(runtime) {
  return runtime.fetchImpl ?? globalThis.fetch;
}

function extensionFromUrl(url, fallback = "") {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname).toLowerCase();
    return ext && ext.length <= 10 ? ext : fallback;
  } catch {
    return fallback;
  }
}

function imageExtensionFromContentType(contentType = "", url = "") {
  const normalized = contentType.toLowerCase();
  if (normalized.includes("image/jpeg")) return ".jpg";
  if (normalized.includes("image/png")) return ".png";
  if (normalized.includes("image/gif")) return ".gif";
  if (normalized.includes("image/webp")) return ".webp";
  return extensionFromUrl(url, ".img");
}

function isTextLikeContent(contentType = "") {
  const normalized = contentType.toLowerCase();
  return normalized.startsWith("text/")
    || normalized.includes("json")
    || normalized.includes("xml")
    || normalized.includes("xhtml");
}

function textFromBuffer(buffer) {
  return buffer.toString("utf8").slice(0, MAX_BROWSER_CONTEXT_CHARS);
}

async function fetchBrowserResource({ runtime, url, accept }) {
  const fetchImpl = getFetchImpl(runtime);
  if (typeof fetchImpl !== "function") {
    throw new Error("No fetch implementation is available for browser resource capture.");
  }
  const response = await fetchImpl(url, {
    headers: accept ? { accept } : undefined
  });
  if (!response?.ok) {
    throw new Error(`Fetch failed for ${url}: HTTP ${response?.status ?? "unknown"}`);
  }
  const contentLength = Number(response.headers?.get?.("content-length") ?? 0);
  if (contentLength > MAX_BROWSER_FETCH_BYTES) {
    throw new Error(`Fetch response is too large (${contentLength} bytes).`);
  }
  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_BROWSER_FETCH_BYTES) {
    throw new Error(`Fetch response is too large (${arrayBuffer.byteLength} bytes).`);
  }
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: response.headers?.get?.("content-type") ?? "application/octet-stream"
  };
}

async function saveBrowserImageArtifact({ capture, runtime, artifactStore, task }) {
  const imageUrl = capture.imageUrl ?? capture.url;
  if (!imageUrl) {
    throw new Error("Browser image capture did not include an image URL.");
  }
  const outputDir = await artifactStore.createTaskOutputDir(task.task_id, new Date(task.created_at));
  const fetched = await fetchBrowserResource({
    runtime,
    url: imageUrl,
    accept: "image/*"
  });
  const ext = imageExtensionFromContentType(fetched.contentType, imageUrl);
  const imageArtifactPath = path.join(outputDir, `browser-image${ext}`);
  await writeFile(imageArtifactPath, fetched.buffer);
  emitTaskEvent({
    runtime,
    taskId: task.task_id,
    eventType: "step_finished",
    payload: {
      step: "browser_image_fetch",
      artifact_path: imageArtifactPath,
      content_type: fetched.contentType
    }
  });
  return imageArtifactPath;
}

async function fetchBrowserLinkContext({ capture, runtime, artifactStore, task }) {
  const outputDir = await artifactStore.createTaskOutputDir(task.task_id, new Date(task.created_at));
  emitTaskEvent({
    runtime,
    taskId: task.task_id,
    eventType: "step_started",
    payload: {
      step: "web_fetch",
      output_dir: outputDir,
      url: capture.url
    }
  });
  const fetched = await fetchBrowserResource({
    runtime,
    url: capture.url,
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5"
  });
  const isText = isTextLikeContent(fetched.contentType);
  const isHtml = fetched.contentType.toLowerCase().includes("html");
  const ext = isHtml ? ".html" : (isText ? ".txt" : extensionFromUrl(capture.url, ".bin"));
  const artifactPath = path.join(outputDir, `web-fetch${ext}`);
  await writeFile(artifactPath, fetched.buffer);

  if (isText) {
    const fetchedText = textFromBuffer(fetched.buffer);
    task.context_packet = {
      ...task.context_packet,
      html: isHtml ? fetchedText : task.context_packet.html,
      text: [
        task.context_packet.text,
        `Fetched URL: ${capture.url}`,
        fetchedText
      ].filter(Boolean).join("\n\n")
    };
    updateTask(runtime, task, { context_packet: task.context_packet });
  }

  emitTaskEvent({
    runtime,
    taskId: task.task_id,
    eventType: "step_finished",
    payload: {
      step: "web_fetch",
      artifact_path: artifactPath,
      content_type: fetched.contentType,
      attached_to_context: isText
    }
  });
}

function taskExplicitlyTargetsBrowserPage(task = {}) {
  const contractScope = task.task_spec?.contract?.source_scope;
  const srScope = task.context_packet?.semantic_router_decision?.source_scope;
  const sourceScopeDecision = task.task_spec?.executor_decision?.evidence
    ?.some?.((entry) => entry?.source === "source_scope" && /current_context|browser_page/.test(`${entry.matched ?? entry.reason ?? ""}`));
  return contractScope === "current_context"
    || contractScope === "browser_page"
    || srScope === "browser_page"
    || sourceScopeDecision === true;
}

function shouldPrefetchBrowserPageContext({ capture, task }) {
  if (capture?.sourceType !== "webpage" || !capture.url || capture.html) return false;
  if (capture.metadata?.hasPageContent === true) return false;
  return taskExplicitlyTargetsBrowserPage(task);
}

async function prefetchBrowserPageContext({ capture, runtime, artifactStore, task }) {
  try {
    await fetchBrowserLinkContext({ capture, runtime, artifactStore, task });
    emitTaskEvent({
      runtime,
      taskId: task.task_id,
      eventType: "step_finished",
      payload: {
        step: "browser_page_context_prefetch",
        url: capture.url,
        attached_to_context: true
      }
    });
  } catch (error) {
    emitTaskEvent({
      runtime,
      taskId: task.task_id,
      eventType: "step_warning",
      payload: {
        step: "browser_page_context_prefetch",
        url: capture.url,
        message: error?.message ?? "Browser page prefetch failed; continuing with captured metadata."
      }
    });
  }
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

function providerOptionsForTask(task = null, runtime = null) {
  return { task, store: runtime?.store ?? null };
}

function chatRoutedToCodeCli(task = null, runtime = null) {
  const provider = resolveProviderForTask("chat", process.env, providerOptionsForTask(task, runtime));
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

// UCA-077 P2-05: pickRunnableExecutor moved to a shared module so this file
// and context-submission.mjs no longer maintain byte-for-byte copies.
import { pickRunnableExecutor } from "./planning/runnable-executor.mjs";

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

async function runBrowserExecutor({ task, runtime }) {
  const artifactStore = runtime.artifactStore ?? createArtifactStore();
  const generatedArtifacts = [];
  const artifactMetadataByPath = new Map();
  let inlineText = "";
  const fileGeneration = createFileGenerationAttemptState();

  // The dedicated `translate` executor uses the free translator client and
  // must not be redirected to a Kimi/CLI provider even when chat is routed
  // there. `agentic` also bypasses the kimi branch — the agentic planner
  // honours multi-step tool use regardless of chat routing.
  const shouldUseKimi = task.executor !== "translate"
    && task.executor !== "agentic"
    && ((task.executor === "kimi" || task.executor === "code_cli")
      || (task.executor === "fast" && !hasFastProvider())
      || (task.executor === "general" && !hasFastProvider())
      || chatRoutedToCodeCli(task, runtime));

  const resolvedCliRuntime = resolveCodeCliRuntimeForTask("chat", runtime.kimiRuntime, providerOptionsForTask(task, runtime));

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

  // Stash runtime on task so executors that need runtime context (e.g.
  // tool_using / agentic) can access it. Non-enumerable so sqlite-store's
  // JSON.stringify(task) doesn't trip over the runtime's live setInterval
  // Timers (`_idlePrev / _idleNext / TimersList` circular refs).
  Object.defineProperty(task, "__runtime", {
    value: runtime,
    enumerable: false,
    configurable: true,
    writable: true
  });

  const resolvedProvider = resolveProviderForTask(executor.id === "multi_modal" ? "vision" : "chat", process.env, {
    task,
    store: runtime.store
  });
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
      if (event.event_type === "inline_result" || event.event_type === "success") {
        inlineText = event.payload?.text ?? event.payload?.summary ?? inlineText;
      }
      if (event.event_type === "tool_call_completed") {
        recordFileGenerationToolEvent(fileGeneration, event.payload ?? {});
        rememberArtifactMetadataFromToolEvent(artifactMetadataByPath, event.payload ?? {});
      }
      if (event.event_type === "artifact_created" && event.payload?.path) {
        const artifactRecord = artifactStore.registerArtifact(
          task.task_id,
          event.payload.path,
          event.payload.mime ?? event.payload.mime_type,
          artifactRegistrationOptionsForPath(event.payload.path, {
            metadataByPath: artifactMetadataByPath,
            payload: event.payload
          })
        );
        runtime.store.appendArtifact(artifactRecord);
        generatedArtifacts.push(artifactRecord);
        recordArtifactGenerated(fileGeneration);
      }
      if (["success", "partial_success"].includes(event.event_type)
          && Array.isArray(event.payload?.artifact_paths)) {
        for (const filePath of event.payload.artifact_paths) {
          if (!filePath) continue;
          const alreadySaved = generatedArtifacts.some((a) => a.path === filePath);
          if (!alreadySaved) {
            const artifactRecord = artifactStore.registerArtifact(
              task.task_id,
              filePath,
              null,
              artifactRegistrationOptionsForPath(filePath, { metadataByPath: artifactMetadataByPath })
            );
            runtime.store.appendArtifact(artifactRecord);
            generatedArtifacts.push(artifactRecord);
            recordArtifactGenerated(fileGeneration);
          }
        }
      }
      applyExecutorEvent(runtime, task, {
        type: event.event_type,
        ...event.payload
      });
    }

    const requestedFormat = detectRequestedOutputFormat(task.user_command);
    if (shouldSynthesizeRequestedFallbackArtifact({
      requestedFormat,
      generatedArtifacts,
      task,
      fileGeneration
    })) {
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
        recordArtifactGenerated(fileGeneration);
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

    // Mirror the context-submission fix: persist the executor's final
    // text so search-style / conversational tasks show something in
    // the detail view.
    if (inlineText && !task.result_summary) {
      updateTask(runtime, task, { result_summary: inlineText.trim() });
    }

    if (task.status === "queued" || task.status === "running") {  // P4-RQ G6a: preserve terminal statuses
      updateTask(runtime, task, {
        status: "success",
        sub_status: "completed",
        progress: 1
      }, true);
    }
    markTaskSucceeded(runtime, task);
    return { status: task.status, artifacts: generatedArtifacts };
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

  const activeCliRuntime = cliRuntime ?? resolveCodeCliRuntimeForTask(
    "chat",
    runtime.kimiRuntime,
    providerOptionsForTask(task, runtime)
  );
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

    assertArtifactContract(task, artifactRecords);

    if (task.status === "queued" || task.status === "running") {  // P4-RQ G6a: preserve terminal statuses
      updateTask(runtime, task, {
        status: "success",
        sub_status: "completed",
        progress: 1
      }, true);
    }
    markTaskSucceeded(runtime, task);
    return { status: task.status, artifacts: artifactRecords };
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
  conversationId = null,
  clientMessageId = null,
  projectId = null,
  childIndex = null,
  retryCount = 0,
  executorOverride = null,
  skipDecomposition = false,
  background = false
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
  // P4-03 §19 #2: SemanticRouter preflight — same shared helper as the
  // context-submission flow. Classifier + ambiguity gate + optional
  // LLM call, all wrapped in fail-soft try/catch. Browser captures
  // benefit specifically because the new `[browser_metadata · ...]`
  // sentinel lets SR distinguish "user is on a tab" from "user wants
  // this page analysed".
  const deferPreExecutionPlanning = background;
  let routerEnrichedContext = deferPreExecutionPlanning
    ? {
        ...contextPacket,
        context_sources: classifyContextSources({
          text: userCommand,
          contextPacket
        })
      }
    : await applySemanticRouterPreflight({
        userCommand,
        contextPacket
      });
  const preflightTaskSpec = createTaskSpec(userCommand, routerEnrichedContext, route);

  if (!deferPreExecutionPlanning
      && inspection.allowed
      && canDecomposeFromTaskSpec(preflightTaskSpec)
      && !skipDecomposition
      && !parentTaskId) {
    const decomposition = await decomposeUserCommand({
      userCommand,
      runtime,
      contextPacket: routerEnrichedContext
    });
    if (decomposition.subtasks.length > 1) {
      return submitCompositeTask({
        runtime,
        contextPacket: routerEnrichedContext,
        userCommand,
        executionMode,
        subtasks: decomposition.subtasks,
        conversationId,
        clientMessageId,
        projectId,
        submitChild: ({ subtask, index, parentTaskId: compositeId }) =>
          submitBrowserTask({
            // Children rebuild a fresh packet from the original
            // `capture` and re-run their own preflight. Pattern is
            // unchanged from pre-fix; this comment is for clarity.
            capture,
            userCommand: subtask.command,
            runtime,
            executionMode,
            parentTaskId: compositeId,
            conversationId,
            clientMessageId,
            projectId,
            childIndex: index,
            executorOverride: subtask.suggested_executor ?? null,
            skipDecomposition: true
          })
      });
    }
  }

  // P4-03 §6 RED-LINE FIX: pass the SR-enriched packet to createTaskRecord
  // so the final task.task_spec / tool_policy / decision_trace carry the
  // SemanticRouter merge result. Pre-fix createTaskRecord saw the bare
  // contextPacket; SR's stamp was lost between preflight and persistence.
  const { task } = submitTaskWithConversation({
    route,
    contextPacket: routerEnrichedContext,
    userCommand,
    executionMode,
    parentTaskId,
    conversationId,
    clientMessageId,
    projectId,
    childIndex,
    retryCount,
    executorOverride,
    submissionKind: "browser",
    runtime
  });
  const enqueued = queue.enqueue(task);
  emitTaskEvent({
    runtime,
    taskId: task.task_id,
    eventType: "task_created",
    payload: {
      source_type: routerEnrichedContext.source_type,
      url: routerEnrichedContext.url ?? null
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

  const execute = async () => {
    if (deferPreExecutionPlanning && inspection.allowed) {
      routerEnrichedContext = await runExecutionPhase({
        runtime: runtimeWithTaskEmitter(runtime, task.task_id),
        taskId: task.task_id,
        phase: EXECUTION_PHASES.SEMANTIC_ROUTER_PATCH,
        step: "semantic_router_patch",
        progress: 0.04,
        state: EXECUTION_STATES.ROUTING,
        fn: () => applySemanticRouterPreflight({
          userCommand,
          contextPacket: routerEnrichedContext
        }),
        timingPayload: (result) => {
          const spec = createTaskSpec(userCommand, result, route);
          return {
            routing_status: spec.routing_status,
            executor: executorOverride ?? spec.suggested_executor ?? route.executor
          };
        }
      });
      const refreshedSpec = createTaskSpec(userCommand, routerEnrichedContext, route);
      const refreshedValidation = validateTaskSpec(refreshedSpec);
      task.context_packet = routerEnrichedContext;
      task.task_spec = refreshedSpec;
      task.task_spec_valid = refreshedValidation.valid;
      task.task_spec_errors = refreshedValidation.errors;
      task.executor = executorOverride ?? refreshedSpec.suggested_executor ?? route.executor;
      store.updateTask(task.task_id, task);
    }

    if (capture.sourceType === "image") {
      let imageArtifactPath = null;
      try {
        imageArtifactPath = await saveBrowserImageArtifact({ capture, runtime, artifactStore, task });
      } catch (error) {
        markTaskFailed(runtime, task, {
          message: `Browser image fetch failed: ${error.message}`
        });
        return { task, taskEvents: store.getTaskEvents(task.task_id), artifacts: [] };
      }
      const delegated = await submitImageTask({
        imagePaths: [imageArtifactPath],
        userCommand,
        source: "browser",
        sourceApp: capture.browser,
        captureMode: "extension",
        runtime,
        parentTaskId: task.task_id,
        conversationId,
        clientMessageId,
        projectId
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

    if (shouldPrefetchBrowserPageContext({ capture, task })) {
      await prefetchBrowserPageContext({ capture, runtime, artifactStore, task });
    }

    if (capture.sourceType === "link" && !capture.html) {
      try {
        await fetchBrowserLinkContext({ capture, runtime, artifactStore, task });
      } catch (error) {
        markTaskFailed(runtime, task, {
          message: `Browser link fetch failed: ${error.message}`
        });
        return { task, taskEvents: store.getTaskEvents(task.task_id), artifacts: [] };
      }
    }

    const executionResult = await runBrowserExecutor({ task, runtime });

    return {
      task,
      taskEvents: store.getTaskEvents(task.task_id),
      artifacts: executionResult.artifacts ?? []
    };
  };

  if (background) {
    setTimeout(() => { void execute(); }, 0);
    return { task, taskEvents: store.getTaskEvents(task.task_id), artifacts: [], background: true };
  }

  return execute();
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
