// Shared by overlay.js and console.js. Pure logic for the F2 backend-
// backed conversation cache: client_message_id minting, classification
// of incoming backend messages, and HTTP fetchers. UI rendering stays
// per-page — each caller plugs in its own DOM adapter.

const CLIENT_ID_PREFIX = "cmsg_";

export function createClientMessageId() {
  if (typeof crypto?.randomUUID === "function") {
    return `${CLIENT_ID_PREFIX}${crypto.randomUUID()}`;
  }
  return `${CLIENT_ID_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function ensureBackendCacheFields(conv) {
  if (!conv) return null;
  if (!(conv.pendingByClientId instanceof Map)) conv.pendingByClientId = new Map();
  if (typeof conv.lastKnownSeq !== "number") conv.lastKnownSeq = -1;
  return conv;
}

export function cssEscape(s) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(s);
  return String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

/**
 * Pure classifier. Decides what the caller should do with an incoming
 * backend message. Caller updates conv.lastKnownSeq / pendingByClientId
 * based on the returned action AFTER the UI side-effect succeeds.
 *
 * Returns one of:
 *   { action: "skip-stale" }                          — seq already seen
 *   { action: "skip-tool-summary", message }          — backend-only ledger row
 *   { action: "reconcile-pending", clientMessageId, message }
 *                                                     — upgrades existing optimistic bubble
 *   { action: "append", message }                     — new bubble to render
 */
export function classifyIncomingMessage(conv, message) {
  if (!message || typeof message.seq !== "number") return { action: "skip-stale" };
  const cache = ensureBackendCacheFields(conv);
  if (!cache) return { action: "skip-stale" };
  if (message.seq <= cache.lastKnownSeq) return { action: "skip-stale" };

  const clientId = message?.metadata?.client_message_id ?? null;
  if (clientId && cache.pendingByClientId.has(clientId)) {
    return { action: "reconcile-pending", clientMessageId: clientId, message };
  }
  if (message.role === "tool_summary") {
    return { action: "skip-tool-summary", message };
  }
  return { action: "append", message };
}

export function commitSeenSeq(conv, message) {
  const cache = ensureBackendCacheFields(conv);
  if (!cache) return;
  if (typeof message?.seq === "number" && message.seq > cache.lastKnownSeq) {
    cache.lastKnownSeq = message.seq;
  }
}

export function commitReconciledClientId(conv, clientMessageId) {
  if (!clientMessageId) return;
  const cache = ensureBackendCacheFields(conv);
  if (!cache) return;
  cache.pendingByClientId.delete(clientMessageId);
}

/**
 * Fetcher hook — caller passes a function with the same shape as
 * fetch(url, init) → Promise<Response>. The module does the URL
 * construction + JSON parse + error trap. Default limit 200; this is
 * a UI display cap, NOT a memory cap (backend keeps everything).
 */
export async function fetchMessagesSince(fetchFn, baseUrl, conversationId, { sinceSeq = 0, limit = 200 } = {}) {
  if (typeof fetchFn !== "function" || !conversationId) return null;
  const url = `${baseUrl ?? ""}/conversation/${encodeURIComponent(conversationId)}/messages`
    + `?since=${Math.max(0, sinceSeq | 0)}&limit=${Math.max(1, Math.min(limit | 0, 500))}`;
  try {
    const res = await fetchFn(url);
    if (!res?.ok) return null;
    const data = await res.json();
    return Array.isArray(data?.messages) ? data : { messages: [], message_task_links: [] };
  } catch {
    return null;
  }
}

export async function fetchConversationDetail(fetchFn, baseUrl, conversationId) {
  if (typeof fetchFn !== "function" || !conversationId) return null;
  try {
    const res = await fetchFn(`${baseUrl ?? ""}/conversation/${encodeURIComponent(conversationId)}`);
    if (!res?.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * High-level reconcile loop. Pure-ish: calls back into the caller's
 * UI adapter for each classification result. Mutates conv state
 * (pendingByClientId, lastKnownSeq) only after the adapter returns.
 *
 * @param {object} conv             — caller's conversation state object
 * @param {object} payload          — { messages: [...], message_task_links: [...] }
 * @param {object} adapter          — { onReconcilePending, onAppend, onSkip? }
 */
export function applyMessageBatch(conv, payload, adapter) {
  if (!payload || !Array.isArray(payload.messages)) return;
  for (const message of payload.messages) {
    const decision = classifyIncomingMessage(conv, message);
    switch (decision.action) {
      case "reconcile-pending":
        adapter.onReconcilePending?.(decision.message, decision.clientMessageId);
        commitReconciledClientId(conv, decision.clientMessageId);
        commitSeenSeq(conv, decision.message);
        break;
      case "append":
        adapter.onAppend?.(decision.message);
        commitSeenSeq(conv, decision.message);
        break;
      case "skip-tool-summary":
        adapter.onSkip?.(decision.message, "tool_summary");
        commitSeenSeq(conv, decision.message);
        break;
      case "skip-stale":
        adapter.onSkip?.(decision.message, "stale");
        break;
      default:
        break;
    }
  }
}

export function buildSubmitPayloadHeaders() {
  return { "Content-Type": "application/json" };
}
