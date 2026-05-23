export const DEFAULT_PROJECT_ID = "proj_default";
export const DEFAULT_PROJECT_COLOR = "#6366f1";
export const DEFAULT_PROJECT_NAME = "默认";

export function createProjectId() {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return `proj_${randomId.slice(0, 8)}`;
  return `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function buildProject({
  id = createProjectId(),
  name = "新项目",
  color = DEFAULT_PROJECT_COLOR,
  createdAt = Date.now(),
  attachedFilePaths = [],
  metadata = {}
} = {}) {
  return {
    id,
    name,
    color,
    createdAt,
    attachedFilePaths: normalizeProjectAttachedFilePaths(attachedFilePaths),
    metadata
  };
}

export function buildDefaultProject({
  color = DEFAULT_PROJECT_COLOR,
  createdAt = Date.now()
} = {}) {
  return buildProject({
    id: DEFAULT_PROJECT_ID,
    name: DEFAULT_PROJECT_NAME,
    color,
    createdAt,
    metadata: {}
  });
}

export function buildDefaultProjectStore({
  includeDefaultProject = true,
  withUpdatedAt = true,
  defaultColor = DEFAULT_PROJECT_COLOR
} = {}) {
  const store = {
    currentProjectId: DEFAULT_PROJECT_ID,
    currentConversationId: null,
    projects: includeDefaultProject ? [buildDefaultProject({ color: defaultColor })] : [],
    conversations: []
  };
  if (withUpdatedAt) store.updatedAt = 0;
  return store;
}

function clonePlain(value) {
  if (!value || typeof value !== "object") return value;
  try {
    if (typeof structuredClone === "function") return structuredClone(value);
  } catch { /* fall through */ }
  return JSON.parse(JSON.stringify(value));
}

export function normalizeProjectAttachedFilePaths(paths = []) {
  const values = Array.isArray(paths) ? paths : [];
  const seen = new Set();
  const normalized = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const path = value.trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    normalized.push(path);
  }
  return normalized;
}

export function getProjectAttachedFilePaths(store, projectId) {
  const id = typeof projectId === "string" ? projectId.trim() : "";
  if (!id || !store || typeof store !== "object") return [];
  const projects = Array.isArray(store.projects) ? store.projects : [];
  const project = projects.find((item) => item?.id === id);
  return normalizeProjectAttachedFilePaths(project?.attachedFilePaths);
}

export function setProjectAttachedFilePath(store, projectId, filePath, attached = true, options = {}) {
  const id = typeof projectId === "string" ? projectId.trim() : "";
  const path = typeof filePath === "string" ? filePath.trim() : "";
  const next = normalizeProjectStore(store, options);
  if (!id || !path) return next;
  next.projects = next.projects.map((project) => {
    if (project.id !== id) return project;
    const paths = new Set(normalizeProjectAttachedFilePaths(project.attachedFilePaths));
    if (attached) paths.add(path);
    else paths.delete(path);
    return {
      ...project,
      attachedFilePaths: [...paths]
    };
  });
  return next;
}

export function normalizeProjectStore(store, {
  includeDefaultProject = true,
  withUpdatedAt = true,
  defaultColor = DEFAULT_PROJECT_COLOR
} = {}) {
  const next = store && typeof store === "object"
    ? clonePlain(store)
    : buildDefaultProjectStore({ includeDefaultProject, withUpdatedAt, defaultColor });

  next.projects = Array.isArray(next.projects)
    ? next.projects.filter((project) => project?.id)
      .map((project) => ({
        ...project,
        attachedFilePaths: normalizeProjectAttachedFilePaths(project.attachedFilePaths)
      }))
    : [];
  next.conversations = Array.isArray(next.conversations)
    ? next.conversations.filter((conversation) => conversation?.id)
    : [];

  if (includeDefaultProject && !next.projects.some((project) => project.id === DEFAULT_PROJECT_ID)) {
    next.projects.unshift(buildDefaultProject({ color: defaultColor }));
  }

  next.currentProjectId = next.currentProjectId || DEFAULT_PROJECT_ID;
  next.currentConversationId = next.currentConversationId ?? null;
  if (withUpdatedAt) {
    next.updatedAt = Number.isFinite(Number(next.updatedAt)) ? Number(next.updatedAt) : 0;
  } else {
    delete next.updatedAt;
  }
  return next;
}

export function mergeProjectStores(localStore, remoteStore, options = {}) {
  const local = normalizeProjectStore(localStore, options);
  const remote = normalizeProjectStore(remoteStore, options);
  const localIsNewer = (local.updatedAt ?? 0) > (remote.updatedAt ?? 0);
  const pointerSource = localIsNewer ? local : remote;

  const projects = new Map();
  for (const project of [...remote.projects, ...local.projects]) {
    const existing = projects.get(project.id) ?? {};
    projects.set(project.id, {
      ...existing,
      ...project,
      attachedFilePaths: normalizeProjectAttachedFilePaths([
        ...(existing.attachedFilePaths ?? []),
        ...(project.attachedFilePaths ?? [])
      ])
    });
  }

  const conversations = new Map();
  for (const conversation of [...remote.conversations, ...local.conversations]) {
    const existing = conversations.get(conversation.id);
    if (!existing || (conversation.updatedAt ?? 0) >= (existing.updatedAt ?? 0)) {
      conversations.set(conversation.id, conversation);
    }
  }

  return normalizeProjectStore({
    currentProjectId: pointerSource.currentProjectId || DEFAULT_PROJECT_ID,
    currentConversationId: pointerSource.currentConversationId ?? null,
    projects: [...projects.values()],
    conversations: [...conversations.values()],
    updatedAt: Math.max(local.updatedAt ?? 0, remote.updatedAt ?? 0)
  }, options);
}
