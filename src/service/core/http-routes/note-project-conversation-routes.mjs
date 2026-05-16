import { readJsonBody, sendJson } from "../http-helpers.mjs";
import { requireDesktopActor } from "../http-route-guards.mjs";
import { normalizeDeletedFilter } from "../deletion-lifecycle.mjs";
import {
  normalizeProjectStore as normalizeProjectStoreBase
} from "../../../shared/project-store.mjs";
import {
  buildConversationMessageContextSummary,
  hasConversationContextSummary
} from "../../../shared/conversation-message-context.mjs";
import {
  collectMessageFileEntries
} from "../conversation-message-files.mjs";
import {
  applyConversationModelOverride,
  normalizeConversationModelOverride
} from "../../../shared/conversation-model-override.mjs";
import {
  isProviderConfiguredForUse,
  providerConfigurationReason
} from "../../../shared/provider-configuration.mjs";
import {
  buildCapabilityGapSuggestions,
  mergeCapabilityGapSuggestions
} from "../../ai/onboarding/capability-gap-suggestions.mjs";
import {
  attachProjectFiles,
  removeProjectFileIndex
} from "../project-file-attachments.mjs";
import {
  indexNote,
  reindexNotesArray,
  unindexNote
} from "../store/search-index.mjs";

const NOTES_EDITOR_ACTORS = ["desktop_console"];
const NOTES_CHIP_ACTORS = ["desktop_console", "desktop_overlay"];
const PROJECT_STORE_ACTORS = ["desktop_console", "desktop_overlay"];
const PROJECT_FILE_INDEX_ACTORS = ["desktop_console"];
const CONVERSATION_MUTATION_ACTORS = ["desktop_console"];

function normalizeConversationScope(value) {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "ordinary" || raw === "chats" || raw === "default") return "ordinary";
  if (raw === "all") return "all";
  return null;
}

function normalizeProjectStore(store) {
  return normalizeProjectStoreBase(store, { withUpdatedAt: false });
}

function projectStoreForRuntime(runtime) {
  const configStore = runtime.configStore?.load?.()?.ui?.projectStore;
  if (!runtime.projectWorkspaces?.buildProjectStore) return normalizeProjectStore(configStore);
  runtime.projectWorkspaces.syncProjectStore?.(configStore);
  return runtime.projectWorkspaces.buildProjectStore();
}

function integrationPathsForRuntime(runtime = {}) {
  return runtime.platform?.integrationPaths ?? runtime.paths ?? null;
}

function statusForProjectFileResult(result) {
  if (result?.ok !== false) return 200;
  if (result.error === "audit_log_unavailable" || result.error === "embedding_store_unavailable") return 503;
  if (result.error === "project_not_found") return 404;
  return 400;
}

export function backfillConversationMessageContextSummaries(messages = [], links = [], store = null) {
  if (!Array.isArray(messages) || messages.length === 0) return messages;
  if (!store || typeof store.getTask !== "function") return messages;
  const linksByMessage = new Map();
  for (const link of Array.isArray(links) ? links : []) {
    if (!link?.message_id || !link?.task_id) continue;
    if (!linksByMessage.has(link.message_id)) linksByMessage.set(link.message_id, []);
    linksByMessage.get(link.message_id).push(link);
  }
  const taskCache = new Map();
  return messages.map((message) => {
    if (hasConversationContextSummary(message?.metadata?.context_summary)) return message;
    const messageLinks = linksByMessage.get(message?.message_id) ?? [];
    let summary = null;
    for (const link of messageLinks) {
      if (!taskCache.has(link.task_id)) {
        let task = null;
        try { task = store.getTask(link.task_id); } catch { task = null; }
        taskCache.set(link.task_id, task);
      }
      const task = taskCache.get(link.task_id);
      summary = buildConversationMessageContextSummary(
        task?.context_packet ?? task?.contextPacket ?? task?.context_packet_initial ?? task?.contextPacketInitial
      );
      if (summary) break;
    }
    if (!summary) return message;
    return {
      ...message,
      metadata: {
        ...(message.metadata ?? {}),
        context_summary: summary,
        context_summary_backfilled: true
      }
    };
  });
}

export function enrichConversationMessageTaskLinks(links = [], store = null) {
  if (!Array.isArray(links) || links.length === 0) return [];
  if (!store || typeof store.getTask !== "function") return links;
  const taskCache = new Map();
  return links.map((link) => {
    if (!link?.task_id) return link;
    if (!taskCache.has(link.task_id)) {
      let task = null;
      try { task = store.getTask(link.task_id); } catch { task = null; }
      taskCache.set(link.task_id, task);
    }
    const task = taskCache.get(link.task_id);
    if (!task) return link;
    return {
      ...link,
      status: task.status ?? link.status ?? null,
      project_id: task.project_id
        ?? task.context_packet?.selection_metadata?.project_id
        ?? link.project_id
        ?? null,
      conversation_id: task.conversation_id
        ?? task.context_packet?.selection_metadata?.conversation_id
        ?? link.conversation_id
        ?? null,
      usage_summary: task.usage_summary && typeof task.usage_summary === "object"
        ? task.usage_summary
        : null
    };
  });
}

function normalizeConversationSearchTerm(value = "") {
  return String(value ?? "").trim().toLowerCase();
}

function conversationSearchHaystack(conversation = {}, messages = []) {
  const parts = [
    conversation.title,
    conversation.summary,
    conversation.last_message_preview
  ];
  for (const message of messages) {
    parts.push(message?.content);
    const summary = message?.metadata?.context_summary;
    if (summary && typeof summary === "object") {
      parts.push(
        summary.title,
        summary.url,
        summary.text_preview,
        ...(Array.isArray(summary.file_paths) ? summary.file_paths : []),
        ...(Array.isArray(summary.image_paths) ? summary.image_paths : [])
      );
    }
  }
  return parts.filter(Boolean).map((part) => String(part)).join("\n");
}

function snippetAroundMatch(text = "", query = "", limit = 180) {
  const source = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!source) return "";
  const lower = source.toLowerCase();
  const needle = String(query ?? "").toLowerCase();
  const idx = needle ? lower.indexOf(needle) : -1;
  if (idx < 0) return source.slice(0, limit);
  const pad = Math.max(24, Math.floor((limit - needle.length) / 2));
  const start = Math.max(0, idx - pad);
  const end = Math.min(source.length, idx + needle.length + pad);
  return `${start > 0 ? "..." : ""}${source.slice(start, end)}${end < source.length ? "..." : ""}`;
}

function firstMatchingMessage(messages = [], query = "") {
  const term = normalizeConversationSearchTerm(query);
  if (!term) return null;
  return messages.find((message) => {
    const haystack = conversationSearchHaystack({}, [message]).toLowerCase();
    return haystack.includes(term);
  }) ?? null;
}

function clampConversationTitle(value = "", fallback = "Forked conversation") {
  const title = String(value ?? "").trim();
  return (title || fallback).slice(0, 200);
}

function branchTimestamp() {
  return new Date().toISOString();
}

function messageMetadataWithBranchSource(message = {}) {
  return {
    ...(message.metadata ?? {}),
    copied_from: {
      conversation_id: message.conversation_id,
      message_id: message.message_id,
      seq: message.seq
    }
  };
}

function resolveConversationBranchCut({
  store,
  conversationId,
  messageId = null,
  throughSeq = null,
  defaultToLast = true
} = {}) {
  if (typeof store?.getConversationMessages !== "function") return null;
  const messages = store.getConversationMessages(conversationId, { sinceSeq: 0, limit: 5000 });
  if (!Array.isArray(messages) || messages.length === 0) {
    return defaultToLast ? { messages: [], target: null, throughSeq: -1 } : null;
  }
  let target = null;
  if (messageId && typeof store.getMessage === "function") {
    const maybe = store.getMessage(messageId);
    if (maybe?.conversation_id === conversationId) target = maybe;
  }
  if (!target && Number.isFinite(Number(throughSeq))) {
    const seq = Number(throughSeq);
    target = messages.find((message) => Number(message.seq) === seq) ?? null;
  }
  if (!target && defaultToLast) target = messages[messages.length - 1] ?? null;
  if (!target && !defaultToLast) return null;
  const seq = target ? Number(target.seq) : -1;
  return { messages, target, throughSeq: seq };
}

export function createConversationBranch({
  store,
  sourceConversationId,
  branchKind = "fork",
  throughMessageId = null,
  throughSeq = null,
  beforeMessageId = null,
  newConversationId = null,
  title = null,
  editedContent = null,
  actor = "desktop_console"
} = {}) {
  if (typeof store?.getConversation !== "function"
      || typeof store?.insertConversation !== "function"
      || typeof store?.appendMessage !== "function") {
    return { ok: false, status: 404, error: "conversation store not available" };
  }
  const source = store.getConversation(sourceConversationId);
  if (!source) return { ok: false, status: 404, error: "conversation not found" };
  if (newConversationId && typeof store.getConversation === "function" && store.getConversation(newConversationId)) {
    return { ok: false, status: 409, error: "target conversation already exists" };
  }

  const editTarget = beforeMessageId && typeof store.getMessage === "function"
    ? store.getMessage(beforeMessageId)
    : null;
  if (beforeMessageId && editTarget?.conversation_id !== sourceConversationId) {
    return { ok: false, status: 404, error: "message not found" };
  }
  if (beforeMessageId && (typeof editedContent !== "string" || !editedContent.trim())) {
    return { ok: false, status: 400, error: "edited content required" };
  }
  const cut = resolveConversationBranchCut({
    store,
    conversationId: sourceConversationId,
    messageId: beforeMessageId ? null : throughMessageId,
    throughSeq,
    defaultToLast: true
  });
  if (!cut) return { ok: false, status: 404, error: "conversation messages not available" };
  if (throughMessageId && cut.target?.message_id !== throughMessageId) {
    return { ok: false, status: 404, error: "message not found" };
  }

  const copyThroughSeq = editTarget ? Number(editTarget.seq) - 1 : cut.throughSeq;
  const createdAt = branchTimestamp();
  const branchMeta = {
    ...(source.metadata ?? {}),
    branch: {
      kind: branchKind,
      source_conversation_id: sourceConversationId,
      source_message_id: editTarget?.message_id ?? cut.target?.message_id ?? null,
      source_seq: editTarget?.seq ?? cut.target?.seq ?? null,
      actor,
      created_at: createdAt
    }
  };
  const conversation = store.insertConversation({
    conversation_id: newConversationId || undefined,
    project_id: source.project_id ?? null,
    title: clampConversationTitle(title, `${source.title ?? "Conversation"} (${branchKind})`),
    metadata: branchMeta
  });
  const copiedMessages = [];
  for (const message of cut.messages) {
    if (Number(message.seq) > copyThroughSeq) continue;
    copiedMessages.push(store.appendMessage({
      conversation_id: conversation.conversation_id,
      role: message.role,
      content: message.content,
      status: message.status ?? null,
      metadata: messageMetadataWithBranchSource(message)
    }));
  }
  let editedMessage = null;
  if (editTarget) {
    editedMessage = store.appendMessage({
      conversation_id: conversation.conversation_id,
      role: editTarget.role,
      content: editedContent,
      status: editTarget.status ?? null,
      metadata: {
        ...(editTarget.metadata ?? {}),
        edited_from: {
          conversation_id: editTarget.conversation_id,
          message_id: editTarget.message_id,
          seq: editTarget.seq
        }
      }
    });
  }
  return {
    ok: true,
    conversation,
    source_conversation: source,
    branch: branchMeta.branch,
    copied_messages: copiedMessages,
    edited_message: editedMessage
  };
}

export function searchConversationHistory({
  store,
  query = "",
  projectId = null,
  conversationScope = null,
  limit = 20,
  archived = 0,
  messageLimit = 200
} = {}) {
  const term = normalizeConversationSearchTerm(query);
  if (!term || typeof store?.listConversations !== "function" || typeof store?.getConversationMessages !== "function") {
    return [];
  }
  const maxConversations = Math.max(Number(limit) * 8, Number(limit) + 20, 50);
  const conversations = store.listConversations({
    projectId,
    conversationScope,
    limit: Math.min(Math.max(maxConversations, 1), 500),
    archived
  });
  const results = [];
  for (const conversation of conversations) {
    const messages = store.getConversationMessages(conversation.conversation_id, {
      sinceSeq: 0,
      limit: Math.max(1, Math.min(Number(messageLimit) || 200, 500))
    });
    const links = [];
    if (typeof store.getMessageTasks === "function") {
      for (const message of messages) {
        for (const link of store.getMessageTasks(message.message_id) ?? []) links.push(link);
      }
    }
    const enrichedMessages = backfillConversationMessageContextSummaries(messages, links, store);
    const haystack = conversationSearchHaystack(conversation, enrichedMessages);
    if (!haystack.toLowerCase().includes(term)) continue;
    const matchingMessage = firstMatchingMessage(enrichedMessages, term);
    const snippetSource = matchingMessage
      ? conversationSearchHaystack({}, [matchingMessage])
      : haystack;
    const contextSummary = matchingMessage?.metadata?.context_summary ?? null;
    results.push({
      conversation,
      conversation_id: conversation.conversation_id,
      title: conversation.title ?? "Untitled conversation",
      updated_at: conversation.updated_at ?? conversation.created_at ?? null,
      message_count: conversation.message_count ?? enrichedMessages.length,
      task_count: conversation.task_count ?? 0,
      match: {
        message_id: matchingMessage?.message_id ?? null,
        seq: matchingMessage?.seq ?? null,
        role: matchingMessage?.role ?? null,
        snippet: snippetAroundMatch(snippetSource, term),
        context_summary: hasConversationContextSummary(contextSummary) ? contextSummary : null
      }
    });
    if (results.length >= limit) break;
  }
  return results;
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
    reindexNotesArray(runtime, notes);
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
    indexNote(runtime, note);
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
    if (note) {
      // Soft delete: re-upsert so the index records the deleted_at timestamp
      // and the default search hides it. Hard delete removes the entry.
      if (note.deleted_at) indexNote(runtime, note);
      else unindexNote(runtime, body.id ?? "");
    }
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
    indexNote(runtime, note);
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
    if (result?.note) indexNote(runtime, result.note);
    sendJson(response, 200, result);
    return true;
  }

  if (method === "GET" && url.pathname === "/projects/store") {
    sendJson(response, 200, {
      store: projectStoreForRuntime(runtime)
    });
    return true;
  }

  if (method === "POST" && url.pathname === "/projects/store") {
    if (!requireDesktopActor({ request, response, allowedActors: PROJECT_STORE_ACTORS })) return true;
    const body = await readJsonBody(request);
    const store = normalizeProjectStore(body.store ?? body);
    const serviceStore = runtime.projectWorkspaces?.syncProjectStore?.(store) ?? store;
    saveRuntimeConfig(runtime, (currentConfig) => ({
      ...currentConfig,
      ui: {
        ...(currentConfig.ui ?? {}),
        projectStore: serviceStore
      }
    }));
    sendJson(response, 200, { ok: true, store: serviceStore });
    return true;
  }

  const projectByIdMatch = url.pathname.match(/^\/projects\/([^/]+)$/);
  if (method === "PATCH" && projectByIdMatch) {
    if (!requireDesktopActor({ request, response, allowedActors: PROJECT_STORE_ACTORS })) return true;
    if (!runtime.projectWorkspaces?.upsertProject || !runtime.store?.getProject) {
      sendJson(response, 404, { error: "project workspace not available" });
      return true;
    }
    const projectId = decodeURIComponent(projectByIdMatch[1]);
    const current = runtime.store.getProject(projectId);
    if (!current) {
      sendJson(response, 404, { error: "project not found" });
      return true;
    }
    const body = await readJsonBody(request);
    const metadataPatch = body?.metadata && typeof body.metadata === "object" ? body.metadata : {};
    const metadata = {
      ...(current.metadata ?? {}),
      ...metadataPatch
    };
    if (typeof body?.instructions === "string") {
      metadata.instructions = body.instructions.slice(0, 12000);
    }
    const project = runtime.projectWorkspaces.upsertProject({
      id: projectId,
      name: typeof body?.name === "string" && body.name.trim() ? body.name.trim().slice(0, 160) : current.name,
      color: typeof body?.color === "string" && body.color.trim() ? body.color.trim().slice(0, 32) : current.color,
      metadata
    });
    const serviceStore = runtime.projectWorkspaces.buildProjectStore?.() ?? projectStoreForRuntime(runtime);
    saveRuntimeConfig?.(runtime, (currentConfig) => ({
      ...currentConfig,
      ui: {
        ...(currentConfig.ui ?? {}),
        projectStore: serviceStore
      }
    }));
    sendJson(response, 200, {
      ok: true,
      project,
      store: serviceStore
    });
    return true;
  }

  const projectWorkspaceMatch = url.pathname.match(/^\/projects\/([^/]+)\/workspace$/);
  if (method === "GET" && projectWorkspaceMatch) {
    if (!requireDesktopActor({ request, response, allowedActors: PROJECT_STORE_ACTORS })) return true;
    const projectId = decodeURIComponent(projectWorkspaceMatch[1]);
    const workspace = runtime.projectWorkspaces?.getProjectWorkspace?.(projectId);
    if (!workspace) {
      sendJson(response, 404, { error: "project workspace not available" });
      return true;
    }
    sendJson(response, 200, workspace);
    return true;
  }

  const projectFilesAttachMatch = url.pathname.match(/^\/projects\/([^/]+)\/files\/attach$/);
  if (method === "POST" && projectFilesAttachMatch) {
    if (!requireDesktopActor({ request, response, allowedActors: PROJECT_STORE_ACTORS })) return true;
    const body = await readJsonBody(request);
    const result = await attachProjectFiles({
      runtime,
      saveRuntimeConfig,
      projectId: decodeURIComponent(projectFilesAttachMatch[1]),
      paths: body.paths ?? body.filePaths ?? []
    });
    sendJson(response, statusForProjectFileResult(result), result);
    return true;
  }

  const projectFilesRemoveIndexMatch = url.pathname.match(/^\/projects\/([^/]+)\/files\/remove-index$/);
  if (method === "POST" && projectFilesRemoveIndexMatch) {
    const actor = requireDesktopActor({ request, response, allowedActors: PROJECT_FILE_INDEX_ACTORS });
    if (!actor) return true;
    const body = await readJsonBody(request);
    const result = await removeProjectFileIndex({
      runtime,
      saveRuntimeConfig,
      projectId: decodeURIComponent(projectFilesRemoveIndexMatch[1]),
      paths: body.paths ?? body.filePaths ?? [],
      detach: body.detach === true,
      actor
    });
    if (result?.ok && result.detached) {
      runtime.projectWorkspaces?.removeProjectFiles?.(result.project_id, result.paths ?? []);
    }
    sendJson(response, statusForProjectFileResult(result), result);
    return true;
  }

  const projectArtifactsMatch = url.pathname.match(/^\/projects\/([^/]+)\/artifacts$/);
  if (method === "GET" && projectArtifactsMatch) {
    const projectId = projectArtifactsMatch[1];
    if (typeof runtime.store?.listProjectArtifacts !== "function"
        && (typeof runtime.store?.listConversations !== "function"
          || typeof runtime.store?.getArtifactsForConversation !== "function")) {
      sendJson(response, 404, { error: "project artifact store not available" });
      return true;
    }
    const limitParam = parseInt(url.searchParams.get("limit") ?? "100", 10);
    const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(limitParam, 500)) : 100;
    const conversationLimitParam = parseInt(url.searchParams.get("conversation_limit") ?? "200", 10);
    const conversationLimit = Number.isFinite(conversationLimitParam)
      ? Math.max(1, Math.min(conversationLimitParam, 500))
      : 200;
    if (typeof runtime.store.listProjectArtifacts === "function") {
      const artifacts = runtime.store.listProjectArtifacts({ projectId, limit });
      sendJson(response, 200, { project_id: projectId, artifacts });
      return true;
    }
    const conversations = runtime.store.listConversations({
      projectId,
      limit: conversationLimit,
      archived: 0
    });
    const artifacts = [];
    for (const conversation of conversations) {
      const conversationArtifacts = runtime.store.getArtifactsForConversation(conversation.conversation_id, { limit });
      for (const artifact of conversationArtifacts) {
        artifacts.push({
          ...artifact,
          project_id: projectId,
          conversation_title: conversation.title ?? null
        });
      }
    }
    artifacts.sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
    sendJson(response, 200, {
      project_id: projectId,
      artifacts: artifacts.slice(0, limit)
    });
    return true;
  }

  if (method === "GET" && url.pathname === "/conversations") {
    if (typeof runtime.store?.listConversations !== "function") {
      sendJson(response, 200, { conversations: [] });
      return true;
    }
    const projectId = url.searchParams.get("project_id") ?? null;
    const conversationScope = projectId
      ? null
      : normalizeConversationScope(url.searchParams.get("scope") ?? url.searchParams.get("conversation_scope"));
    const limitParam = parseInt(url.searchParams.get("limit") ?? "50", 10);
    const limit = Number.isFinite(limitParam) ? limitParam : 50;
    const archivedParam = url.searchParams.get("archived");
    const archived = archivedParam === "any" ? "any"
      : archivedParam === "1" || archivedParam === "true" ? 1
        : 0;
    const conversations = runtime.store.listConversations({ projectId, conversationScope, limit, archived });
    sendJson(response, 200, { conversations, scope: conversationScope ?? (projectId ? "project" : "all") });
    return true;
  }

  if (method === "GET" && url.pathname === "/conversations/search") {
    if (typeof runtime.store?.listConversations !== "function"
        || typeof runtime.store?.getConversationMessages !== "function") {
      sendJson(response, 200, { query: url.searchParams.get("q") ?? "", results: [] });
      return true;
    }
    const projectId = url.searchParams.get("project_id") ?? null;
    const conversationScope = projectId
      ? null
      : normalizeConversationScope(url.searchParams.get("scope") ?? url.searchParams.get("conversation_scope"));
    const limitParam = parseInt(url.searchParams.get("limit") ?? "20", 10);
    const archivedParam = url.searchParams.get("archived");
    const archived = archivedParam === "any" ? "any"
      : archivedParam === "1" || archivedParam === "true" ? 1
        : 0;
    const query = url.searchParams.get("q") ?? url.searchParams.get("query") ?? "";
    const results = searchConversationHistory({
      store: runtime.store,
      query,
      projectId,
      conversationScope,
      archived,
      limit: Number.isFinite(limitParam) ? Math.max(1, Math.min(limitParam, 50)) : 20
    });
    sendJson(response, 200, { query, results, scope: conversationScope ?? (projectId ? "project" : "all") });
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
  const conversationArtifactsMatch = url.pathname.match(/^\/conversation\/([^/]+)\/artifacts$/);
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
    const enrichedLinks = enrichConversationMessageTaskLinks(links, runtime.store);
    const enrichedMessages = backfillConversationMessageContextSummaries(messages, enrichedLinks, runtime.store);
    sendJson(response, 200, {
      conversation_id: conversationId,
      since_seq: sinceSeq,
      messages: enrichedMessages,
      message_task_links: enrichedLinks
    });
    return true;
  }

  if (method === "GET" && conversationArtifactsMatch) {
    const conversationId = conversationArtifactsMatch[1];
    if (typeof runtime.store?.getConversation !== "function"
        || typeof runtime.store?.getArtifactsForConversation !== "function") {
      sendJson(response, 404, { error: "conversation artifact store not available" });
      return true;
    }
    const conv = runtime.store.getConversation(conversationId);
    if (!conv) {
      sendJson(response, 404, { error: "conversation not found" });
      return true;
    }
    const limitParam = parseInt(url.searchParams.get("limit") ?? "50", 10);
    const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(limitParam, 500)) : 50;
    const artifacts = runtime.store.getArtifactsForConversation(conversationId, { limit });
    const messages = typeof runtime.store.getConversationMessages === "function"
      ? runtime.store.getConversationMessages(conversationId, { sinceSeq: 0, limit: 500 })
      : [];
    const messageIds = messages.map((message) => message.message_id);
    const links = [];
    if (typeof runtime.store.getMessageTasks === "function") {
      for (const id of messageIds) {
        for (const link of runtime.store.getMessageTasks(id) ?? []) links.push(link);
      }
    }
    const enrichedLinks = enrichConversationMessageTaskLinks(links, runtime.store);
    const enrichedMessages = backfillConversationMessageContextSummaries(messages, enrichedLinks, runtime.store);
    const user_files = collectMessageFileEntries(enrichedMessages, {
      conversationsById: new Map([[conversationId, conv]]),
      projectId: conv.project_id ?? null,
      limit
    });
    sendJson(response, 200, {
      conversation_id: conversationId,
      artifacts,
      user_files,
      files: [...user_files, ...artifacts.map((artifact) => ({
        ...artifact,
        source: artifact.source ?? "generated_artifact"
      }))]
    });
    return true;
  }

  const conversationByIdMatch = url.pathname.match(/^\/conversation\/([^/]+)$/);
  const conversationForkMatch = url.pathname.match(/^\/conversation\/([^/]+)\/fork$/);
  const conversationRewindMatch = url.pathname.match(/^\/conversation\/([^/]+)\/rewind$/);
  const conversationMessageEditMatch = url.pathname.match(/^\/conversation\/([^/]+)\/messages\/([^/]+)\/edit$/);
  const conversationModelMatch = url.pathname.match(/^\/conversation\/([^/]+)\/model$/);
  if (method === "POST" && (conversationForkMatch || conversationRewindMatch || conversationMessageEditMatch)) {
    const actor = requireDesktopActor({ request, response, allowedActors: CONVERSATION_MUTATION_ACTORS });
    if (!actor) return true;
    const body = await readJsonBody(request);
    const sourceConversationId = decodeURIComponent(
      conversationForkMatch?.[1] ?? conversationRewindMatch?.[1] ?? conversationMessageEditMatch?.[1]
    );
    const editMessageId = conversationMessageEditMatch ? decodeURIComponent(conversationMessageEditMatch[2]) : null;
    const requestedId = typeof body?.conversation_id === "string" && body.conversation_id.trim()
      ? body.conversation_id.trim().slice(0, 128)
      : null;
    const result = createConversationBranch({
      store: runtime.store,
      sourceConversationId,
      branchKind: conversationMessageEditMatch ? "edit" : conversationRewindMatch ? "rewind" : "fork",
      throughMessageId: typeof body?.through_message_id === "string" ? body.through_message_id : null,
      throughSeq: body?.through_seq,
      beforeMessageId: editMessageId,
      newConversationId: requestedId,
      title: typeof body?.title === "string" ? body.title : null,
      editedContent: typeof body?.content === "string" ? body.content : null,
      actor
    });
    if (!result.ok) {
      sendJson(response, result.status ?? 400, { error: result.error ?? "conversation branch failed" });
      return true;
    }
    sendJson(response, 200, {
      conversation: result.conversation,
      source_conversation: result.source_conversation,
      branch: result.branch,
      copied_messages: result.copied_messages,
      edited_message: result.edited_message
    });
    return true;
  }

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
    const config = override ? runtime.configStore?.load?.() ?? {} : {};
    if (override) {
      const provider = (config.ai?.customProviders ?? []).find((entry) => entry?.id === override.providerId) ?? null;
      if (!provider) {
        sendJson(response, 404, {
          error: "provider_not_found",
          providerId: override.providerId
        });
        return true;
      }
      if (!isProviderConfiguredForUse(provider)) {
        sendJson(response, 409, {
          error: "provider_not_configured",
          providerId: override.providerId,
          configureProviderId: override.providerId,
          reason: providerConfigurationReason(provider)
        });
        return true;
      }
    }
    const metadata = applyConversationModelOverride(conv.metadata ?? {}, override);
    const updated = override && typeof runtime.store.patchConversationMetadata === "function"
      ? runtime.store.patchConversationMetadata(conversationId, { modelOverride: override })
      : runtime.store.updateConversation(conversationId, { metadata });
    const capabilitySuggestions = override
      ? buildCapabilityGapSuggestions({
          config,
          conversationModelOverride: override,
          conversationId,
          paths: integrationPathsForRuntime(runtime)
        })
      : [];
    const onboarding = override
      ? mergeCapabilityGapSuggestions(config.ai?.onboarding ?? {}, capabilitySuggestions)
      : { pendingSuggestions: [] };
    sendJson(response, 200, {
      conversation: updated,
      modelOverride: updated?.metadata?.modelOverride ?? null,
      onboarding: {
        suggestions: onboarding.pendingSuggestions
      }
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
    const enrichedLinks = enrichConversationMessageTaskLinks(links, runtime.store);
    const enrichedMessages = backfillConversationMessageContextSummaries(messages, enrichedLinks, runtime.store);
    sendJson(response, 200, {
      conversation: conv,
      messages: enrichedMessages,
      message_task_links: enrichedLinks
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
