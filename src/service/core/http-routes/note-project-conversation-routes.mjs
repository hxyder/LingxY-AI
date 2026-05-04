import { readJsonBody, sendJson } from "../http-helpers.mjs";
import { requireDesktopActor } from "../http-route-guards.mjs";
import { normalizeDeletedFilter } from "../deletion-lifecycle.mjs";
import {
  normalizeProjectStore as normalizeProjectStoreBase
} from "../../../shared/project-store.mjs";
import {
  applyConversationModelOverride,
  normalizeConversationModelOverride
} from "../../../shared/conversation-model-override.mjs";

const NOTES_EDITOR_ACTORS = ["desktop_console"];
const NOTES_CHIP_ACTORS = ["desktop_console", "desktop_overlay"];
const PROJECT_STORE_ACTORS = ["desktop_console", "desktop_overlay"];
const CONVERSATION_MUTATION_ACTORS = ["desktop_console"];

function normalizeProjectStore(store) {
  return normalizeProjectStoreBase(store, { withUpdatedAt: false });
}

export async function tryHandleNoteProjectConversationRoute({
  request,
  response,
  method,
  url,
  runtime,
  saveRuntimeConfig
}) {
  if (method === "GET" && url.pathname === "/notes") {
    if (!runtime.notesStore) sendJson(response, 200, { notes: [] });
    else sendJson(response, 200, {
      notes: runtime.notesStore.listNotes({
        deleted: normalizeDeletedFilter(url.searchParams.get("deleted") ?? false)
      })
    });
    return true;
  }

  if (method === "POST" && url.pathname === "/notes") {
    if (!requireDesktopActor({ request, response, allowedActors: NOTES_EDITOR_ACTORS })) return true;
    if (!runtime.notesStore) {
      sendJson(response, 503, { error: "notes store unavailable" });
      return true;
    }
    const body = await readJsonBody(request);
    const notes = runtime.notesStore.saveNotes(body.notes ?? []);
    sendJson(response, 200, { notes });
    return true;
  }

  if (method === "POST" && url.pathname === "/notes/upsert") {
    if (!requireDesktopActor({ request, response, allowedActors: NOTES_EDITOR_ACTORS })) return true;
    if (!runtime.notesStore) {
      sendJson(response, 503, { error: "notes store unavailable" });
      return true;
    }
    const body = await readJsonBody(request);
    const note = runtime.notesStore.upsertNote(body.note ?? body);
    sendJson(response, 200, { note });
    return true;
  }

  if (method === "POST" && url.pathname === "/notes/delete") {
    const actor = requireDesktopActor({ request, response, allowedActors: NOTES_EDITOR_ACTORS });
    if (!actor) return true;
    if (!runtime.notesStore) {
      sendJson(response, 503, { error: "notes store unavailable" });
      return true;
    }
    const body = await readJsonBody(request);
    const note = runtime.notesStore.deleteNote(body.id ?? "", { actor });
    sendJson(response, 200, { ok: Boolean(note), note });
    return true;
  }

  if (method === "POST" && url.pathname === "/notes/restore") {
    const actor = requireDesktopActor({ request, response, allowedActors: NOTES_EDITOR_ACTORS });
    if (!actor) return true;
    if (!runtime.notesStore) {
      sendJson(response, 503, { error: "notes store unavailable" });
      return true;
    }
    const body = await readJsonBody(request);
    const note = runtime.notesStore.restoreNote(body.id ?? "", { actor });
    sendJson(response, 200, { ok: Boolean(note), note });
    return true;
  }

  if (method === "POST" && url.pathname === "/notes/append-chip") {
    if (!requireDesktopActor({ request, response, allowedActors: NOTES_CHIP_ACTORS })) return true;
    if (!runtime.notesStore) {
      sendJson(response, 503, { error: "notes store unavailable" });
      return true;
    }
    const body = await readJsonBody(request);
    const result = runtime.notesStore.appendChip({
      noteId: body.noteId ?? "__new__",
      text: body.text ?? "",
      sourceLabel: body.sourceLabel ?? null,
      title: body.title ?? null
    });
    sendJson(response, 200, result);
    return true;
  }

  if (method === "GET" && url.pathname === "/projects/store") {
    const config = runtime.configStore?.load?.() ?? {};
    sendJson(response, 200, {
      store: normalizeProjectStore(config.ui?.projectStore)
    });
    return true;
  }

  if (method === "POST" && url.pathname === "/projects/store") {
    if (!requireDesktopActor({ request, response, allowedActors: PROJECT_STORE_ACTORS })) return true;
    const body = await readJsonBody(request);
    const store = normalizeProjectStore(body.store ?? body);
    saveRuntimeConfig(runtime, (currentConfig) => ({
      ...currentConfig,
      ui: {
        ...(currentConfig.ui ?? {}),
        projectStore: store
      }
    }));
    sendJson(response, 200, { ok: true, store });
    return true;
  }

  if (method === "GET" && url.pathname === "/conversations") {
    if (typeof runtime.store?.listConversations !== "function") {
      sendJson(response, 200, { conversations: [] });
      return true;
    }
    const projectId = url.searchParams.get("project_id") ?? null;
    const limitParam = parseInt(url.searchParams.get("limit") ?? "50", 10);
    const limit = Number.isFinite(limitParam) ? limitParam : 50;
    const archivedParam = url.searchParams.get("archived");
    const archived = archivedParam === "any" ? "any"
      : archivedParam === "1" || archivedParam === "true" ? 1
        : 0;
    const conversations = runtime.store.listConversations({ projectId, limit, archived });
    sendJson(response, 200, { conversations });
    return true;
  }

  if (method === "POST" && url.pathname === "/conversations") {
    if (!requireDesktopActor({ request, response, allowedActors: CONVERSATION_MUTATION_ACTORS })) return true;
    if (typeof runtime.store?.insertConversation !== "function") {
      sendJson(response, 404, { error: "conversation store not available" });
      return true;
    }
    const body = await readJsonBody(request);
    const requestedId = typeof body?.conversation_id === "string" && body.conversation_id.trim()
      ? body.conversation_id.trim().slice(0, 128)
      : null;
    const existing = requestedId && typeof runtime.store.getConversation === "function"
      ? runtime.store.getConversation(requestedId)
      : null;
    if (existing) {
      sendJson(response, 200, { conversation: existing, created: false });
      return true;
    }
    const conversation = runtime.store.insertConversation({
      conversation_id: requestedId ?? undefined,
      project_id: typeof body?.project_id === "string" && body.project_id.trim() ? body.project_id.trim().slice(0, 128) : null,
      title: typeof body?.title === "string" && body.title.trim() ? body.title.trim().slice(0, 200) : null,
      metadata: body?.metadata && typeof body.metadata === "object" ? body.metadata : {}
    });
    sendJson(response, 200, { conversation, created: true });
    return true;
  }

  const conversationMessagesMatch = url.pathname.match(/^\/conversation\/([^/]+)\/messages$/);
  if (method === "GET" && conversationMessagesMatch) {
    const conversationId = conversationMessagesMatch[1];
    if (typeof runtime.store?.getConversationMessages !== "function") {
      sendJson(response, 404, { error: "conversation store not available" });
      return true;
    }
    const conv = runtime.store.getConversation(conversationId);
    if (!conv) {
      sendJson(response, 404, { error: "conversation not found" });
      return true;
    }
    const sinceSeq = parseInt(url.searchParams.get("since") ?? "0", 10) || 0;
    const limitParam = parseInt(url.searchParams.get("limit") ?? "500", 10);
    const limit = Number.isFinite(limitParam) ? limitParam : 500;
    const messages = runtime.store.getConversationMessages(conversationId, { sinceSeq, limit });
    const messageIds = messages.map((message) => message.message_id);
    const links = [];
    if (typeof runtime.store.getMessageTasks === "function") {
      for (const id of messageIds) {
        for (const link of runtime.store.getMessageTasks(id) ?? []) links.push(link);
      }
    }
    sendJson(response, 200, {
      conversation_id: conversationId,
      since_seq: sinceSeq,
      messages,
      message_task_links: links
    });
    return true;
  }

  const conversationByIdMatch = url.pathname.match(/^\/conversation\/([^/]+)$/);
  const conversationModelMatch = url.pathname.match(/^\/conversation\/([^/]+)\/model$/);
  if ((method === "PATCH" || method === "DELETE") && conversationModelMatch) {
    const conversationId = conversationModelMatch[1];
    if (!requireDesktopActor({ request, response, allowedActors: CONVERSATION_MUTATION_ACTORS })) return true;
    if (typeof runtime.store?.getConversation !== "function" || typeof runtime.store?.updateConversation !== "function") {
      sendJson(response, 404, { error: "conversation store not available" });
      return true;
    }
    const conv = runtime.store.getConversation(conversationId);
    if (!conv) {
      sendJson(response, 404, { error: "conversation not found" });
      return true;
    }
    const body = method === "PATCH" ? await readJsonBody(request) : { clear: true };
    const clear = method === "DELETE" || body?.clear === true;
    const override = clear
      ? null
      : normalizeConversationModelOverride(body?.modelOverride ?? body, { pinnedAt: new Date().toISOString() });
    if (!clear && !override) {
      sendJson(response, 400, { error: "providerId required" });
      return true;
    }
    const metadata = applyConversationModelOverride(conv.metadata ?? {}, override);
    const updated = override && typeof runtime.store.patchConversationMetadata === "function"
      ? runtime.store.patchConversationMetadata(conversationId, { modelOverride: override })
      : runtime.store.updateConversation(conversationId, { metadata });
    sendJson(response, 200, {
      conversation: updated,
      modelOverride: updated?.metadata?.modelOverride ?? null
    });
    return true;
  }

  if (method === "GET" && conversationByIdMatch) {
    const conversationId = conversationByIdMatch[1];
    if (typeof runtime.store?.getConversation !== "function") {
      sendJson(response, 404, { error: "conversation store not available" });
      return true;
    }
    const conv = runtime.store.getConversation(conversationId);
    if (!conv) {
      sendJson(response, 404, { error: "conversation not found" });
      return true;
    }
    const messages = runtime.store.getConversationMessages(conversationId, { sinceSeq: 0, limit: 500 });
    const links = [];
    if (typeof runtime.store.getMessageTasks === "function") {
      for (const message of messages) {
        for (const link of runtime.store.getMessageTasks(message.message_id) ?? []) links.push(link);
      }
    }
    sendJson(response, 200, {
      conversation: conv,
      messages,
      message_task_links: links
    });
    return true;
  }

  if (method === "PATCH" && conversationByIdMatch) {
    const conversationId = conversationByIdMatch[1];
    if (!requireDesktopActor({ request, response, allowedActors: CONVERSATION_MUTATION_ACTORS })) return true;
    if (typeof runtime.store?.updateConversation !== "function") {
      sendJson(response, 404, { error: "conversation store not available" });
      return true;
    }
    const body = await readJsonBody(request);
    const patch = {};
    if (typeof body?.title === "string") patch.title = body.title.slice(0, 200);
    if (body?.archived !== undefined) patch.archived = Boolean(body.archived);
    if (Object.keys(patch).length === 0) {
      sendJson(response, 400, { error: "no patchable fields supplied" });
      return true;
    }
    const updated = runtime.store.updateConversation(conversationId, patch);
    if (!updated) sendJson(response, 404, { error: "conversation not found" });
    else sendJson(response, 200, { conversation: updated });
    return true;
  }

  if (method === "DELETE" && conversationByIdMatch) {
    const conversationId = conversationByIdMatch[1];
    if (!requireDesktopActor({ request, response, allowedActors: CONVERSATION_MUTATION_ACTORS })) return true;
    const hard = url.searchParams.get("hard") === "true";
    if (hard) {
      if (!runtime.config?.allowHardDelete) {
        sendJson(response, 403, { error: "hard delete is disabled" });
        return true;
      }
      if (typeof runtime.store?.hardDeleteConversation !== "function") {
        sendJson(response, 404, { error: "conversation store not available" });
        return true;
      }
      runtime.store.hardDeleteConversation(conversationId);
      sendJson(response, 200, { ok: true, hard: true });
      return true;
    }
    if (typeof runtime.store?.softDeleteConversation !== "function") {
      sendJson(response, 404, { error: "conversation store not available" });
      return true;
    }
    const updated = runtime.store.softDeleteConversation(conversationId);
    if (!updated) sendJson(response, 404, { error: "conversation not found" });
    else sendJson(response, 200, { conversation: updated });
    return true;
  }

  return false;
}
