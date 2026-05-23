import crypto from "node:crypto";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createArtifactStore } from "../store/artifact-store.mjs";
import { buildKimiTaskPackage } from "../executors/kimi/task-package-builder.mjs";
import { executeKimiTask } from "../executors/kimi/kimi-cli-executor.mjs";
import {
  detectRequestedOutputFormatForTask,
  detectRequestedOutputFormatsForTask,
  writeRequestedArtifactSet
} from "../executors/kimi/output-format.mjs";
import { routeIntent } from "./router/intent-router.mjs";
import { createTaskSpec, validateTaskSpec } from "./task-spec.mjs";
import { applySemanticRouterPreflight } from "./intent/router-preflight.mjs";
import { hasTimePhrase } from "./intent/trigger.mjs";
import { classifyContextSources } from "./intent/context-sources.mjs";
import { pushBackgroundContextInPlace } from "./intent/background-contexts.mjs";
import {
  firstContentEvidenceViolationMessage,
  validateContentEvidenceGate
} from "./evidence/content-evidence-gate.mjs";
import { EMBEDDING_NAMESPACES } from "../embeddings/store.mjs";
import {
  getProjectAttachedFilePaths
} from "../../shared/project-store.mjs";
import {
  createFileGenerationAttemptState,
  hasFileGenerationToolCapability,
  recordArtifactGenerated,
  recordFileGenerationToolEvent,
  shouldSynthesizeRequestedFallbackArtifact
} from "./artifact-fallback-policy.mjs";
import {
  artifactRegistrationOptionsForPath,
  rememberArtifactMetadataFromToolEvent
} from "./artifact-action-contract.mjs";
import {
  EXECUTION_PHASES,
  EXECUTION_STATES,
  runExecutionPhase
} from "./runtime/execution-graph.mjs";
import { applyLateSemanticRouterMonotonicity } from "./semantic-router-late-merge.mjs";
import { extractFileContent } from "../extractors/file-ingest.mjs";
import {
  applyExecutorEvent,
  attachPriorBackendMessages,
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
import {
  applyUserMemoryProfileToContext,
  readUserMemoryProfileFromConfig
} from "../memory/user-profile.mjs";

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

function hasChatApiProvider(task = null, runtime = null) {
  const provider = resolveProviderForTask("chat", process.env, providerOptionsForTask(task, runtime));
  return Boolean(provider && provider.kind !== "code_cli");
}

function hasFileOrImageContext(contextPacket = {}) {
  return Boolean(contextPacket.file_paths?.length || contextPacket.image_paths?.length);
}

export function shouldDeferPreExecutionPlanning({ background = false, userCommand = "" } = {}) {
  return Boolean(background || !hasTimePhrase(userCommand));
}

function runtimeWithTaskEmitter(runtime, taskId) {
  if (runtime?.emitTaskEvent) return runtime;
  return {
    ...(runtime ?? {}),
    emitTaskEvent: (eventType, payload) => emitTaskEvent({ runtime, taskId, eventType, payload })
  };
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
    captured_at: contextPacket.captured_at ?? new Date().toISOString(),
    // Front-classifier merge: pass the triage stamps through the
    // normalizer so applySemanticRouterPreflight downstream sees them and
    // skips a redundant SR call. createTaskSpec also reads
    // semantic_router_decision / _rejection from the packet to record the
    // SEMANTIC_ROUTER DecisionTrace stage.
    semantic_router_decision: contextPacket.semantic_router_decision,
    semantic_router_rejection: contextPacket.semantic_router_rejection,
    context_sources: contextPacket.context_sources,
    prior_messages: Array.isArray(contextPacket.prior_messages)
      ? contextPacket.prior_messages
      : undefined,
    // Phase 1.11 — structured background entries (memory recall / recent
    // artifact / parent task). Producers push here instead of mutating
    // `text`. Pass through so post-task patches can append to a live
    // packet that round-trips to SQLite.
    background_contexts: Array.isArray(contextPacket.background_contexts)
      ? contextPacket.background_contexts
      : []
  };
}

function uniqueArray(values = []) {
  return [...new Set((values ?? []).filter((value) => value !== undefined && value !== null))];
}

function mergeContextPacketPatch(current = {}, patch = {}) {
  return {
    ...(current ?? {}),
    ...(patch ?? {}),
    selection_metadata: {
      ...(current?.selection_metadata ?? {}),
      ...(patch?.selection_metadata ?? {})
    },
    context_sources: {
      ...(current?.context_sources ?? {}),
      ...(patch?.context_sources ?? {})
    },
    file_paths: uniqueArray([...(current?.file_paths ?? []), ...(patch?.file_paths ?? [])]),
    image_paths: uniqueArray([...(current?.image_paths ?? []), ...(patch?.image_paths ?? [])]),
    background_contexts: [
      ...(current?.background_contexts ?? []),
      ...(patch?.background_contexts ?? [])
    ]
  };
}

function setInternalTaskPromise(task, name, promise) {
  Object.defineProperty(task, name, {
    value: promise,
    enumerable: false,
    configurable: true,
    writable: true
  });
}

function descriptorForExecutor(executorId, resolvedProvider) {
  if (executorId === "translate") {
    return {
      provider_id: "lingxy.free_translator",
      provider_kind: "translator",
      provider_name: "LingxY Free Translator",
      model: "google_web+mymemory",
      transport: "https"
    };
  }
  return describeResolvedProvider(resolvedProvider);
}

function scheduleInternalTaskPromise(work) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      Promise.resolve()
        .then(work)
        .then(resolve, reject);
    }, 0);
  });
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
// time" to "let the AI ask". The model now has memory tools —
// recall_memory / list_recent_tasks / get_task_detail /
// list_conversation_artifacts — registered in
// src/service/capabilities/tools/memory-tools.mjs. When it sees
// a referential pronoun or any gap in its context, the planner calls
// those tools explicitly instead of us trying to pre-guess. This
// replaced the earlier regex-based patches.
//
// Phase 1.11 — semantic recall + recent-artifact recall now run
// POST-task as fire-and-forget background patches. The 1000ms recall
// budget no longer counts against `task_created` latency; iter ≥ 1
// of the agent loop sees the recall as a structured entry under
// `context_packet.background_contexts` (see background-contexts.mjs).
// Parent-task summary stays synchronous because it's load-bearing
// (user volunteered parent_task_id) and the work is just a small
// SQL read; structured-field migration for it is a follow-up.
//
// Recall budget = 1000ms. Earlier the comment said 400ms but the
// actual constant was bumped to 1000ms in P4-02.x after measuring
// store.search at 350-470ms p95; the 1000ms ceiling lets the realistic
// p95 return results without imposing a p50 wait.
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
const FILE_CONTENT_RECALL_K = 3;
const FILE_CONTENT_RECALL_TIMEOUT_MS = 700;
const FILE_CONTENT_RECALL_MIN_SCORE_TFIDF = 0.08;
const FILE_CONTENT_RECALL_MIN_SCORE_VECTOR = 0.03;

function passesHitThreshold(hit) {
  const score = hit?.score ?? 0;
  if (hit?.embeddingType === "tfidf") return score > MEMORY_RECALL_MIN_SCORE_TFIDF;
  return score > MEMORY_RECALL_MIN_SCORE_VECTOR;
}

function passesFileContentRecallThreshold(hit) {
  const score = hit?.score ?? 0;
  if (hit?.embeddingType === "tfidf") return score > FILE_CONTENT_RECALL_MIN_SCORE_TFIDF;
  return score > FILE_CONTENT_RECALL_MIN_SCORE_VECTOR;
}

function hasCurrentFileInput(contextPacket = {}) {
  return Array.isArray(contextPacket?.file_paths) && contextPacket.file_paths.length > 0;
}

function needsFileReadFromStructure(task = {}) {
  const taskSpecGroups = task?.task_spec?.success_contract?.required_policy_groups;
  if (Array.isArray(taskSpecGroups) && taskSpecGroups.includes("local_file_text_read")) return true;
  const initialGroups = task?.task_spec_initial?.success_contract?.required_policy_groups;
  if (Array.isArray(initialGroups) && initialGroups.includes("local_file_text_read")) return true;
  const decision = task?.context_packet?.semantic_router_decision;
  if (Array.isArray(decision?.needed_capabilities) && decision.needed_capabilities.includes("file_read")) return true;
  if (Array.isArray(decision?.required_policy_groups) && decision.required_policy_groups.includes("local_file_text_read")) return true;
  return false;
}

function fileContentProjectIdForTask(task = {}) {
  const projectId = task?.project_id ?? task?.context_packet?.selection_metadata?.project_id ?? null;
  const normalized = String(projectId ?? "").trim();
  return normalized || null;
}

function fileContentAllowlistForProject(runtime, projectId) {
  if (!projectId) return null;
  try {
    const store = runtime?.configStore?.load?.()?.ui?.projectStore;
    const paths = getProjectAttachedFilePaths(store, projectId);
    return paths.length > 0 ? new Set(paths) : null;
  } catch {
    return null;
  }
}

function formatFileContentRecallLine(hit, index) {
  const meta = hit?.metadata ?? {};
  const pathLabel = meta.path ?? hit.id;
  const score = Number(hit?.score ?? 0).toFixed(2);
  const chunk = Number.isFinite(Number(meta.chunk_index)) && Number.isFinite(Number(meta.chunk_count))
    ? ` chunk=${Number(meta.chunk_index) + 1}/${Number(meta.chunk_count)}`
    : "";
  const chars = Number.isFinite(Number(meta.char_start)) && Number.isFinite(Number(meta.char_end))
    ? ` chars=${Number(meta.char_start)}-${Number(meta.char_end)}`
    : "";
  const preview = String(hit?.text ?? "").slice(0, 360).replace(/\n+/g, " ");
  return [
    `${index + 1}. ${pathLabel} score=${score}${chunk}${chars}`,
    `   ${preview}`
  ].join("\n");
}

function isUsableMemoryHit(hit) {
  const meta = hit?.metadata ?? {};
  const status = meta.status ?? "success";
  if (!["success", "partial_success"].includes(status)) return false;
  const answer = String(meta.answer_excerpt ?? "");
  if (/Unknown tool requested|执行器出错|Task failed:/i.test(answer)) return false;
  return true;
}

export async function computeFileContentRecallEntry({ runtime, userCommand, task = null } = {}) {
  const store = runtime?.platform?.embeddingStore;
  const contextPacket = task?.context_packet ?? {};
  if (!store?.search || !userCommand || !task) return null;
  if (hasCurrentFileInput(contextPacket)) return null;
  if (!needsFileReadFromStructure(task)) return null;
  const projectId = fileContentProjectIdForTask(task);
  const pathAllowlist = fileContentAllowlistForProject(runtime, projectId);
  let results;
  try {
    results = await Promise.race([
      store.search(userCommand, pathAllowlist ? Math.max(FILE_CONTENT_RECALL_K + 2, 25) : FILE_CONTENT_RECALL_K + 2, {
        namespace: EMBEDDING_NAMESPACES.FILE_CONTENT,
        projectId
      }),
      new Promise((resolve) => setTimeout(() => resolve([]), FILE_CONTENT_RECALL_TIMEOUT_MS))
    ]);
  } catch {
    return null;
  }
  const hits = (Array.isArray(results) ? results : [])
    .filter((hit) => hit?.id)
    .filter(passesFileContentRecallThreshold)
    .filter((hit) => !pathAllowlist || pathAllowlist.has(hit?.metadata?.path))
    .slice(0, FILE_CONTENT_RECALL_K);
  if (hits.length === 0) return null;
  const lines = [
    "Candidate indexed file-content chunks. These are retrieval hints only; if the final answer depends on local file text, call read_file_text/read_folder_text on the source path for fresh evidence before claiming the file was read.",
    ...hits.map(formatFileContentRecallLine)
  ];
  return {
    kind: "rag_background",
    priority: "background",
    origin: "post_task_patch",
    content: lines.join("\n"),
    metadata: {
      project_id: projectId,
      file_content_recall_ids: hits.map((hit) => hit.id),
      file_content_recall_scores: hits.map((hit) => Number((hit.score ?? 0).toFixed(3))),
      results: hits.map((hit) => ({
        id: hit.id,
        score: Number(hit.score ?? 0),
        path: hit.metadata?.path ?? null,
        project_id: hit.metadata?.project_id ?? null,
        chunk_index: Number.isFinite(Number(hit.metadata?.chunk_index)) ? Number(hit.metadata.chunk_index) : null,
        chunk_count: Number.isFinite(Number(hit.metadata?.chunk_count)) ? Number(hit.metadata.chunk_count) : null,
        char_start: Number.isFinite(Number(hit.metadata?.char_start)) ? Number(hit.metadata.char_start) : null,
        char_end: Number.isFinite(Number(hit.metadata?.char_end)) ? Number(hit.metadata.char_end) : null
      }))
    }
  };
}

/**
 * Phase 1.11 — compute a memory-recall background entry. Returns a
 * structured entry ready for `appendBackgroundContext`, or null when
 * there's nothing to add. Pure async function — caller decides whether
 * to await (legacy / tests) or fire-and-forget (post-task patcher).
 */
export async function computeMemoryRecallEntry({ runtime, userCommand, parentTaskId }) {
  const store = runtime?.platform?.embeddingStore;
  if (!store?.search || !userCommand) return null;
  let results;
  try {
    results = await Promise.race([
      store.search(userCommand, MEMORY_RECALL_K + 2),
      new Promise((resolve) => setTimeout(() => resolve([]), MEMORY_RECALL_TIMEOUT_MS))
    ]);
  } catch {
    return null;
  }
  if (!Array.isArray(results) || results.length === 0) return null;
  const hits = results
    .filter((r) => r?.id && r.id !== parentTaskId)
    .filter(isUsableMemoryHit)
    .filter(passesHitThreshold)
    .slice(0, MEMORY_RECALL_K);
  if (hits.length === 0) return null;
  const lines = [];
  for (const hit of hits) {
    const meta = hit.metadata ?? {};
    const summary = String(meta.summary ?? hit.text.slice(0, 100)).slice(0, 120);
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
  return {
    kind: "memory_recall",
    priority: "background",
    origin: "post_task_patch",
    content: lines.join("\n"),
    metadata: {
      semantic_recall_ids: hits.map((h) => h.id),
      semantic_recall_scores: hits.map((h) => Number((h.score ?? 0).toFixed(3)))
    }
  };
}

/**
 * Legacy back-compat shim — older callers (tests, alternate submission
 * paths that haven't migrated yet) expect the old `seedSemanticMemories`
 * signature where it returns a mutated contextPacket. New callers should
 * use `computeMemoryRecallEntry` + appendBackgroundContext directly.
 */
export async function seedSemanticMemories({ runtime, userCommand, parentTaskId, contextPacket }) {
  const entry = await computeMemoryRecallEntry({ runtime, userCommand, parentTaskId });
  if (!entry) return contextPacket;
  // Keep the legacy text-merge for the few callers still on the old
  // contract; new code lifts the entry into background_contexts via
  // appendBackgroundContext directly.
  const digest = `[memory_background · 语义召回 · 仅作背景，请勿当作当前任务上下文]\n${entry.content}`;
  const mergedText = [digest, contextPacket?.text ?? ""].filter(Boolean).join("\n\n---\n\n").trim();
  return {
    ...contextPacket,
    text: mergedText,
    selection_metadata: {
      ...(contextPacket?.selection_metadata ?? {}),
      semantic_recall_ids: entry.metadata.semantic_recall_ids,
      semantic_recall_scores: entry.metadata.semantic_recall_scores,
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
function seedParentTaskContext({ runtime, parentTaskId, conversationId, contextPacket }) {
  if (!parentTaskId || !runtime?.store?.getTask) return contextPacket;
  // P6 F3 followup B: structured-history-active gate. When the
  // conversation already has SQL-backed messages, parent_task_summary
  // becomes a parallel history source — exactly what the
  // single-source-of-truth invariant forbids. Skip the text injection;
  // attachPriorBackendMessages (called later in createTaskRecord) will
  // stamp the canonical messages onto contextPacket.prior_messages and
  // signal detectors / executor prompts read from there.
  //
  // Legacy fallback only fires when no conversation row exists (tasks
  // submitted without a conversation_id, or before the v1 backfill
  // ran).
  if (typeof conversationId === "string" && conversationId
      && typeof runtime?.store?.getConversationMessages === "function") {
    try {
      const existing = runtime.store.getConversationMessages(conversationId, { limit: 1 });
      if (Array.isArray(existing) && existing.length > 0) {
        return contextPacket;
      }
    } catch {
      // store I/O failure — fall through to legacy injection rather
      // than dropping context entirely.
    }
  }
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

/**
 * Phase 1.11 — compute a recent-artifact background entry. Returns
 * { entry, targetPath, preferredKind } or null. The post-task patcher
 * appends entry to background_contexts AND adds targetPath to
 * file_paths so connector tools can reach the artifact.
 */
export async function computeRecentArtifactEntry({ runtime, userCommand, contextPacket }) {
  const existingFiles = contextPacket?.file_paths ?? [];
  if (existingFiles.some((filePath) => isEditableArtifactPath(filePath))) return null;
  if (!looksLikeArtifactEditFollowup(userCommand, contextPacket)) return null;
  const preferredKind = artifactKindFromTextOrPath(userCommand, "");
  const targetPath = findRecentArtifactPath(runtime, preferredKind);
  if (!targetPath) return null;
  let extractedText = "";
  try {
    const extracted = await extractFileContent(targetPath);
    extractedText = String(extracted?.text ?? "").slice(0, 8000);
  } catch {
    extractedText = "";
  }
  const lines = [
    `Path: ${targetPath}`
  ];
  if (extractedText) {
    lines.push("Current extracted contents:");
    lines.push(extractedText);
  }
  return {
    entry: {
      kind: "recent_artifact",
      priority: "weak",
      origin: "post_task_patch",
      content: lines.join("\n"),
      metadata: {
        editable_target_path: targetPath,
        editable_target_kind: preferredKind ?? artifactKindFromTextOrPath("", targetPath)
      }
    },
    targetPath,
    preferredKind
  };
}

/**
 * Legacy back-compat shim: old callers expect mutated contextPacket.
 * New callers (post-task patcher) use computeRecentArtifactEntry directly.
 */
async function maybeSeedRecentArtifactContext({ runtime, userCommand, contextPacket }) {
  const result = await computeRecentArtifactEntry({ runtime, userCommand, contextPacket });
  if (!result) return contextPacket;
  const existingFiles = contextPacket?.file_paths ?? [];
  const note = [
    "[Editable target artifact]",
    result.entry.content
  ].join("\n");
  const mergedText = [contextPacket?.text ?? "", note].filter(Boolean).join("\n\n").trim();
  return {
    ...contextPacket,
    text: mergedText,
    file_paths: [...existingFiles, result.targetPath],
    selection_metadata: {
      ...(contextPacket?.selection_metadata ?? {}),
      ...result.entry.metadata
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
    transport: descriptor.transport ?? null,
    reasoning_effort: descriptor.reasoning_effort ?? null
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

  const activeCliRuntime = cliRuntime ?? resolveCodeCliRuntimeForTask(
    "chat",
    runtime.kimiRuntime,
    providerOptionsForTask(task, runtime)
  );
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

const BUFFERED_EXECUTOR_TERMINAL_EVENTS = new Set([
  "inline_result",
  "success",
  "partial_success",
  "failed",
  "cancelled",
  "waiting_external_decision"
]);

function artifactPathsFromRecords(records = []) {
  return [...new Set((records ?? [])
    .map((record) => record?.path)
    .filter((value) => typeof value === "string" && value.trim()))];
}

function artifactRecordMatchesRequestedFormat(record = {}, requestedFormat = {}) {
  const extension = String(requestedFormat?.extension ?? "").toLowerCase();
  if (!extension) return false;
  return String(record?.path ?? "").toLowerCase().endsWith(extension);
}

function buildGeneratedArtifactFinalText({ artifactPaths = [] } = {}) {
  const allPaths = [...new Set((artifactPaths ?? []).filter((value) => typeof value === "string" && value.trim()))];
  const paths = allPaths.filter((filePath) => !/-preview\.(?:txt|html)$/iu.test(filePath));
  if (paths.length === 0 && allPaths.length > 0) paths.push(...allPaths);
  if (paths.length === 0) return "";
  return [
    "已生成以下文件：",
    ...paths.map((filePath) => `- ${filePath}`),
    "",
    "文件已经写入本机磁盘，可以直接打开查看。"
  ].join("\n");
}

function augmentTerminalEventsWithArtifacts(events = [], { generatedArtifacts = [], synthesizedArtifactCount = 0 } = {}) {
  const artifactPaths = artifactPathsFromRecords(generatedArtifacts);
  if (artifactPaths.length === 0) return events;
  const replacementText = synthesizedArtifactCount > 0
    ? buildGeneratedArtifactFinalText({ artifactPaths })
    : "";
  return events.map((event) => {
    if (!["inline_result", "success", "partial_success"].includes(event.event_type)) return event;
    const payload = { ...(event.payload ?? {}) };
    payload.artifact_paths = [
      ...new Set([
        ...(Array.isArray(payload.artifact_paths) ? payload.artifact_paths : []),
        ...artifactPaths
      ])
    ];
    if (replacementText) {
      payload.text = replacementText;
      payload.summary = replacementText;
    }
    return { ...event, payload };
  });
}

function emitAndApplyExecutorEvent({ runtime, task, event, executorDescriptor }) {
  const payload = executorDescriptor
    ? attachProviderFieldsToEvent(executorDescriptor, event.payload)
    : event.payload;
  emitTaskEvent({
    runtime,
    taskId: task.task_id,
    eventType: event.event_type,
    payload
  });
  applyExecutorEvent(runtime, task, {
    type: event.event_type,
    ...payload
  });
  return payload;
}

async function runExecutor({ runtime, task, executor }) {
  const artifactStore = runtime.artifactStore ?? createArtifactStore();
  const generatedArtifacts = [];
  const artifactMetadataByPath = new Map();
  let inlineText = "";
  const bufferedTerminalEvents = [];
  const fileGeneration = createFileGenerationAttemptState();
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
  const taskType = executor.id === "multi_modal" ? "vision" : "chat";
  const resolvedProvider = resolveProviderForTask(taskType, process.env, {
    task,
    store: runtime.store
  });
  const executorDescriptor = descriptorForExecutor(executor.id, resolvedProvider);
  if (executorDescriptor) {
    emitTaskEvent({
      runtime,
      taskId: task.task_id,
      eventType: "provider_resolved",
      payload: attachProviderFieldsToEvent(executorDescriptor, {
        task_type: taskType,
        executor_id: executor.id
      })
    });
    appendAuditLog(runtime, "ai.provider_resolved", {
      task_id: task.task_id,
      task_type: taskType,
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
      if (event.event_type === "inline_result" || event.event_type === "success") {
        const candidateText = event.payload?.text ?? event.payload?.summary ?? "";
        if (!isEmptyPlannerResponse(candidateText)) {
          inlineText = candidateText;
        }
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
      // Agentic executor yields artifact_paths on its terminal event (not
      // artifact_created). Collect them for both success and partial_success:
      // a task can be downgraded by truthfulness/obligation gates while still
      // having produced valid files that must appear in Console → Files.
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
      if (BUFFERED_EXECUTOR_TERMINAL_EVENTS.has(event.event_type)) {
        bufferedTerminalEvents.push({
          event_type: event.event_type,
          payload: event.payload ?? {}
        });
        continue;
      }
      emitAndApplyExecutorEvent({ runtime, task, event, executorDescriptor });
    }

    const requestedFormats = detectRequestedOutputFormatsForTask(task)
      .filter((format) => format?.id && format.id !== "conversational");
    const terminalFailed = bufferedTerminalEvents.some((event) =>
      ["failed", "cancelled"].includes(event.event_type)
    );
    const missingRequestedFormats = requestedFormats.filter((format) =>
      !generatedArtifacts.some((artifact) => artifactRecordMatchesRequestedFormat(artifact, format))
    );
    const requestedFormat = missingRequestedFormats[0]
      ?? requestedFormats[0]
      ?? detectRequestedOutputFormatForTask(task);
    const shouldSynthesizeFallbackArtifact = shouldSynthesizeRequestedFallbackArtifact({
      requestedFormat,
      generatedArtifacts: missingRequestedFormats.length > 0
        ? generatedArtifacts.filter((artifact) => artifactRecordMatchesRequestedFormat(artifact, requestedFormat))
        : generatedArtifacts,
      task,
      fileGeneration,
      fileGenerationToolCapability: hasFileGenerationToolCapability({
        executorId: executor.id,
        actionToolRegistry: runtime.actionToolRegistry
      })
    });
    let synthesizedArtifactCount = 0;
    if (!terminalFailed && shouldSynthesizeFallbackArtifact && missingRequestedFormats.length > 0) {
      const outputDir = await createOutputDirForTask({ runtime, artifactStore, task });
      const artifacts = await writeRequestedArtifactSet({
        assistantText: isEmptyPlannerResponse(inlineText)
          ? (task.context_packet?.text || task.user_command)
          : inlineText,
        outputDir,
        requestedFormats: missingRequestedFormats,
        preferredFileName: task.context_packet?.source_type === "audio_note"
          ? "录音转录结构化笔记.md"
          : null
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
      synthesizedArtifactCount = artifacts.length;
    }

    const terminalEvents = augmentTerminalEventsWithArtifacts(bufferedTerminalEvents, {
      generatedArtifacts,
      synthesizedArtifactCount
    });
    for (const event of terminalEvents) {
      const payload = emitAndApplyExecutorEvent({ runtime, task, event, executorDescriptor });
      if (event.event_type === "inline_result" || event.event_type === "success") {
        const candidateText = payload?.text ?? payload?.summary ?? "";
        if (!isEmptyPlannerResponse(candidateText)) {
          inlineText = candidateText;
        }
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

export async function executeExistingContextTask({
  runtime,
  task,
  route,
  userCommand,
  routerEnrichedContext,
  inspection = { allowed: true },
  executorOverride = null,
  parentTaskId = null,
  contentEvidenceGateMode = null,
  deferPreExecutionPlanning = false,
  background = false
}) {
  ensureRuntimeServices(runtime);
  const store = runtime.store;
  const queue = runtime.queue;

  if (contentEvidenceGateMode) {
    const evidenceGate = validateContentEvidenceGate({
      taskSpec: task.task_spec,
      contextPacket: task.context_packet,
      mode: contentEvidenceGateMode,
      allowImagePixels: task.executor === "multi_modal"
    });
    if (!evidenceGate.ok) {
      emitTaskEvent({
        runtime,
        taskId: task.task_id,
        eventType: "step_warning",
        payload: {
          step: "content_evidence_gate",
          mode: contentEvidenceGateMode,
          violations: evidenceGate.violations
        }
      });
      markTaskFailed(runtime, task, {
        message: firstContentEvidenceViolationMessage(evidenceGate)
      });
      return {
        task,
        taskEvents: store.getTaskEvents(task.task_id),
        artifacts: []
      };
    }
  }

  const execute = async () => {
    let executionContext = routerEnrichedContext;
    if (deferPreExecutionPlanning && inspection.allowed) {
      const srPromise = scheduleInternalTaskPromise(() => runExecutionPhase({
        runtime: runtimeWithTaskEmitter(runtime, task.task_id),
        taskId: task.task_id,
        phase: EXECUTION_PHASES.SEMANTIC_ROUTER_PATCH,
        step: "semantic_router_patch",
        progress: 0.04,
        state: EXECUTION_STATES.ROUTING,
        visibility: "diagnostic",
        background: true,
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
      }));
      setInternalTaskPromise(task, "__srPatchPromise", srPromise.then((srEnriched) => {
        if (!srEnriched) return null;
        try {
          const mergedContext = mergeContextPacketPatch(task.context_packet ?? executionContext, srEnriched);
          executionContext = mergedContext;
          routerEnrichedContext = mergedContext;
          const refreshedSpec = applyLateSemanticRouterMonotonicity({
            runtime,
            task,
            refreshedSpec: createTaskSpec(userCommand, mergedContext, route)
          });
          const refreshedValidation = validateTaskSpec(refreshedSpec);
          task.context_packet = mergedContext;
          task.task_spec = refreshedSpec;
          task.task_spec_valid = refreshedValidation.valid;
          task.task_spec_errors = refreshedValidation.errors;
          task.task_spec_source = "semantic_router_patched";
          task.sr_patch_applied_at = new Date().toISOString();
          store.updateTask(task.task_id, task);
          emitTaskEvent({
            runtime,
            taskId: task.task_id,
            eventType: "sr_patch_applied",
            payload: {
              applied_at: task.sr_patch_applied_at,
              executor_suggestion: refreshedSpec.suggested_executor ?? null,
              tool_policy_web: refreshedSpec.tool_policy?.web_search_fetch?.mode ?? null,
              expected_output: refreshedSpec.synthesis?.expected_output ?? null,
              research_quality: refreshedSpec.research_quality ?? null,
              visibility: "diagnostic",
              background: true
            }
          });
          return refreshedSpec;
        } catch { /* parallel SR patch must never break a running executor */ }
        return null;
      }).catch(() => null));
    }

    if (inspection.allowed) {
      const suppressPriorContext = task.context_packet?.selection_metadata?.context_focus?.prior_context_suppressed === true;
      const memoryPatchPromise = (async () => {
        try {
          if (suppressPriorContext) return null;
          const entry = await computeMemoryRecallEntry({
            runtime,
            userCommand,
            parentTaskId
          });
          if (!entry) return null;
          task.context_packet = pushBackgroundContextInPlace(task.context_packet, entry);
          task.context_packet.selection_metadata = {
            ...(task.context_packet.selection_metadata ?? {}),
            semantic_recall_ids: entry.metadata.semantic_recall_ids,
            semantic_recall_scores: entry.metadata.semantic_recall_scores,
            memory_background_injected: true
          };
          store.updateTask(task.task_id, task);
          emitTaskEvent({
            runtime,
            taskId: task.task_id,
            eventType: "background_context_added",
            payload: { kind: "memory_recall", count: entry.metadata.semantic_recall_ids.length }
          });
          return entry;
        } catch { return null; }
      })();
      const artifactPatchPromise = (async () => {
        try {
          if (suppressPriorContext) return null;
          const result = await computeRecentArtifactEntry({
            runtime,
            userCommand,
            contextPacket: task.context_packet
          });
          if (!result) return null;
          task.context_packet = pushBackgroundContextInPlace(task.context_packet, result.entry);
          const existingFiles = task.context_packet.file_paths ?? [];
          if (!existingFiles.includes(result.targetPath)) {
            task.context_packet.file_paths = [...existingFiles, result.targetPath];
          }
          task.context_packet.selection_metadata = {
            ...(task.context_packet.selection_metadata ?? {}),
            ...result.entry.metadata
          };
          store.updateTask(task.task_id, task);
          emitTaskEvent({
            runtime,
            taskId: task.task_id,
            eventType: "background_context_added",
            payload: { kind: "recent_artifact", target_path: result.targetPath }
          });
          return result.entry;
        } catch { return null; }
      })();
      const fileContentPatchPromise = (async () => {
        try {
          if (suppressPriorContext) return null;
          const entry = await computeFileContentRecallEntry({
            runtime,
            userCommand,
            task
          });
          if (!entry) return null;
          task.context_packet = pushBackgroundContextInPlace(task.context_packet, entry);
          task.context_packet.selection_metadata = {
            ...(task.context_packet.selection_metadata ?? {}),
            file_content_recall_ids: entry.metadata.file_content_recall_ids,
            file_content_recall_scores: entry.metadata.file_content_recall_scores,
            file_content_recall_project_id: entry.metadata.project_id,
            file_content_recall_injected: true
          };
          store.updateTask(task.task_id, task);
          emitTaskEvent({
            runtime,
            taskId: task.task_id,
            eventType: "background_context_added",
            payload: { kind: "file_content_recall", count: entry.metadata.file_content_recall_ids.length }
          });
          return entry;
        } catch { return null; }
      })();
      setInternalTaskPromise(task, "__memoryPatchPromise", memoryPatchPromise);
      setInternalTaskPromise(task, "__recentArtifactPatchPromise", artifactPatchPromise);
      setInternalTaskPromise(task, "__fileContentPatchPromise", fileContentPatchPromise);
    }

    const shouldUseKimi = task.executor !== "translate"
      && task.executor !== "agentic"
      && ((task.executor === "kimi" || task.executor === "code_cli")
        || (task.executor === "fast" && !hasFastProvider())
        || (task.executor === "general" && !hasFastProvider())
        || chatRoutedToCodeCli(task, runtime));

    const requestedFormat = detectRequestedOutputFormatForTask(task);
    const shouldPreferProviderArtifactFlow = requestedFormat.id !== "conversational"
      && hasChatApiProvider(task, runtime)
      && !hasFileOrImageContext(executionContext);

    if (shouldPreferProviderArtifactFlow && (task.executor === "kimi" || task.executor === "code_cli")) {
      task.executor = "tool_using";
      store.updateTask(task.task_id, task);
    }

    const resolvedCliRuntime = resolveCodeCliRuntimeForTask("chat", runtime.kimiRuntime, providerOptionsForTask(task, runtime));

    if (shouldUseKimi && resolvedCliRuntime && !shouldPreferProviderArtifactFlow) {
      const artifactStore = runtime.artifactStore ?? createArtifactStore();
      const allowFallback = !hasFileOrImageContext(executionContext);
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
        const fallbackExecutor = runtime.executors?.find((executor) => executor.id === "tool_using");
        if (fallbackExecutor) {
          updateTask(runtime, task, {
            status: "queued",
            sub_status: "fallback_to_tool_using_executor",
            failure_category: null,
            failure_user_message: null,
            failure_internal_log_excerpt: null
          }, true);
          task.executor = "tool_using";
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

export async function submitContextTask({
  contextPacket,
  userCommand,
  runtime,
  executionMode,
  parentTaskId = null,
  parentMessageId = null,
  conversationId = null,
  conversationTitle = null,
  conversationMetadata = null,
  clientMessageId = null,
  projectId = null,
  childIndex = null,
  retryCount = 0,
  bypassDedupe = false,
  executorOverride = null,
  skipDecomposition = false,
  skipPlanLayer = false,
  contentEvidenceGateMode = null,
  background = false
}) {
  ensureRuntimeServices(runtime);
  const store = runtime.store;
  const queue = runtime.queue;
  const incomingConversationId =
    (typeof conversationId === "string" && conversationId.length > 0)
      ? conversationId
      : (typeof contextPacket?.selection_metadata?.conversation_id === "string"
        ? contextPacket.selection_metadata.conversation_id
        : null);
  const contextPacketForTriage = incomingConversationId
    ? attachPriorBackendMessages(contextPacket ?? {}, incomingConversationId, runtime)
    : contextPacket;

  // Unified Triage layer (see docs/task-runtime/FRAMEWORK_REDESIGN.md).
  // Runs BEFORE routing. Returns one of:
  //   schedule    → plan-executor built a scheduled-task record; return it
  //   clarify     → plan-executor emitted a clarification question; return it
  //   dag_planner → (Phase 2+, gated by runtime.featureFlags.dagPlanner)
  //   single_turn → fall through, run the normal executor
  // skipPlanLayer=true is set by the scheduler when it fires a delayed task
  // so the scheduled residual doesn't re-enter the plan layer.
  if (!skipPlanLayer && !parentTaskId) {
    const { triage } = await import("./intent/triage.mjs");
    const t = await triage({ runtime, userCommand, contextPacket: contextPacketForTriage, executionMode, background });
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
    // Front-classifier merge: triage already ran SR and stamped the
    // decision/rejection on the packet. Adopt it so downstream
    // applySemanticRouterPreflight short-circuits instead of issuing a
    // second LLM call. normalizeContextPacket strips unknown fields so
    // we lift the SR stamps onto the parameter packet here.
    if (t.contextPacket && typeof t.contextPacket === "object") {
      const stamps = {};
      if (t.contextPacket.semantic_router_decision) stamps.semantic_router_decision = t.contextPacket.semantic_router_decision;
      if (t.contextPacket.semantic_router_rejection) stamps.semantic_router_rejection = t.contextPacket.semantic_router_rejection;
      if (t.contextPacket.context_sources) stamps.context_sources = t.contextPacket.context_sources;
      if (Object.keys(stamps).length > 0) {
        contextPacket = { ...(contextPacketForTriage ?? contextPacket ?? {}), ...stamps };
      }
    }
    if (t.lane === "dag_planner") {
      const { runDagLane } = await import("../dag/entrypoint.mjs");
      const dagResult = await runDagLane({ runtime, userCommand, contextPacket: contextPacketForTriage, executionMode });
      if (dagResult?.task) {
        return {
          task: dagResult.task,
          taskEvents: dagResult.taskEvents,
          dagSnapshot: dagResult.dagSnapshot
        };
      }
      if (dagResult?.fallbackSingleTurn && dagResult?.parentTask?.task_id) {
        parentTaskId = dagResult.parentTask.task_id;
        contextPacket = mergeContextPacketPatch(contextPacketForTriage ?? contextPacket ?? {}, {
          background_contexts: [{
            type: "dag_fallback",
            title: "DAG planner fallback",
            text: `DAG planner could not complete after replan attempts; rerun the original command as a single-turn agent. Failed node: ${dagResult.dagSnapshot?.failedNodeId ?? "unknown"}. Reason: ${dagResult.planReason ?? "unknown"}.`,
            source_task_id: dagResult.parentTask.task_id,
            trust: "system"
          }]
        });
      }
      // Decision #4 fallback: planner couldn't produce a valid plan, or a
      // replan path exhausted its attempts. Let the single-turn agent handle
      // the original command instead.
    }
  }
  if (contextPacketForTriage
      && typeof contextPacketForTriage === "object"
      && Array.isArray(contextPacketForTriage.prior_messages)
      && !Array.isArray(contextPacket?.prior_messages)) {
    contextPacket = { ...contextPacketForTriage, ...(contextPacket ?? {}) };
  }

  const route = routeIntent(userCommand);
  const rawContextPacket = normalizeContextPacket(contextPacket);
  const inspection = runtime.securityBroker.inspectContext(rawContextPacket, {
    trigger: "context_submission"
  });
  const inspectedContextPacket = inspection.allowed && inspection.contextPacket
    ? inspection.contextPacket
    : rawContextPacket;
  // UCA-182 Phase 16: when the *client* explicitly sends parent_task_id
  // (the user signalled "follow up on this task"), prepend the parent's
  // command + final reply + artifacts. That's load-bearing memory; keep
  // it inline because the work is just an SQL read (~1 ms) and losing
  // it breaks task trees. seedParentTaskContext stays synchronous in
  // pre-task; structured-field migration is a follow-up.
  const withParentContext = seedParentTaskContext({
    runtime,
    parentTaskId,
    conversationId,
    contextPacket: inspectedContextPacket
  });
  // Phase 1.11 — semantic recall + recent-artifact recall moved to
  // POST-task fire-and-forget patches. Pre-task path no longer awaits
  // either; task_created emits as soon as DB write + securityBroker
  // finish. The agent loop's iter ≥ 1 reads the patched
  // `task.context_packet.background_contexts` for the recalled material.
  const effectiveConversationId =
    (typeof conversationId === "string" && conversationId.length > 0)
      ? conversationId
      : (typeof withParentContext?.selection_metadata?.conversation_id === "string"
        ? withParentContext.selection_metadata.conversation_id
        : null);
  const withUserMemoryContext = applyUserMemoryProfileToContext(
    withParentContext,
    readUserMemoryProfileFromConfig(runtime.configStore?.load?.() ?? {}),
    {
      projectId: projectId ?? withParentContext?.selection_metadata?.project_id ?? null,
      conversationId: effectiveConversationId
    }
  );

  const normalizedContextPacket = attachPriorBackendMessages(
    withUserMemoryContext,
    effectiveConversationId,
    runtime
  );

  // P4-03: SemanticRouter async preflight (shared helper, single source
  // of truth for layering — see router-preflight.mjs). Classifies
  // context sources, gates by ambiguity, calls SR when relevant, stamps
  // the result on a fresh packet clone. Today's default router falls
  // back to no_provider rejection unless a chat adapter is wired —
  // both states are handled inside createTaskSpec via the
  // SEMANTIC_ROUTER DecisionTrace stage.
  const deferPreExecutionPlanning = shouldDeferPreExecutionPlanning({ background, userCommand });
  let routerEnrichedContext = deferPreExecutionPlanning
    ? {
        ...normalizedContextPacket,
        context_sources: classifyContextSources({
          text: userCommand,
          contextPacket: normalizedContextPacket
        })
      }
    : await applySemanticRouterPreflight({
        userCommand,
        contextPacket: normalizedContextPacket
      });

  const preflightTaskSpec = createTaskSpec(userCommand, routerEnrichedContext, route);

  if (runtime?.featureFlags?.legacyDecomposer === true
      && !deferPreExecutionPlanning
      && inspection.allowed
      && canDecomposeFromTaskSpec(preflightTaskSpec)
      && !skipDecomposition
      && !parentTaskId) {
    const { decomposeUserCommand } = await import("./router/decomposer.mjs");
    const { submitCompositeTask } = await import("./composite-submission.mjs");
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
        conversationTitle,
        conversationMetadata,
        clientMessageId,
        projectId,
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
            conversationTitle,
            conversationMetadata,
            clientMessageId,
            projectId,
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
    conversationTitle,
    conversationMetadata,
    clientMessageId,
    childIndex,
    retryCount,
    bypassDedupe,
    executorOverride,
    submissionKind: "context",
    runtime,
    projectId: projectId ?? routerEnrichedContext?.selection_metadata?.project_id ?? null
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

  return executeExistingContextTask({
    runtime,
    task,
    route,
    userCommand,
    routerEnrichedContext,
    inspection,
    executorOverride,
    parentTaskId,
    contentEvidenceGateMode,
    deferPreExecutionPlanning,
    background
  });
}
