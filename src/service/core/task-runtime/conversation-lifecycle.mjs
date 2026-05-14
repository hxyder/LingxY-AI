/**
 * Conversation lifecycle helpers for task-runtime.
 *
 * This module owns conversation row creation, prior-message enrichment,
 * title backfill, and assistant outcome messages.
 * It intentionally does not create task records; task-runtime.mjs remains the
 * orchestration shell that combines task creation, audit, queueing, and events.
 */

import {
  proposeTaskCompletionMemory,
  readUserMemoryProfileFromConfig
} from "../../memory/user-profile.mjs";

export function attachParentTaskSummary(contextPacket, parentTaskId, runtime) {
  try {
    const parent = runtime.store.getTask(parentTaskId);
    if (!parent || typeof parent !== "object") return contextPacket;
    const finalText =
      parent.result_summary
      ?? parent.result?.final_text
      ?? parent.final_text
      ?? null;
    if (typeof finalText !== "string" || finalText.trim().length === 0) {
      return contextPacket;
    }
    return {
      ...(contextPacket ?? {}),
      parent_task_summary: {
        parent_task_id: parentTaskId,
        assistant_final_text: finalText.slice(0, 1600)
      }
    };
  } catch {
    return contextPacket;
  }
}

export function attachPriorBackendMessages(contextPacket, conversationId, runtime, { limit = 12, contentCap = 1600 } = {}) {
  if (!conversationId || typeof runtime?.store?.getConversationMessages !== "function") {
    return contextPacket;
  }
  try {
    const all = runtime.store.getConversationMessages(conversationId);
    if (!Array.isArray(all) || all.length === 0) return contextPacket;
    const tail = all.slice(-Math.max(1, Math.min(limit, 50)));
    const priorMessages = tail.map((message) => ({
      role: message.role,
      content: typeof message.content === "string" ? message.content.slice(0, contentCap) : "",
      status: message.status ?? null,
      ts: message.ts ?? null
    }));
    return { ...(contextPacket ?? {}), prior_messages: priorMessages };
  } catch {
    return contextPacket;
  }
}

const RECENT_ARTIFACT_CONTEXT_LIMIT = 8;

function isPrimaryArtifactPath(artifactPath = "") {
  const normalized = String(artifactPath ?? "");
  return Boolean(
    normalized
    && !normalized.endsWith("-preview.html")
    && !normalized.endsWith("-preview.txt")
  );
}

export function attachRecentConversationArtifacts(
  contextPacket,
  conversationId,
  runtime,
  { limit = RECENT_ARTIFACT_CONTEXT_LIMIT } = {}
) {
  if (!conversationId || typeof runtime?.store?.getArtifactsForConversation !== "function") {
    return contextPacket;
  }
  try {
    const artifacts = (runtime.store.getArtifactsForConversation(conversationId, { limit }) ?? [])
      .filter((artifact) => isPrimaryArtifactPath(artifact?.path))
      .slice(0, Math.max(1, Math.min(limit, RECENT_ARTIFACT_CONTEXT_LIMIT)))
      .map((artifact) => ({
        artifact_id: artifact.artifact_id ?? null,
        task_id: artifact.task_id ?? null,
        path: artifact.path,
        kind: artifact.kind ?? null,
        mime_type: artifact.mime_type ?? null,
        source: artifact.source ?? null,
        status: artifact.status ?? null,
        created_at: artifact.created_at ?? null
      }));
    if (artifacts.length === 0) return contextPacket;
    return {
      ...(contextPacket ?? {}),
      recent_conversation_artifacts: artifacts,
      latest_conversation_artifact: artifacts[0]
    };
  } catch {
    return contextPacket;
  }
}

export function isSchedulerSourced(contextPacket) {
  return contextPacket?.selection_metadata?.scheduled_task_fire === true
    || contextPacket?.source_app === "uca.scheduler"
    || contextPacket?.capture_mode === "event";
}

export function ensureConversation(runtime, { conversationId, projectId = null, title = null, metadata = {} }) {
  if (!runtime?.store?.getConversation || !runtime.store.insertConversation) return null;
  if (typeof conversationId !== "string" || conversationId.length === 0) return null;
  const existing = runtime.store.getConversation(conversationId);
  if (existing) return existing;
  return runtime.store.insertConversation({
    conversation_id: conversationId,
    project_id: projectId ?? null,
    title: title ?? null,
    metadata: metadata && typeof metadata === "object" ? metadata : {}
  });
}

export function deriveConversationTitle(command) {
  if (typeof command !== "string") return null;
  const cleaned = command.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  const MAX = 36;
  return cleaned.length > MAX ? `${cleaned.slice(0, MAX)}…` : cleaned;
}

function formatPartialSuccessContent(message = "") {
  const raw = String(message ?? "").trim() || "see task for details";
  const normalized = raw.replace(/^Task partially succeeded:?\s*/i, "").trim() || "see task for details";
  return `Task partially succeeded: ${normalized}`;
}

export function backfillConversationTitles(runtime) {
  if (!runtime?.store?.listConversations
      || !runtime.store.getConversationMessages
      || !runtime.store.updateConversation) {
    return { scanned: 0, updated: 0 };
  }
  const all = runtime.store.listConversations({ limit: 5000, archived: 0 }) ?? [];
  let updated = 0;
  for (const conversation of all) {
    const id = conversation.conversation_id ?? conversation.id;
    if (!id) continue;
    const existing = String(conversation.title ?? "").trim();
    const needsTitle = !existing || existing === id;
    if (!needsTitle) continue;
    const messages = runtime.store.getConversationMessages(id, { limit: 5 }) ?? [];
    const firstUserMessage = messages.find((message) => message.role === "user");
    if (!firstUserMessage?.content) continue;
    const derived = deriveConversationTitle(firstUserMessage.content);
    if (!derived) continue;
    runtime.store.updateConversation(id, { title: derived });
    updated += 1;
  }
  return { scanned: all.length, updated };
}

const MAX_OUTCOME_ARTIFACT_PATHS = 8;

function maybeProposeTaskCompletionMemory(runtime, task, finalText) {
  try {
    if (task?.status !== "success" && task?.status !== "partial_success") return;
    if (typeof runtime?.configStore?.load !== "function" || typeof runtime.configStore.patch !== "function") return;
    const config = runtime.configStore.load();
    const current = readUserMemoryProfileFromConfig(config);
    const next = proposeTaskCompletionMemory(current, {
      task,
      finalText,
      now: new Date().toISOString()
    });
    if ((next.proposals ?? []).length === (current.proposals ?? []).length) return;
    runtime.configStore.patch({ ai: { userMemory: next } });
  } catch {
    // Memory proposal generation is background bookkeeping; it must never
    // change the task terminal state or visible conversation reply.
  }
}

export function appendTaskOutcomeMessage(runtime, task) {
  if (!runtime?.store?.appendMessage || !runtime.store.linkMessageToTask) return null;
  const conversationId = task?.conversation_id;
  if (!conversationId) return null;
  if (!runtime.store.getConversation?.(conversationId)) return null;
  const existingAnswered = typeof runtime.store.getTaskMessages === "function"
    ? (runtime.store.getTaskMessages(task.task_id) ?? []).some((link) => link.relation === "answered_by")
    : false;
  if (existingAnswered) return null;

  const status = task.status;
  let role = "assistant";
  let content;
  let messageStatus = status;
  if (status === "success") {
    const finalText = task.result_summary ?? task.result?.final_text ?? task.final_text ?? "";
    if (typeof finalText !== "string" || finalText.trim().length === 0) return null;
    content = finalText;
    messageStatus = "ok";
  } else if (status === "cancelled") {
    role = "system";
    content = "Task was cancelled.";
  } else if (status === "partial_success") {
    const finalText = task.result_summary ?? task.result?.final_text ?? task.final_text ?? "";
    if (typeof finalText === "string" && finalText.trim().length > 0) {
      content = finalText;
    } else {
      role = "system";
      content = formatPartialSuccessContent(task.failure_user_message);
    }
  } else if (status === "failed") {
    role = "system";
    content = `Task failed: ${task.failure_user_message ?? task.failure_category ?? "unknown error"}`;
  } else {
    role = "system";
    content = `Task ended with status=${status ?? "unknown"}.`;
  }

  try {
    const metadata = {
      task_id: task.task_id,
      executor: task.executor
    };
    if (task?.usage_summary && typeof task.usage_summary === "object") {
      metadata.usage_summary = task.usage_summary;
    }
    const evidenceSummary = task?.evidence_summary ?? task?.result?.evidence_summary ?? null;
    if (evidenceSummary && typeof evidenceSummary === "object") {
      metadata.evidence_summary = evidenceSummary;
    }
    if (typeof runtime.store.getArtifactsForTask === "function") {
      const artifactPaths = (runtime.store.getArtifactsForTask(task.task_id) ?? [])
        .map((artifact) => typeof artifact?.path === "string" ? artifact.path : "")
        .filter(Boolean)
        .filter((artifactPath) =>
          !artifactPath.endsWith("-preview.html")
          && !artifactPath.endsWith("-preview.txt")
        )
        .slice(0, MAX_OUTCOME_ARTIFACT_PATHS);
      if (artifactPaths.length > 0) {
        metadata.artifact_paths = artifactPaths;
      }
    }
    const message = runtime.store.appendMessage({
      conversation_id: conversationId,
      role,
      content,
      status: messageStatus,
      metadata
    });
    runtime.store.linkMessageToTask(message.message_id, task.task_id, "answered_by");
    maybeProposeTaskCompletionMemory(runtime, task, content);
    return message;
  } catch {
    return null;
  }
}
