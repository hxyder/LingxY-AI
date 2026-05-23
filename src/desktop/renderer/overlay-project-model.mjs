import {
  buildDefaultProject,
  buildDefaultProjectStore as buildDefaultProjectStoreBase,
  mergeProjectStores as mergeProjectStoresBase,
  normalizeProjectStore as normalizeProjectStoreBase
} from "../../shared/project-store.mjs";

export function ensureDefaultProjectInStore(store, { defaultProjectId, defaultColor } = {}) {
  const next = store && typeof store === "object" ? store : null;
  if (!next) return next;
  next.projects = Array.isArray(next.projects) ? next.projects : [];
  if (!next.projects.some((project) => project.id === defaultProjectId)) {
    next.projects.unshift(buildDefaultProject({ color: defaultColor }));
  }
  return next;
}

export function ensureSystemProjectInStore(store, projectId, name, color) {
  if (!store) return null;
  store.projects = Array.isArray(store.projects) ? store.projects : [];
  let project = store.projects.find((item) => item.id === projectId);
  if (!project) {
    project = { id: projectId, name, color, createdAt: Date.now(), metadata: { system: true } };
    store.projects.push(project);
  } else {
    project.name = project.name || name;
    project.color = project.color || color;
    project.metadata = { ...(project.metadata ?? {}), system: true };
  }
  return project;
}

export function projectHasUnread(store, projectId) {
  return Boolean(store?.conversations?.some((conversation) =>
    conversation.projectId === projectId && conversation.metadata?.unread === true
  ));
}

export function buildOverlayProjectStore({ defaultColor } = {}) {
  return buildDefaultProjectStoreBase({
    includeDefaultProject: false,
    defaultColor
  });
}

export function normalizeOverlayProjectStore(store, { defaultColor } = {}) {
  return normalizeProjectStoreBase(store, { defaultColor });
}

export function mergeOverlayProjectStores(localStore, remoteStore, { defaultColor } = {}) {
  return mergeProjectStoresBase(localStore, remoteStore, { defaultColor });
}

export function pruneProjectConversations(store, { maxPerProject = 50 } = {}) {
  if (!store) return store;
  store.updatedAt = Date.now();
  store.projects = Array.isArray(store.projects) ? store.projects : [];
  store.conversations = Array.isArray(store.conversations) ? store.conversations : [];
  for (const project of store.projects) {
    const conversations = store.conversations
      .filter((conversation) => conversation.projectId === project.id)
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    if (conversations.length > maxPerProject) {
      const drop = new Set(conversations.slice(maxPerProject).map((conversation) => conversation.id));
      store.conversations = store.conversations.filter((conversation) => !drop.has(conversation.id));
    }
  }
  return store;
}

export function listConversationsForProject(store, projectId) {
  if (!store) return [];
  return (store.conversations ?? [])
    .filter((conversation) => conversation.projectId === projectId)
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}
