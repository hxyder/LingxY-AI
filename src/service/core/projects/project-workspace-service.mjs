import {
  DEFAULT_PROJECT_COLOR,
  DEFAULT_PROJECT_ID,
  DEFAULT_PROJECT_NAME,
  buildDefaultProjectStore,
  normalizeProjectStore
} from "../../../shared/project-store.mjs";

export const PROJECT_WORKSPACE_SCHEMA_VERSION = "1.0";

function nowIso() {
  return new Date().toISOString();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeProjectId(value) {
  const id = String(value ?? "").trim();
  return id ? id.slice(0, 128) : "";
}

function projectIdFromUi(project = {}) {
  return normalizeProjectId(project.project_id ?? project.id);
}

function conversationIdFromUi(conversation = {}) {
  return String(conversation.conversation_id ?? conversation.id ?? "").trim().slice(0, 128);
}

function isVisibleWorkspaceConversation(conversation = {}) {
  const metadata = conversation.metadata && typeof conversation.metadata === "object"
    ? conversation.metadata
    : {};
  return !(metadata.imported_from_project_store === true
    && Number(conversation.message_count ?? 0) <= 0
    && Number(conversation.task_count ?? 0) <= 0);
}

function toUiProject(project = {}) {
  return {
    id: project.project_id ?? project.id,
    name: project.name ?? DEFAULT_PROJECT_NAME,
    color: project.color ?? DEFAULT_PROJECT_COLOR,
    createdAt: Number.isFinite(Number(project.createdAt))
      ? Number(project.createdAt)
      : Date.parse(project.created_at ?? "") || Date.now(),
    attachedFilePaths: [],
    metadata: project.metadata ?? {}
  };
}

function normalizeProjectFilePath(value = "") {
  return String(value ?? "").trim();
}

export function createProjectWorkspaceService({ store, configStore = null } = {}) {
  function hasStoreMethods() {
    return typeof store?.upsertProject === "function"
      && typeof store?.listProjects === "function"
      && typeof store?.upsertProjectFile === "function"
      && typeof store?.listProjectFiles === "function";
  }

  function ensureDefaultProject() {
    if (!hasStoreMethods()) return null;
    return store.upsertProject({
      project_id: DEFAULT_PROJECT_ID,
      name: DEFAULT_PROJECT_NAME,
      color: DEFAULT_PROJECT_COLOR,
      metadata: {
        system: true,
        schema_version: PROJECT_WORKSPACE_SCHEMA_VERSION
      }
    });
  }

  function upsertProject(project = {}) {
    if (!hasStoreMethods()) return null;
    const projectId = projectIdFromUi(project);
    if (!projectId) return null;
    return store.upsertProject({
      project_id: projectId,
      name: project.name ?? DEFAULT_PROJECT_NAME,
      color: project.color ?? DEFAULT_PROJECT_COLOR,
      createdAt: project.createdAt,
      archived: project.archived === true,
      metadata: {
        ...(project.metadata ?? {}),
        schema_version: PROJECT_WORKSPACE_SCHEMA_VERSION
      }
    });
  }

  function recordProjectFiles(projectId, paths = [], { status = "attached", indexedAt = null, metadata = {} } = {}) {
    if (!hasStoreMethods()) return [];
    const id = normalizeProjectId(projectId);
    if (!id) return [];
    const written = [];
    for (const rawPath of asArray(paths)) {
      const filePath = normalizeProjectFilePath(rawPath);
      if (!filePath) continue;
      written.push(store.upsertProjectFile({
        project_id: id,
        path: filePath,
        status,
        indexed_at: indexedAt,
        metadata
      }));
    }
    return written;
  }

  function removeProjectFiles(projectId, paths = []) {
    if (!hasStoreMethods()) return 0;
    const id = normalizeProjectId(projectId);
    if (!id) return 0;
    let removed = 0;
    for (const rawPath of asArray(paths)) {
      const filePath = normalizeProjectFilePath(rawPath);
      if (filePath && store.deleteProjectFile?.(id, filePath)) removed += 1;
    }
    return removed;
  }

  function syncProjectStore(projectStore = null) {
    if (!hasStoreMethods()) return buildDefaultProjectStore({ withUpdatedAt: false });
    const normalized = normalizeProjectStore(projectStore, { withUpdatedAt: false });
    ensureDefaultProject();
    for (const project of normalized.projects) {
      upsertProject(project);
      const existingPaths = new Set(store.listProjectFiles(project.id, { limit: 1000 })
        .map((file) => file.path)
        .filter(Boolean));
      const missingAttachedPaths = asArray(project.attachedFilePaths)
        .filter((filePath) => filePath && !existingPaths.has(filePath));
      recordProjectFiles(project.id, missingAttachedPaths, {
        status: "attached",
        metadata: { source: "project_store_sync" }
      });
    }
    if (typeof store?.updateConversation === "function") {
      for (const conversation of normalized.conversations) {
        const conversationId = conversationIdFromUi(conversation);
        const projectId = normalizeProjectId(conversation.projectId ?? conversation.project_id);
        if (!conversationId || !projectId) continue;
        if (store.getConversation?.(conversationId)) {
          store.updateConversation(conversationId, { project_id: projectId });
        } else if (typeof store.insertConversation === "function") {
          store.insertConversation({
            conversation_id: conversationId,
            project_id: projectId,
            title: conversation.title ?? conversation.seedCommand ?? null,
            metadata: {
              ...(conversation.metadata ?? {}),
              imported_from_project_store: true
            }
          });
        }
      }
    }
    return buildProjectStore();
  }

  function buildProjectStore() {
    if (!hasStoreMethods()) {
      return normalizeProjectStore(configStore?.load?.()?.ui?.projectStore, { withUpdatedAt: false });
    }
    ensureDefaultProject();
    const projects = store.listProjects({ archived: 0, limit: 500 }).map((project) => {
      const uiProject = toUiProject(project);
      uiProject.attachedFilePaths = store.listProjectFiles(project.project_id, { limit: 1000 })
        .map((file) => file.path);
      return uiProject;
    });
    const conversations = typeof store?.listConversations === "function"
      ? store.listConversations({ archived: 0, limit: 500 }).map((conversation) => ({
          id: conversation.conversation_id,
          projectId: conversation.project_id ?? DEFAULT_PROJECT_ID,
          title: conversation.title ?? conversation.conversation_id,
          seedCommand: conversation.metadata?.seedCommand ?? conversation.title ?? "",
          createdAt: Date.parse(conversation.created_at ?? "") || 0,
          updatedAt: Date.parse(conversation.updated_at ?? "") || 0,
          metadata: conversation.metadata ?? {}
        }))
      : [];
    return normalizeProjectStore({
      currentProjectId: configStore?.load?.()?.ui?.projectStore?.currentProjectId ?? DEFAULT_PROJECT_ID,
      currentConversationId: configStore?.load?.()?.ui?.projectStore?.currentConversationId ?? null,
      projects,
      conversations,
      updatedAt: Date.now()
    }, { withUpdatedAt: false });
  }

  function getProjectWorkspace(projectId, { conversationLimit = 100, fileLimit = 500, artifactLimit = 100 } = {}) {
    if (!hasStoreMethods()) return null;
    ensureDefaultProject();
    const id = normalizeProjectId(projectId || DEFAULT_PROJECT_ID);
    const project = store.getProject?.(id) ?? null;
    if (!project) return null;
    const conversations = typeof store?.listConversations === "function"
      ? store.listConversations({ projectId: id, archived: 0, limit: conversationLimit })
        .filter(isVisibleWorkspaceConversation)
      : [];
    const files = store.listProjectFiles(id, { limit: fileLimit });
    const artifacts = typeof store?.listProjectArtifacts === "function"
      ? store.listProjectArtifacts({ projectId: id, limit: artifactLimit })
      : [];
    return {
      schema_version: PROJECT_WORKSPACE_SCHEMA_VERSION,
      project,
      project_id: id,
      conversations,
      files,
      artifacts,
      stats: {
        conversation_count: conversations.length,
        file_count: files.length,
        artifact_count: artifacts.length,
        updated_at: nowIso()
      }
    };
  }

  return {
    ensureDefaultProject,
    upsertProject,
    recordProjectFiles,
    removeProjectFiles,
    syncProjectStore,
    buildProjectStore,
    getProjectWorkspace
  };
}
