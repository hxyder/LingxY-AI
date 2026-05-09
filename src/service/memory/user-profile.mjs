import { appendBackgroundContext } from "../core/intent/background-contexts.mjs";

export const USER_MEMORY_PROFILE_VERSION = 1;

const MAX_ITEMS = 40;
const MAX_TEXT_CHARS = 600;

function normalizeText(value, max = MAX_TEXT_CHARS) {
  return `${value ?? ""}`
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, max);
}

function normalizeId(value, fallback) {
  return `${value ?? fallback ?? ""}`
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function normalizeMemoryItems(items = [], { defaultScope = "global", projectId = null } = {}) {
  const seen = new Set();
  const list = Array.isArray(items) ? items : [];
  const out = [];
  for (const raw of list) {
    const text = normalizeText(typeof raw === "string" ? raw : raw?.text);
    if (!text) continue;
    const scope = normalizeText(raw?.scope ?? defaultScope, 40) || defaultScope;
    const itemProjectId = normalizeText(raw?.projectId ?? raw?.project_id ?? projectId, 120) || null;
    const id = normalizeId(raw?.id, `${scope}_${itemProjectId ?? "global"}_${text.slice(0, 32)}`);
    const dedupeKey = `${scope}:${itemProjectId ?? ""}:${text.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({
      id,
      text,
      scope,
      ...(itemProjectId ? { projectId: itemProjectId } : {}),
      updatedAt: normalizeText(raw?.updatedAt ?? raw?.updated_at, 40) || null
    });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

export function sanitizeUserMemoryProfile(input = {}, { now = new Date().toISOString() } = {}) {
  const profile = input && typeof input === "object" ? input : {};
  return {
    schemaVersion: USER_MEMORY_PROFILE_VERSION,
    enabled: profile.enabled !== false,
    updatedAt: now,
    preferences: normalizeMemoryItems(profile.preferences ?? [], { defaultScope: "global" }),
    projectMemories: normalizeMemoryItems(profile.projectMemories ?? profile.project_memories ?? [], {
      defaultScope: "project"
    })
  };
}

export function readUserMemoryProfileFromConfig(config = {}) {
  return sanitizeUserMemoryProfile(config.ai?.userMemory ?? config.userMemory ?? {}, {
    now: config.ai?.userMemory?.updatedAt ?? config.userMemory?.updatedAt ?? new Date().toISOString()
  });
}

function renderItemList(items = []) {
  return items.map((item) => `- ${item.text}`).join("\n");
}

export function buildUserMemoryBackgroundEntries(profile = {}, { projectId = null } = {}) {
  const sanitized = sanitizeUserMemoryProfile(profile, { now: profile.updatedAt ?? new Date().toISOString() });
  if (!sanitized.enabled) return [];

  const entries = [];
  if (sanitized.preferences.length > 0) {
    entries.push({
      kind: "user_profile",
      priority: "background",
      origin: "pre_task_seed",
      content: [
        "User-stated durable preferences from editable Settings. Use only when relevant, and let the current user instruction override these notes.",
        renderItemList(sanitized.preferences)
      ].join("\n"),
      metadata: {
        user_memory_ids: sanitized.preferences.map((item) => item.id)
      }
    });
  }

  const normalizedProjectId = normalizeText(projectId, 120);
  const projectItems = sanitized.projectMemories
    .filter((item) => !normalizedProjectId || item.projectId === normalizedProjectId);
  if (projectItems.length > 0) {
    entries.push({
      kind: "project_memory",
      priority: "background",
      origin: "pre_task_seed",
      content: [
        `Project memory${normalizedProjectId ? ` for project_id=${normalizedProjectId}` : ""}. Treat as editable background, not a replacement for current file/page evidence.`,
        renderItemList(projectItems)
      ].join("\n"),
      metadata: {
        project_id: normalizedProjectId || null,
        user_memory_ids: projectItems.map((item) => item.id)
      }
    });
  }

  return entries;
}

export function applyUserMemoryProfileToContext(contextPacket = {}, profile = {}, { projectId = null } = {}) {
  let next = contextPacket;
  const entries = buildUserMemoryBackgroundEntries(profile, { projectId });
  for (const entry of entries) {
    next = appendBackgroundContext(next, entry);
  }
  if (entries.length === 0) return next;
  const ids = entries.flatMap((entry) => entry.metadata?.user_memory_ids ?? []);
  return {
    ...next,
    selection_metadata: {
      ...(next.selection_metadata ?? {}),
      user_memory_injected: true,
      user_memory_ids: ids
    }
  };
}
