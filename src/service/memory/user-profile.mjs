import { appendBackgroundContext } from "../core/intent/background-contexts.mjs";

export const USER_MEMORY_PROFILE_VERSION = 1;

const MAX_ITEMS = 40;
const MAX_PROPOSALS = 80;
const MAX_REVIEW_HISTORY = 120;
const MAX_TEXT_CHARS = 600;
const MEMORY_TYPES = new Set([
  "user_preference",
  "project_fact",
  "project_decision",
  "workflow_rule",
  "user_correction",
  "rejected_assumption",
  "artifact_summary",
  "episodic_task"
]);
const PROPOSAL_STATUSES = new Set(["pending", "approved", "rejected"]);
const REVIEW_ACTIONS = new Set(["approve_proposal", "reject_proposal", "delete_memory"]);
const REVIEW_STATUSES = new Set(["applied", "undone"]);

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

function nowIso() {
  return new Date().toISOString();
}

function normalizeMemoryType(value, fallback = "user_preference") {
  const type = normalizeText(value, 80);
  return MEMORY_TYPES.has(type) ? type : fallback;
}

function normalizeScope(value, fallback = "global") {
  const scope = normalizeText(value, 40) || fallback;
  return ["global", "project", "conversation", "artifact"].includes(scope) ? scope : fallback;
}

function normalizeProvenance(value = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeUndoPayload(value = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
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

function normalizeGovernedMemoryItems(items = [], { now = nowIso() } = {}) {
  const seen = new Set();
  const list = Array.isArray(items) ? items : [];
  const out = [];
  for (const raw of list) {
    const text = normalizeText(raw?.text);
    if (!text) continue;
    const type = normalizeMemoryType(raw?.type);
    const scope = normalizeScope(raw?.scope, raw?.projectId || raw?.project_id ? "project" : "global");
    const projectId = normalizeText(raw?.projectId ?? raw?.project_id, 120) || null;
    const conversationId = normalizeText(raw?.conversationId ?? raw?.conversation_id, 120) || null;
    const artifactId = normalizeText(raw?.artifactId ?? raw?.artifact_id, 120) || null;
    const id = normalizeId(raw?.id, `${type}_${scope}_${projectId ?? conversationId ?? artifactId ?? "global"}_${text.slice(0, 32)}`);
    const dedupeKey = `${type}:${scope}:${projectId ?? ""}:${conversationId ?? ""}:${artifactId ?? ""}:${text.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({
      id,
      type,
      text,
      scope,
      ...(projectId ? { projectId } : {}),
      ...(conversationId ? { conversationId } : {}),
      ...(artifactId ? { artifactId } : {}),
      source: normalizeText(raw?.source, 80) || "manual",
      provenance: normalizeProvenance(raw?.provenance),
      createdAt: normalizeText(raw?.createdAt ?? raw?.created_at, 40) || now,
      updatedAt: normalizeText(raw?.updatedAt ?? raw?.updated_at, 40) || now
    });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

function normalizeMemoryProposals(items = [], { now = nowIso() } = {}) {
  const list = Array.isArray(items) ? items : [];
  const out = [];
  for (const raw of list) {
    const text = normalizeText(raw?.text);
    if (!text) continue;
    const type = normalizeMemoryType(raw?.type, "user_correction");
    const scope = normalizeScope(raw?.scope, raw?.projectId || raw?.project_id ? "project" : "global");
    const status = PROPOSAL_STATUSES.has(raw?.status) ? raw.status : "pending";
    const projectId = normalizeText(raw?.projectId ?? raw?.project_id, 120) || null;
    const conversationId = normalizeText(raw?.conversationId ?? raw?.conversation_id, 120) || null;
    const artifactId = normalizeText(raw?.artifactId ?? raw?.artifact_id, 120) || null;
    const proposalId = normalizeId(raw?.proposalId ?? raw?.proposal_id ?? raw?.id, `proposal_${type}_${text.slice(0, 32)}`);
    out.push({
      proposalId,
      type,
      text,
      scope,
      status,
      ...(projectId ? { projectId } : {}),
      ...(conversationId ? { conversationId } : {}),
      ...(artifactId ? { artifactId } : {}),
      source: normalizeText(raw?.source, 80) || "candidate_detection",
      provenance: normalizeProvenance(raw?.provenance),
      createdAt: normalizeText(raw?.createdAt ?? raw?.created_at, 40) || now,
      updatedAt: normalizeText(raw?.updatedAt ?? raw?.updated_at, 40) || now,
      reviewedAt: normalizeText(raw?.reviewedAt ?? raw?.reviewed_at, 40) || null
    });
    if (out.length >= MAX_PROPOSALS) break;
  }
  return out;
}

function normalizeMemoryReviewHistory(items = [], { now = nowIso() } = {}) {
  const list = Array.isArray(items) ? items : [];
  const out = [];
  for (const raw of list) {
    const action = REVIEW_ACTIONS.has(raw?.action) ? raw.action : null;
    if (!action) continue;
    const reviewId = normalizeId(raw?.reviewId ?? raw?.review_id ?? raw?.id, `review_${action}_${out.length + 1}`);
    out.push({
      reviewId,
      action,
      status: REVIEW_STATUSES.has(raw?.status) ? raw.status : "applied",
      proposalId: normalizeText(raw?.proposalId ?? raw?.proposal_id, 120) || null,
      memoryId: normalizeText(raw?.memoryId ?? raw?.memory_id, 120) || null,
      scope: normalizeScope(raw?.scope, "global"),
      projectId: normalizeText(raw?.projectId ?? raw?.project_id, 120) || null,
      conversationId: normalizeText(raw?.conversationId ?? raw?.conversation_id, 120) || null,
      artifactId: normalizeText(raw?.artifactId ?? raw?.artifact_id, 120) || null,
      actor: normalizeText(raw?.actor, 80) || "desktop_console",
      createdAt: normalizeText(raw?.createdAt ?? raw?.created_at, 40) || now,
      undoneAt: normalizeText(raw?.undoneAt ?? raw?.undone_at, 40) || null,
      summary: normalizeText(raw?.summary, 180) || action,
      undo: normalizeUndoPayload(raw?.undo)
    });
    if (out.length >= MAX_REVIEW_HISTORY) break;
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
    }),
    approvedMemories: normalizeGovernedMemoryItems(profile.approvedMemories ?? profile.approved_memories ?? [], { now }),
    proposals: normalizeMemoryProposals(profile.proposals ?? profile.memoryProposals ?? profile.memory_proposals ?? [], { now }),
    reviewHistory: normalizeMemoryReviewHistory(profile.reviewHistory ?? profile.review_history ?? [], { now })
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

function relevantGovernedMemories(items = [], { projectId = null, conversationId = null, artifactId = null } = {}) {
  const normalizedProjectId = normalizeText(projectId, 120);
  const normalizedConversationId = normalizeText(conversationId, 120);
  const normalizedArtifactId = normalizeText(artifactId, 120);
  return items.filter((item) => {
    if (item.scope === "global") return true;
    if (item.scope === "project") return Boolean(normalizedProjectId) && item.projectId === normalizedProjectId;
    if (item.scope === "conversation") return Boolean(normalizedConversationId) && item.conversationId === normalizedConversationId;
    if (item.scope === "artifact") return Boolean(normalizedArtifactId) && item.artifactId === normalizedArtifactId;
    return false;
  });
}

function scopedIdentity(item = {}, profile = {}) {
  const proposal = item.proposalId
    ? profile.proposals?.find((candidate) => candidate.proposalId === item.proposalId)
    : null;
  const memory = item.memoryId
    ? profile.approvedMemories?.find((candidate) => candidate.id === item.memoryId)
    : null;
  const undoMemory = item.undo?.memory && typeof item.undo.memory === "object" ? item.undo.memory : null;
  const source = item.action ? (proposal ?? memory ?? undoMemory ?? item) : item;
  return {
    scope: normalizeScope(source.scope, "global"),
    projectId: normalizeText(source.projectId ?? source.project_id, 120) || null,
    conversationId: normalizeText(source.conversationId ?? source.conversation_id, 120) || null,
    artifactId: normalizeText(source.artifactId ?? source.artifact_id, 120) || null
  };
}

function matchesGovernanceFilter(item = {}, filters = {}, profile = {}) {
  const scopeFilter = normalizeText(filters.scope, 40) || "all";
  const projectId = normalizeText(filters.projectId ?? filters.project_id, 120) || null;
  const conversationId = normalizeText(filters.conversationId ?? filters.conversation_id, 120) || null;
  const artifactId = normalizeText(filters.artifactId ?? filters.artifact_id, 120) || null;
  const identity = scopedIdentity(item, profile);

  if (scopeFilter !== "all" && identity.scope !== scopeFilter) return false;
  if (projectId && identity.scope === "project" && identity.projectId !== projectId) return false;
  if (projectId && identity.scope !== "global" && identity.scope !== "project") return false;
  if (conversationId && identity.scope === "conversation" && identity.conversationId !== conversationId) return false;
  if (conversationId && identity.scope !== "global" && identity.scope !== "conversation") return false;
  if (artifactId && identity.scope === "artifact" && identity.artifactId !== artifactId) return false;
  if (artifactId && identity.scope !== "global" && identity.scope !== "artifact") return false;
  if (identity.scope === "project" && projectId && identity.projectId !== projectId) return false;
  if (identity.scope === "conversation" && conversationId && identity.conversationId !== conversationId) return false;
  if (identity.scope === "artifact" && artifactId && identity.artifactId !== artifactId) return false;
  return true;
}

export function filterMemoryGovernanceProfile(profile = {}, filters = {}) {
  const sanitized = sanitizeUserMemoryProfile(profile, { now: profile.updatedAt ?? new Date().toISOString() });
  const approvedMemories = sanitized.approvedMemories
    .filter((item) => matchesGovernanceFilter(item, filters, sanitized));
  const proposals = sanitized.proposals
    .filter((item) => matchesGovernanceFilter(item, filters, sanitized));
  const reviewHistory = sanitized.reviewHistory
    .filter((item) => matchesGovernanceFilter(item, filters, sanitized));
  return {
    ...sanitized,
    approvedMemories,
    proposals,
    reviewHistory,
    totals: {
      approvedMemories: sanitized.approvedMemories.length,
      proposals: sanitized.proposals.length,
      reviewHistory: sanitized.reviewHistory.length
    }
  };
}

function renderGovernedMemoryList(items = []) {
  return items.map((item) => `- [${item.type}] ${item.text}`).join("\n");
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

  const governed = relevantGovernedMemories(sanitized.approvedMemories, { projectId });
  const globalGoverned = governed.filter((item) => item.scope !== "project");
  const normalizedProjectId = normalizeText(projectId, 120);
  const projectItems = sanitized.projectMemories
    .filter((item) => Boolean(normalizedProjectId) && item.projectId === normalizedProjectId);
  const projectGoverned = governed.filter((item) => item.scope === "project");
  // Specific scope should precede broad reviewed memory so project facts win
  // when a task explicitly carries project_id.
  if (projectItems.length > 0 || projectGoverned.length > 0) {
    entries.push({
      kind: "project_memory",
      priority: "background",
      origin: "pre_task_seed",
      content: [
        `Project memory${normalizedProjectId ? ` for project_id=${normalizedProjectId}` : ""}. Treat as editable background, not a replacement for current file/page evidence.`,
        renderItemList(projectItems),
        renderGovernedMemoryList(projectGoverned)
      ].join("\n"),
      metadata: {
        project_id: normalizedProjectId || null,
        memory_governance: projectGoverned.length > 0,
        user_memory_ids: [
          ...projectItems.map((item) => item.id),
          ...projectGoverned.map((item) => item.id)
        ],
        memory_types: [...new Set(projectGoverned.map((item) => item.type))]
      }
    });
  }

  if (globalGoverned.length > 0) {
    entries.push({
      kind: "user_profile",
      priority: "background",
      origin: "pre_task_seed",
      content: [
        "Reviewed memory approved by the user. Use only when scoped and relevant; current instructions override memory.",
        renderGovernedMemoryList(globalGoverned)
      ].join("\n"),
      metadata: {
        memory_governance: true,
        user_memory_ids: globalGoverned.map((item) => item.id),
        memory_types: [...new Set(globalGoverned.map((item) => item.type))]
      }
    });
  }

  return entries;
}

export function createMemoryProposal({
  type = "user_correction",
  text,
  scope = "global",
  projectId = null,
  conversationId = null,
  artifactId = null,
  source = "candidate_detection",
  provenance = {},
  now = nowIso()
} = {}) {
  const normalized = normalizeMemoryProposals([{
    proposalId: `proposal_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    text,
    scope,
    projectId,
    conversationId,
    artifactId,
    source,
    provenance,
    status: "pending",
    createdAt: now,
    updatedAt: now
  }], { now })[0];
  if (!normalized) throw new Error("createMemoryProposal: text required");
  return normalized;
}

export function approveMemoryProposal(profile = {}, proposalId, patch = {}, { now = nowIso() } = {}) {
  const sanitized = sanitizeUserMemoryProfile(profile, { now: profile.updatedAt ?? now });
  const proposal = sanitized.proposals.find((item) => item.proposalId === proposalId);
  if (!proposal || proposal.status !== "pending") return sanitized;
  const approved = normalizeGovernedMemoryItems([{
    id: patch.id,
    type: patch.type ?? proposal.type,
    text: patch.text ?? proposal.text,
    scope: patch.scope ?? proposal.scope,
    projectId: patch.projectId ?? proposal.projectId,
    conversationId: patch.conversationId ?? proposal.conversationId,
    artifactId: patch.artifactId ?? proposal.artifactId,
    source: "memory_proposal",
    provenance: {
      proposal_id: proposal.proposalId,
      proposal_source: proposal.source,
      ...(proposal.provenance ?? {}),
      ...(normalizeProvenance(patch.provenance))
    },
    createdAt: now,
    updatedAt: now
  }], { now })[0];
  const review = createMemoryReviewRecord({
    action: "approve_proposal",
    proposalId,
    memoryId: approved.id,
    scope: approved.scope,
    projectId: approved.projectId,
    conversationId: approved.conversationId,
    artifactId: approved.artifactId,
    actor: patch.actor,
    summary: `Approved ${approved.type} memory`,
    undo: { kind: "proposal_approval", proposalId, memoryId: approved.id },
    now
  });
  return sanitizeUserMemoryProfile({
    ...sanitized,
    updatedAt: now,
    approvedMemories: [...sanitized.approvedMemories, approved],
    proposals: sanitized.proposals.map((item) => item.proposalId === proposalId
      ? { ...item, status: "approved", reviewedAt: now, updatedAt: now }
      : item),
    reviewHistory: [review, ...sanitized.reviewHistory]
  }, { now });
}

export function rejectMemoryProposal(profile = {}, proposalId, { actor = "desktop_console", now = nowIso() } = {}) {
  const sanitized = sanitizeUserMemoryProfile(profile, { now: profile.updatedAt ?? now });
  const proposal = sanitized.proposals.find((item) => item.proposalId === proposalId);
  if (!proposal || proposal.status !== "pending") return sanitized;
  const review = createMemoryReviewRecord({
    action: "reject_proposal",
    proposalId,
    scope: proposal.scope,
    projectId: proposal.projectId,
    conversationId: proposal.conversationId,
    artifactId: proposal.artifactId,
    actor,
    summary: `Rejected ${proposal.type} memory proposal`,
    undo: { kind: "proposal_rejection", proposalId },
    now
  });
  return sanitizeUserMemoryProfile({
    ...sanitized,
    updatedAt: now,
    proposals: sanitized.proposals.map((item) => item.proposalId === proposalId
      ? { ...item, status: "rejected", reviewedAt: now, updatedAt: now }
      : item),
    reviewHistory: [review, ...sanitized.reviewHistory]
  }, { now });
}

export function deleteApprovedMemory(profile = {}, memoryId, { actor = "desktop_console", now = nowIso() } = {}) {
  const sanitized = sanitizeUserMemoryProfile(profile, { now: profile.updatedAt ?? now });
  const memory = sanitized.approvedMemories.find((item) => item.id === memoryId);
  if (!memory) return sanitized;
  const review = createMemoryReviewRecord({
    action: "delete_memory",
    memoryId,
    scope: memory.scope,
    projectId: memory.projectId,
    conversationId: memory.conversationId,
    artifactId: memory.artifactId,
    actor,
    summary: `Deleted ${memory.type} memory`,
    undo: { kind: "memory_delete", memory },
    now
  });
  return sanitizeUserMemoryProfile({
    ...sanitized,
    updatedAt: now,
    approvedMemories: sanitized.approvedMemories.filter((item) => item.id !== memoryId),
    reviewHistory: [review, ...sanitized.reviewHistory]
  }, { now });
}

export function createMemoryReviewRecord({
  action,
  proposalId = null,
  memoryId = null,
  scope = "global",
  projectId = null,
  conversationId = null,
  artifactId = null,
  actor = "desktop_console",
  summary = null,
  undo = {},
  now = nowIso()
} = {}) {
  return normalizeMemoryReviewHistory([{
    reviewId: `review_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    action,
    status: "applied",
    proposalId,
    memoryId,
    scope,
    projectId,
    conversationId,
    artifactId,
    actor,
    createdAt: now,
    summary,
    undo
  }], { now })[0];
}

export function undoMemoryReview(profile = {}, reviewId, { now = nowIso() } = {}) {
  const sanitized = sanitizeUserMemoryProfile(profile, { now: profile.updatedAt ?? now });
  const review = sanitized.reviewHistory.find((item) => item.reviewId === reviewId);
  if (!review || review.status === "undone") return sanitized;
  let approvedMemories = sanitized.approvedMemories;
  let proposals = sanitized.proposals;
  const undo = review.undo ?? {};

  if (undo.kind === "proposal_approval") {
    approvedMemories = approvedMemories.filter((item) => item.id !== undo.memoryId);
    proposals = proposals.map((item) => item.proposalId === undo.proposalId
      ? { ...item, status: "pending", reviewedAt: null, updatedAt: now }
      : item);
  } else if (undo.kind === "proposal_rejection") {
    proposals = proposals.map((item) => item.proposalId === undo.proposalId
      ? { ...item, status: "pending", reviewedAt: null, updatedAt: now }
      : item);
  } else if (undo.kind === "memory_delete" && undo.memory) {
    const restored = normalizeGovernedMemoryItems([{ ...undo.memory, updatedAt: now }], { now })[0];
    if (restored && !approvedMemories.some((item) => item.id === restored.id)) {
      approvedMemories = [...approvedMemories, restored];
    }
  } else {
    return sanitized;
  }

  return sanitizeUserMemoryProfile({
    ...sanitized,
    updatedAt: now,
    approvedMemories,
    proposals,
    reviewHistory: sanitized.reviewHistory.map((item) => item.reviewId === reviewId
      ? { ...item, status: "undone", undoneAt: now, updatedAt: now }
      : item)
  }, { now });
}

export function upsertApprovedMemory(profile = {}, memory = {}, { now = nowIso() } = {}) {
  const sanitized = sanitizeUserMemoryProfile(profile, { now: profile.updatedAt ?? now });
  const normalized = normalizeGovernedMemoryItems([{ ...memory, updatedAt: now }], { now })[0];
  if (!normalized) return sanitized;
  const exists = sanitized.approvedMemories.some((item) => item.id === normalized.id);
  return sanitizeUserMemoryProfile({
    ...sanitized,
    updatedAt: now,
    approvedMemories: exists
      ? sanitized.approvedMemories.map((item) => item.id === normalized.id ? normalized : item)
      : [...sanitized.approvedMemories, normalized]
  }, { now });
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
