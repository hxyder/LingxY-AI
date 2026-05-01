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
  metadata = {}
} = {}) {
  return {
    id,
    name,
    color,
    createdAt,
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
    projects.set(project.id, { ...(projects.get(project.id) ?? {}), ...project });
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
