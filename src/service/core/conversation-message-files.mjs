import {
  getConversationContextSummary
} from "../../shared/conversation-message-context.mjs";

function normalizePathKey(filePath = "") {
  return String(filePath ?? "").trim().replace(/\\/g, "/").toLowerCase();
}

function normalizeTs(value = null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function pushPathEntry(out, seen, {
  filePath,
  kind,
  message,
  conversation = null,
  projectId = null
}) {
  const path = String(filePath ?? "").trim();
  const key = `${kind}:${normalizePathKey(path)}`;
  if (!path || seen.has(key)) return;
  seen.add(key);
  out.push({
    path,
    kind,
    source: "user_attachment",
    project_id: projectId ?? conversation?.project_id ?? null,
    conversation_id: message?.conversation_id ?? conversation?.conversation_id ?? null,
    conversation_title: conversation?.title ?? null,
    message_id: message?.message_id ?? null,
    message_seq: typeof message?.seq === "number" ? message.seq : null,
    message_role: message?.role ?? null,
    created_at: normalizeTs(message?.ts)
  });
}

export function collectMessageFileEntries(messages = [], {
  conversationsById = null,
  projectId = null,
  limit = 500
} = {}) {
  const max = Math.max(1, Math.min(Number(limit) || 500, 2000));
  const out = [];
  const seen = new Set();
  for (const message of Array.isArray(messages) ? messages : []) {
    const summary = getConversationContextSummary(message);
    if (!summary) continue;
    const conversation = conversationsById instanceof Map
      ? conversationsById.get(message?.conversation_id)
      : null;
    for (const filePath of summary.file_paths ?? []) {
      pushPathEntry(out, seen, {
        filePath,
        kind: "user_file",
        message,
        conversation,
        projectId
      });
      if (out.length >= max) return out;
    }
    for (const filePath of summary.image_paths ?? []) {
      pushPathEntry(out, seen, {
        filePath,
        kind: "user_image",
        message,
        conversation,
        projectId
      });
      if (out.length >= max) return out;
    }
  }
  return out;
}
