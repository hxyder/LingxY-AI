import crypto from "node:crypto";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createArtifactStore } from "../store/artifact-store.mjs";
import { buildKimiTaskPackage } from "../executors/kimi/task-package-builder.mjs";
import { executeKimiTask } from "../executors/kimi/kimi-cli-executor.mjs";
import { detectRequestedOutputFormatForTask, writeRequestedArtifacts } from "../executors/kimi/output-format.mjs";
import { routeIntent } from "./router/intent-router.mjs";
import { decomposeUserCommand } from "./router/decomposer.mjs";
import { submitCompositeTask } from "./composite-submission.mjs";
import { createTaskSpec } from "./task-spec.mjs";
import { applySemanticRouterPreflight } from "./intent/router-preflight.mjs";
import { extractFileContent } from "../extractors/file-ingest.mjs";
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

const FOLLOWUP_ARTIFACT_EDIT_PATTERNS = [
  /(加上|加入|补充|插入|替换|修改|更新|调整|优化|完善|美化|精美|润色|改一下|改得|重做|重写|继续改)/i,
  /\b(add|include|insert|replace|modify|edit|update|revise|refine|polish|improve|beautify|restyle)\b/i
];

function artifactKindFromTextOrPath(text = "", filePath = "") {
  const normalizedText = String(text ?? "").toLowerCase();
  const normalizedPath = String(filePath ?? "").toLowerCase();
  if (normalizedPath.endsWith(".pptx") || /(pptx?|powerpoint|幻灯片|演示文稿|slides?|slideshow)/i.test(normalizedText)) return "pptx";
  if (normalizedPath.endsWith(".docx") || /(\.docx|docx|word\s*文档|word\s*文件|\bword\b)/i.test(normalizedText)) return "docx";
  if (normalizedPath.endsWith(".xlsx") || /(\.xlsx|xlsx|excel|电子表格|spreadsheet|表格)/i.test(normalizedText)) return "xlsx";
  if (normalizedPath.endsWith(".pdf") || /(\.pdf|pdf)/i.test(normalizedText)) return "pdf";
  if (normalizedPath.endsWith(".md")) return "md";
  if (normalizedPath.endsWith(".html") || normalizedPath.endsWith(".htm")) return "html";
  if (normalizedPath.endsWith(".csv")) return "csv";
  if (normalizedPath.endsWith(".txt")) return "txt";
  return null;
}

function isEditableArtifactPath(filePath = "") {
  return Boolean(artifactKindFromTextOrPath("", filePath));
}

function looksLikeArtifactEditFollowup(userCommand = "", contextPacket = {}) {
  if ((contextPacket.file_paths ?? []).some((filePath) => isEditableArtifactPath(filePath))) {
    return FOLLOWUP_ARTIFACT_EDIT_PATTERNS.some((pattern) => pattern.test(String(userCommand ?? "")));
  }
  const text = String(userCommand ?? "");
  return FOLLOWUP_ARTIFACT_EDIT_PATTERNS.some((pattern) => pattern.test(text))
    && /(pptx?|powerpoint|幻灯片|演示文稿|slides?|docx?|word|xlsx?|excel|表格|pdf|文件|文档|链接|图片|图表)/i.test(text);
}

function findRecentArtifactPath(runtime, preferredKind = null) {
  const tasks = runtime?.store?.listTasks?.() ?? [];
  const ordered = tasks
    .filter((task) => ["success", "partial_success"].includes(task?.status))
    .sort((a, b) => Date.parse(b?.updated_at ?? b?.created_at ?? 0) - Date.parse(a?.updated_at ?? a?.created_at ?? 0));
  for (const task of ordered) {
    const artifacts = runtime?.store?.getArtifactsForTask?.(task.task_id) ?? [];
    for (const artifact of [...artifacts].reverse()) {
      const kind = artifactKindFromTextOrPath("", artifact.path);
      if (!kind) continue;
      if (preferredKind && kind !== preferredKind) continue;
      return artifact.path;
    }
  }
  return null;
}

// UCA-182 Phase 21: shifted from "inject blobs of context at submit
// time" to "let the AI ask". The model now has three memory tools —
// recall_memory / list_recent_tasks / get_task_detail — registered
// in src/service/action_tools/tools/memory-tools.mjs. When it sees
// a referential pronoun or any gap in its context, the planner calls
// those tools explicitly instead of us trying to pre-guess. This
// replaced the earlier regex-based patches.
//
// seedSemanticMemories + seedParentTaskContext are still worth doing
// *when the information is load-bearing and cheap*: the parent digest
// is triggered only when the client volunteers parent_task_id (user's
// explicit "I'm following up on this task" signal), and semantic
// recall keeps a 400ms budget so it never hurts submit latency. All
// other context seeding is deferred to the AI's own tool choice.
// P4-02.x follow-up: bumped from 400ms → 1000ms after measuring the
// embedding store on a hot cache: store.search consistently took
// 350-470ms, occasionally above 400ms, which silently dropped legit
// recalls in production. The 1000ms ceiling still keeps RAG well below
// SemanticRouter's 1500ms budget and below the user's typing cadence,
// while letting the realistic-latency p95 actually return results.
const MEMORY_RECALL_TIMEOUT_MS = 1000;
const MEMORY_RECALL_K = 3;
// P4-02.x C2: per-hit threshold gate. TF-IDF-only hits use Jaccard
// similarity which can return spurious matches at the legacy 0.05 floor
// (the 0.077 unrelated-email recall on a weather query came from 1
// shared token over 13 unique). Vector-backed hits keep the loose
// threshold because cosine over a real embedding space is far less
// noisy. The store reports `embeddingType: "tfidf" | "vector"` per hit
// (see embeddings/store.mjs:186).
const MEMORY_RECALL_MIN_SCORE_TFIDF = 0.25;
const MEMORY_RECALL_MIN_SCORE_VECTOR = 0.05;

function passesHitThreshold(hit) {
  const score = hit?.score ?? 0;
  if (hit?.embeddingType === "tfidf") return score > MEMORY_RECALL_MIN_SCORE_TFIDF;
  return score > MEMORY_RECALL_MIN_SCORE_VECTOR;
}

export async function seedSemanticMemories({ runtime, userCommand, parentTaskId, contextPacket }) {
  const store = runtime?.platform?.embeddingStore;
  if (!store?.search || !userCommand) return contextPacket;
  let results;
  try {
    // Race the search against a short timeout — RAG must never
    // make submit slower than the user's typing cadence.
    results = await Promise.race([
      store.search(userCommand, MEMORY_RECALL_K + 2),
      new Promise((resolve) => setTimeout(() => resolve([]), MEMORY_RECALL_TIMEOUT_MS))
    ]);
  } catch {
    return contextPacket;
  }
  if (!Array.isArray(results) || results.length === 0) return contextPacket;
  const hits = results
    // drop exact parent match — seedParentTaskContext already covers it
    .filter((r) => r?.id && r.id !== parentTaskId)
    // P4-02.x C2: per-hit threshold based on embedding backing — see
    // passesHitThreshold above.
    .filter(passesHitThreshold)
    .slice(0, MEMORY_RECALL_K);
  if (hits.length === 0) return contextPacket;
  // P4-02.x C2: sentinel rename + explicit role marker. The block is
  // CONTEXT_SOURCE_KEYS.rag_background — the C1 classifier recognizes
  // this prefix, source-scope (C3) treats it as background-only (NOT a
  // local anchor), and the LLM sees the explicit "仅作背景，请勿当作当前
  // 任务上下文" instruction inline.
  const lines = [
    "[memory_background · 语义召回 · 仅作背景，请勿当作当前任务上下文]"
  ];
  for (const hit of hits) {
    const meta = hit.metadata ?? {};
    const summary = String(meta.summary ?? hit.text.slice(0, 100)).slice(0, 120);
    // P4-02.x C2: full callable task_id. memory-tools.mjs:212
    // get_task_detail does exact-match lookup; the prior 12-char slice
    // produced "task=task_5ab4836..." that the model would extract and
    // call with → "task not found". Render both: a short display
    // identifier for human-readable logs, plus the full callable id.
    const fullId = String(hit.id);
    const displayId = fullId.slice(0, 12);
    lines.push(`- ${summary}  (display=${displayId} · callable: task_id=${fullId} · score=${(hit.score ?? 0).toFixed(2)})`);
    if (meta.answer_excerpt) {
      lines.push("  " + String(meta.answer_excerpt).slice(0, 240).replace(/\n+/g, " "));
    }
    if (Array.isArray(meta.artifact_paths) && meta.artifact_paths.length) {
      lines.push("  产物: " + meta.artifact_paths.slice(0, 3).join(" · "));
    }
  }
  const digest = lines.join("\n");
  const mergedText = [digest, contextPacket?.text ?? ""].filter(Boolean).join("\n\n---\n\n").trim();
  return {
    ...contextPacket,
    text: mergedText,
    selection_metadata: {
      ...(contextPacket?.selection_metadata ?? {}),
      semantic_recall_ids: hits.map((h) => h.id),
      semantic_recall_scores: hits.map((h) => Number((h.score ?? 0).toFixed(3))),
      // P4-02.x C2: unified flag the C1 classifier reads as authoritative
      // (without depending on sentinel scan). Mirrors the existing
      // `conversation_history_injected` pattern.
      memory_background_injected: true
    }
  };
}

// UCA-182 Phase 16: when a follow-up turn carries parent_task_id,
// pull the parent task's user_command + final inline_result + any
// artifacts it produced, and prepend a compact digest to the child's
// contextPacket.text. Without this, agentic planner's prompt has the
// follow-up sentence ("生成一份ppt，对于我的上个问题") but zero
// information about what "上个问题" actually was, so it either asks
// for clarification or guesses from unrelated recent files. The
// digest is kept short (~2KB) so it doesn't blow the token budget;
// the full history still lives in the client-side turns which the
// UI folds into contextPacket.text separately.
function seedParentTaskContext({ runtime, parentTaskId, contextPacket }) {
  if (!parentTaskId || !runtime?.store?.getTask) return contextPacket;
  let parent, events;
  try {
    parent = runtime.store.getTask(parentTaskId);
    events = runtime.store.getTaskEvents(parentTaskId) ?? [];
  } catch {
    return contextPacket;
  }
  if (!parent) return contextPacket;
  const lastSuccess = [...events].reverse().find((e) =>
    e.event_type === "success" || e.event_type === "inline_result"
  );
  const answerText = String(lastSuccess?.payload?.text ?? "").slice(0, 1200);
  const artifactEvents = events.filter((e) => e.event_type === "artifact_created");
  const artifactPaths = artifactEvents
    .map((e) => String(e.payload?.path ?? ""))
    .filter((p) => p && !p.endsWith("-preview.html") && !p.endsWith("-preview.txt"))
    .slice(0, 6);
  const parts = [];
  parts.push("[上一轮任务摘要 · parent=" + parentTaskId.slice(0, 12) + "]");
  if (parent.user_command) parts.push("用户上一条指令：" + String(parent.user_command).slice(0, 400));
  if (answerText) parts.push("助手上一条回复（节选）：\n" + answerText);
  if (artifactPaths.length) {
    parts.push("上一轮生成的文件：\n" + artifactPaths.map((p) => "- " + p).join("\n"));
  }
  const digest = parts.join("\n\n");
  const mergedText = [digest, contextPacket?.text ?? ""].filter(Boolean).join("\n\n---\n\n").trim();
  const mergedFiles = Array.from(new Set([
    ...(contextPacket?.file_paths ?? []),
    ...artifactPaths
  ]));
  return {
    ...contextPacket,
    text: mergedText,
    file_paths: mergedFiles,
    selection_metadata: {
      ...(contextPacket?.selection_metadata ?? {}),
      parent_task_id: parentTaskId,
      parent_artifact_paths: artifactPaths
    }
  };
}

async function maybeSeedRecentArtifactContext({ runtime, userCommand, contextPacket }) {
  const existingFiles = contextPacket?.file_paths ?? [];
  if (existingFiles.some((filePath) => isEditableArtifactPath(filePath))) {
    return contextPacket;
  }
  if (!looksLikeArtifactEditFollowup(userCommand, contextPacket)) {
    return contextPacket;
  }
  const preferredKind = artifactKindFromTextOrPath(userCommand, "");
  const targetPath = findRecentArtifactPath(runtime, preferredKind);
  if (!targetPath) {
    return contextPacket;
  }
  let extractedText = "";
  try {
    const extracted = await extractFileContent(targetPath);
    extractedText = String(extracted?.text ?? "").slice(0, 8000);
  } catch {
    extractedText = "";
  }
  const note = [
    "[Editable target artifact]",
    `Path: ${targetPath}`,
    extractedText ? "Current extracted contents:" : null,
    extractedText || null
  ].filter(Boolean).join("\n");
  const mergedText = [contextPacket?.text ?? "", note].filter(Boolean).join("\n\n").trim();
  return {
    ...contextPacket,
    text: mergedText,
    file_paths: [...existingFiles, targetPath],
    selection_metadata: {
      ...(contextPacket?.selection_metadata ?? {}),
      editable_target_path: targetPath,
      editable_target_kind: preferredKind ?? artifactKindFromTextOrPath("", targetPath)
    }
  };
}

// UCA-077 P2-05: pickRunnableExecutor moved to a shared module so this file
// and browser-submission.mjs no longer maintain byte-for-byte copies.
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

    // P4-RQ G6a: preserve any terminal status the executor already
    // set. Pre-G6 this clobbered partial_success/failed/cancelled
    // back to success, which silently overwrote G5b/G5c routing-
    // degraded and unbacked-claim downgrades. Only force success
    // when the task is still in an in-progress shape (queued/running).
    // markTaskSucceeded records an executor_history entry tagged
    // with task.status — safe to call for any terminal state.
    if (task.status === "queued" || task.status === "running") {
      updateTask(runtime, task, { status: "success", sub_status: "completed", progress: 1 }, true);
    }
    markTaskSucceeded(runtime, task);
    return { status: task.status, artifacts: artifactRecords };
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

    const requestedFormat = detectRequestedOutputFormatForTask(task);
    const shouldSynthesizeFallbackArtifact = requestedFormat.id !== "conversational"
      && generatedArtifacts.length === 0
      && task.task_spec?.goal !== "transform_existing_file";
    if (shouldSynthesizeFallbackArtifact) {
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

    // Persist the executor's final answer as result_summary so the
    // Task detail UI has something to show for conversational /
    // search-style tasks that don't produce a file artifact. Without
    // this, a successful web-search task rendered as "status: success"
    // with no visible output — the text answer was only ever in an
    // inline_result event, never stored on the task.
    if (inlineText && !task.result_summary) {
      updateTask(runtime, task, { result_summary: inlineText.trim() });
    }

    // P4-RQ G6a: preserve terminal statuses set by the executor
    // (partial_success / failed / cancelled / waiting_external_decision).
    // Pre-G6 this forced success unconditionally, clobbering G5b/G5c
    // routing-degraded and unbacked-claim downgrades.
    if (task.status === "queued" || task.status === "running") {
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
  parentMessageId = null,
  conversationId = null,
  childIndex = null,
  retryCount = 0,
  bypassDedupe = false,
  executorOverride = null,
  skipDecomposition = false,
  skipPlanLayer = false,
  background = false
}) {
  ensureRuntimeServices(runtime);
  const store = runtime.store;
  const queue = runtime.queue;

  // Unified Triage layer (see docs/task-runtime/FRAMEWORK_REDESIGN.md).
  // Runs BEFORE routing. Returns one of:
  //   fast_path   → tier-0 action, submitted via action-tool submission
  //   schedule    → plan-executor built a scheduled-task record; return it
  //   clarify     → plan-executor emitted a clarification question; return it
  //   dag_planner → (Phase 2+, gated by runtime.featureFlags.dagPlanner)
  //   single_turn → fall through, run the normal executor
  // skipPlanLayer=true is set by the scheduler when it fires a delayed task
  // so the scheduled residual doesn't re-enter the plan layer.
  if (!skipPlanLayer && !parentTaskId) {
    const { triage } = await import("./intent/triage.mjs");
    const t = await triage({ runtime, userCommand, contextPacket, executionMode });
    if (t.lane === "schedule" || t.lane === "clarify") {
      return {
        task: t.task,
        taskEvents: store.getTaskEvents(t.task.task_id),
        scheduledSchedule: t.schedule ?? null
      };
    }
    if (typeof t.userCommand === "string" && t.userCommand.trim() && t.userCommand !== userCommand) {
      userCommand = t.userCommand;
    }
    if (t.lane === "dag_planner") {
      const { runDagLane } = await import("../dag/entrypoint.mjs");
      const dagResult = await runDagLane({ runtime, userCommand, contextPacket, executionMode });
      if (dagResult?.task) {
        return {
          task: dagResult.task,
          taskEvents: dagResult.taskEvents,
          dagSnapshot: dagResult.dagSnapshot
        };
      }
      // Decision #4 fallback: planner couldn't produce a valid plan.
      // Let the single-turn agent handle the original command instead.
    }
  }

  const route = routeIntent(userCommand);
  const rawContextPacket = normalizeContextPacket(contextPacket);
  const inspection = runtime.securityBroker.inspectContext(rawContextPacket, {
    trigger: "context_submission"
  });
  const inspectedContextPacket = inspection.allowed ? inspection.contextPacket : rawContextPacket;
  // UCA-182 Phase 16: when the *client* explicitly sends parent_task_id
  // (the user signalled "follow up on this task"), prepend the parent's
  // command + final reply + artifacts. That's load-bearing memory; keep
  // it inline because losing it breaks task trees.
  const withParentContext = seedParentTaskContext({
    runtime,
    parentTaskId,
    contextPacket: inspectedContextPacket
  });
  // UCA-182 Phase 18: keyword/semantic recall (best-effort, 400ms
  // budget). Retained because it's cheap and often surfaces a
  // genuinely matching prior task. When it misses or the user uses
  // referential language, the model has memory tools (see Phase 21)
  // and can call recall_memory / list_recent_tasks itself.
  const withMemoryRecall = await seedSemanticMemories({
    runtime,
    userCommand,
    parentTaskId,
    contextPacket: withParentContext
  });
  const normalizedContextPacket = await maybeSeedRecentArtifactContext({
    runtime,
    userCommand,
    contextPacket: withMemoryRecall
  });

  // P4-03: SemanticRouter async preflight (shared helper, single source
  // of truth for layering — see router-preflight.mjs). Classifies
  // context sources, gates by ambiguity, calls SR when relevant, stamps
  // the result on a fresh packet clone. Today's default router falls
  // back to no_provider rejection unless a chat adapter is wired —
  // both states are handled inside createTaskSpec via the
  // SEMANTIC_ROUTER DecisionTrace stage.
  const routerEnrichedContext = await applySemanticRouterPreflight({
    userCommand,
    contextPacket: normalizedContextPacket
  });

  const preflightTaskSpec = createTaskSpec(userCommand, routerEnrichedContext, route);

  if (inspection.allowed && canDecomposeFromTaskSpec(preflightTaskSpec) && !skipDecomposition && !parentTaskId) {
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
        conversationId,
        subtasks: decomposition.subtasks,
        submitChild: ({ subtask, index, parentTaskId: compositeId, parentMessageId }) =>
          submitContextTask({
            contextPacket: routerEnrichedContext,
            userCommand: subtask.command,
            runtime,
            executionMode,
            parentTaskId: compositeId,
            parentMessageId,
            conversationId,
            childIndex: index,
            executorOverride: subtask.suggested_executor ?? null,
            skipDecomposition: true
          })
      });
    }
  }

  // P4-03 §6 RED-LINE FIX: pass the SR-enriched packet (with
  // context_sources + semantic_router_decision/rejection stamped) to
  // createTaskRecord so the final task.task_spec / tool_policy /
  // decision_trace see the LLM merge. Pre-fix createTaskRecord re-ran
  // createTaskSpec on the bare normalizedContextPacket, silently
  // dropping the preflight result — SR only affected decomposition
  // logic, not the persisted task.
  const { task } = submitTaskWithConversation({
    route,
    contextPacket: routerEnrichedContext,
    userCommand,
    executionMode,
    parentTaskId,
    parentMessageId,
    conversationId,
    childIndex,
    retryCount,
    bypassDedupe,
    executorOverride,
    runtime,
    projectId: routerEnrichedContext?.selection_metadata?.project_id ?? null
  });
  const enqueued = queue.enqueue(task);
  emitTaskEvent({
    runtime,
    taskId: task.task_id,
    eventType: "task_created",
    payload: {
      source_type: routerEnrichedContext.source_type,
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

  const execute = async () => {
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

    const requestedFormat = detectRequestedOutputFormatForTask(task);
    const shouldPreferProviderArtifactFlow = requestedFormat.id !== "conversational"
      && hasChatApiProvider()
      && !hasFileOrImageContext(routerEnrichedContext);

    if (shouldPreferProviderArtifactFlow && (task.executor === "kimi" || task.executor === "code_cli")) {
      task.executor = "fast";
      store.updateTask(task.task_id, task);
    }

    // Resolve the code_cli runtime *per task* so that provider switches in the
    // UI take effect on the next submission without needing a service restart.
    const resolvedCliRuntime = resolveCodeCliRuntimeForTask("chat", runtime.kimiRuntime);

    if (shouldUseKimi && resolvedCliRuntime && !shouldPreferProviderArtifactFlow) {
      const artifactStore = runtime.artifactStore ?? createArtifactStore();
      const allowFallback = !hasFileOrImageContext(routerEnrichedContext);
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
  };

  if (background) {
    setTimeout(() => { void execute(); }, 0);
    return { task, taskEvents: store.getTaskEvents(task.task_id), artifacts: [], background: true };
  }

  return execute();
}
