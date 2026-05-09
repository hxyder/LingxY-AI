import crypto from "node:crypto";

export const CONVERSATION_SESSION_SCHEMA_VERSION = "1.0";
export const SESSION_ITEM_KINDS = Object.freeze({
  USER_MESSAGE: "user_message",
  ASSISTANT_MESSAGE: "assistant_message",
  TASK_ANCHOR: "task_anchor",
  TOOL_CALL: "tool_call",
  TOOL_OBSERVATION: "tool_observation",
  ARTIFACT_REFERENCE: "artifact_reference",
  CONTEXT_DECISION: "context_decision",
  RUNTIME_NOTE: "runtime_note"
});

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function nowIso() {
  return new Date().toISOString();
}

function requireStoreMethod(store, method) {
  if (typeof store?.[method] !== "function") {
    throw new Error(`ConversationSessionService requires store.${method}`);
  }
}

function normalizeMetadata(metadata = {}) {
  return metadata && typeof metadata === "object" ? metadata : {};
}

function normalizeItemKind(kind) {
  const value = String(kind ?? SESSION_ITEM_KINDS.RUNTIME_NOTE).trim();
  return value || SESSION_ITEM_KINDS.RUNTIME_NOTE;
}

export function createConversationSessionService({ store, metrics = null } = {}) {
  for (const method of [
    "upsertConversationSession",
    "getConversationSession",
    "getLatestConversationSession",
    "appendSessionItem",
    "listSessionItems"
  ]) {
    requireStoreMethod(store, method);
  }

  function ensureSession({
    sessionId = null,
    conversationId,
    projectId = null,
    parentTaskId = null,
    activeTaskId = null,
    metadata = {}
  } = {}) {
    if (!conversationId) {
      throw new Error("ensureSession: conversationId required");
    }
    const existing = sessionId
      ? store.getConversationSession(sessionId)
      : store.getLatestConversationSession(conversationId);
    const session = store.upsertConversationSession({
      session_id: existing?.session_id ?? sessionId ?? newId("session"),
      conversation_id: conversationId,
      project_id: projectId ?? existing?.project_id ?? null,
      parent_task_id: parentTaskId ?? existing?.parent_task_id ?? null,
      active_task_id: activeTaskId ?? existing?.active_task_id ?? null,
      status: existing?.status ?? "active",
      created_at: existing?.created_at ?? nowIso(),
      updated_at: nowIso(),
      metadata: {
        schema_version: CONVERSATION_SESSION_SCHEMA_VERSION,
        ...(normalizeMetadata(existing?.metadata)),
        ...(normalizeMetadata(metadata))
      }
    });
    metrics?.incrementRuntimeCounter?.("conversation_session.ensure", 1, {
      source: "conversation_session"
    });
    return session;
  }

  function appendItem({
    sessionId,
    kind,
    role = null,
    content = null,
    taskId = null,
    artifactId = null,
    messageId = null,
    payload = {},
    provenance = {}
  } = {}) {
    if (!sessionId) {
      throw new Error("appendItem: sessionId required");
    }
    const item = store.appendSessionItem({
      session_id: sessionId,
      kind: normalizeItemKind(kind),
      role,
      content_text: content,
      task_id: taskId,
      artifact_id: artifactId,
      message_id: messageId,
      payload,
      provenance: {
        source: "conversation_session_service",
        ...(normalizeMetadata(provenance))
      }
    });
    metrics?.incrementRuntimeCounter?.("conversation_session.item", 1, {
      source: "conversation_session",
      status: item.kind
    });
    return item;
  }

  function recordTaskSubmission({ conversation = null, userMessage = null, task = null } = {}) {
    if (!conversation?.conversation_id || !task?.task_id) return null;
    const session = ensureSession({
      conversationId: conversation.conversation_id,
      projectId: conversation.project_id ?? null,
      parentTaskId: task.parent_task_id ?? null,
      activeTaskId: task.task_id,
      metadata: {
        task_counted_by: "task_submission"
      }
    });
    if (userMessage?.message_id) {
      appendItem({
        sessionId: session.session_id,
        kind: SESSION_ITEM_KINDS.USER_MESSAGE,
        role: userMessage.role ?? "user",
        content: userMessage.content ?? task.user_command ?? "",
        taskId: task.task_id,
        messageId: userMessage.message_id,
        payload: {
          execution_mode: task.execution_mode ?? null,
          source_app: task.context_packet?.source_app ?? null
        },
        provenance: {
          conversation_message_id: userMessage.message_id,
          relation: "triggered"
        }
      });
    }
    appendItem({
      sessionId: session.session_id,
      kind: SESSION_ITEM_KINDS.TASK_ANCHOR,
      taskId: task.task_id,
      payload: {
        parent_task_id: task.parent_task_id ?? null,
        is_continuation: Boolean(task.is_continuation),
        executor: task.executor ?? null,
        intent: task.intent ?? null
      },
      provenance: {
        relation: "active_task"
      }
    });
    return session;
  }

  function listItems(sessionId, options = {}) {
    return store.listSessionItems(sessionId, options);
  }

  return {
    ensureSession,
    appendItem,
    recordTaskSubmission,
    getSession: (sessionId) => store.getConversationSession(sessionId),
    getLatestForConversation: (conversationId) => store.getLatestConversationSession(conversationId),
    listItems
  };
}
