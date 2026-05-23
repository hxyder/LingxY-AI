import { appendBackgroundContext } from "../core/intent/background-contexts.mjs";

export const USER_MEMORY_PROFILE_VERSION = 2;

const MAX_ITEMS = 40;
const MAX_PROPOSALS = 80;
const MAX_REVIEW_HISTORY = 120;
const MAX_ACTIVITY_HISTORY = 160;
const MAX_TEXT_CHARS = 600;
const MAX_ACTIVITY_TEXT_CHARS = 520;
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
const GENERATED_TASK_MEMORY_MODES = new Set(["off", "review", "auto_approve"]);
const ACTIVITY_KINDS = new Set(["task_summary", "tool_result", "artifact_event", "system_note"]);
const QUALITY_LANES = new Set(["review_inbox", "activity_history", "reject"]);

const VOLATILE_TASK_SUMMARY_RE = /\b(?:today|latest|current|weather|forecast|stock|stocks|market|news|price|flight|schedule)\b|(?:今天|最新|当前|现在|天气|预报|股市|股票|美股|新闻|价格|航班)/iu;
const LOW_QUALITY_TASK_SUMMARY_RE = /(?:Task failed|Unknown tool requested|执行器出错|工具.*失败|run_script|stdout|stderr|mojibake|乱码|无法完成|没有完成|temporarily unavailable|network.*unavailable|search.*unavailable)/iu;
const TASK_SUMMARY_SHAPE_RE = /^User asked:\s*[\s\S]+?\nAssistant outcome:/u;

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

function normalizeGeneratedTaskMemoryMode(profile = {}) {
  const explicit = normalizeText(
    profile.generatedTaskMemoryMode
      ?? profile.generated_task_memory_mode
      ?? profile.taskMemoryMode
      ?? profile.task_memory_mode,
    40
  );
  if (GENERATED_TASK_MEMORY_MODES.has(explicit)) return explicit;
  if (profile.autoApproveGenerated === true
      || profile.autoApproveGeneratedMemory === true
      || profile.autoApproveTaskMemory === true
      || profile.autoSaveGenerated === true
      || profile.auto_save_generated === true
      || profile.auto_approve_generated === true) {
    return "auto_approve";
  }
  if (profile.reviewGeneratedTaskMemory === true
      || profile.review_generated_task_memory === true) {
    return "review";
  }
  return "off";
}

function normalizeProvenance(value = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeUndoPayload(value = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeQuality(value = {}, fallback = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const fallbackSource = fallback && typeof fallback === "object" && !Array.isArray(fallback) ? fallback : {};
  const lane = QUALITY_LANES.has(source.lane) ? source.lane : (
    QUALITY_LANES.has(fallbackSource.lane) ? fallbackSource.lane : "review_inbox"
  );
  const scoreValue = Number.isFinite(Number(source.score))
    ? Number(source.score)
    : (Number.isFinite(Number(fallbackSource.score)) ? Number(fallbackSource.score) : 0.5);
  const reasons = Array.isArray(source.reasons)
    ? source.reasons
    : (Array.isArray(fallbackSource.reasons) ? fallbackSource.reasons : []);
  return {
    lane,
    score: Math.max(0, Math.min(1, scoreValue)),
    reasons: reasons
      .map((item) => normalizeText(item, 80))
      .filter(Boolean)
      .slice(0, 8)
  };
}

export function classifyMemoryCandidate({
  type = "user_preference",
  text = "",
  source = "candidate_detection",
  status = "pending"
} = {}) {
  const normalizedType = normalizeMemoryType(type, "user_preference");
  const normalizedText = normalizeText(text, MAX_TEXT_CHARS);
  const normalizedSource = normalizeText(source, 80) || "candidate_detection";
  const reasons = [];

  if (!normalizedText) {
    return {
      lane: "reject",
      score: 0,
      reasons: ["empty_text"]
    };
  }

  if (normalizedSource === "task_completion_summary"
      || (normalizedType === "episodic_task" && TASK_SUMMARY_SHAPE_RE.test(normalizedText))) {
    reasons.push("routine_task_summary");
    if (VOLATILE_TASK_SUMMARY_RE.test(normalizedText)) reasons.push("volatile_result");
    if (LOW_QUALITY_TASK_SUMMARY_RE.test(normalizedText)) reasons.push("low_quality_or_tool_log");
    return {
      lane: "activity_history",
      score: 0.2,
      reasons,
      status
    };
  }

  if ([
    "user_preference",
    "project_fact",
    "project_decision",
    "workflow_rule",
    "user_correction",
    "rejected_assumption"
  ].includes(normalizedType)) {
    return {
      lane: "review_inbox",
      score: 0.82,
      reasons: ["durable_memory_type"],
      status
    };
  }

  return {
    lane: "review_inbox",
    score: 0.55,
    reasons: ["needs_review"],
    status
  };
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
    const source = normalizeText(raw?.source, 80) || "candidate_detection";
    const quality = normalizeQuality(raw?.quality, classifyMemoryCandidate({ type, text, source, status }));
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
      source,
      provenance: normalizeProvenance(raw?.provenance),
      quality,
      createdAt: normalizeText(raw?.createdAt ?? raw?.created_at, 40) || now,
      updatedAt: normalizeText(raw?.updatedAt ?? raw?.updated_at, 40) || now,
      reviewedAt: normalizeText(raw?.reviewedAt ?? raw?.reviewed_at, 40) || null
    });
    if (out.length >= MAX_PROPOSALS) break;
  }
  return out;
}

function normalizeActivityHistoryItems(items = [], { now = nowIso() } = {}) {
  const list = Array.isArray(items) ? items : [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const text = normalizeText(raw?.text, MAX_ACTIVITY_TEXT_CHARS);
    if (!text) continue;
    const kind = ACTIVITY_KINDS.has(raw?.kind) ? raw.kind : "task_summary";
    const scope = normalizeScope(raw?.scope, raw?.projectId || raw?.project_id ? "project" : "conversation");
    const projectId = normalizeText(raw?.projectId ?? raw?.project_id, 120) || null;
    const conversationId = normalizeText(raw?.conversationId ?? raw?.conversation_id, 120) || null;
    const artifactId = normalizeText(raw?.artifactId ?? raw?.artifact_id, 120) || null;
    const provenance = normalizeProvenance(raw?.provenance);
    const source = normalizeText(raw?.source, 80) || "task_completion_summary";
    const quality = normalizeQuality(raw?.quality, classifyMemoryCandidate({
      type: "episodic_task",
      text,
      source,
      status: "activity"
    }));
    const taskId = normalizeText(provenance.task_id ?? raw?.taskId ?? raw?.task_id, 120) || null;
    const activityId = normalizeId(
      raw?.activityId ?? raw?.activity_id ?? raw?.id,
      `activity_${kind}_${taskId ?? projectId ?? conversationId ?? artifactId ?? text.slice(0, 32)}`
    );
    const dedupeKey = [
      kind,
      taskId ?? "",
      scope,
      projectId ?? "",
      conversationId ?? "",
      artifactId ?? "",
      text.toLowerCase()
    ].join(":");
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({
      activityId,
      kind,
      text,
      scope,
      ...(projectId ? { projectId } : {}),
      ...(conversationId ? { conversationId } : {}),
      ...(artifactId ? { artifactId } : {}),
      source,
      provenance: {
        ...provenance,
        ...(taskId ? { task_id: taskId } : {})
      },
      quality,
      createdAt: normalizeText(raw?.createdAt ?? raw?.created_at, 40) || now,
      updatedAt: normalizeText(raw?.updatedAt ?? raw?.updated_at, 40) || now
    });
    if (out.length >= MAX_ACTIVITY_HISTORY) break;
  }
  return out;
}

function proposalToActivityHistoryItem(proposal = {}, { now = nowIso() } = {}) {
  return normalizeActivityHistoryItems([{
    activityId: `activity_${proposal.proposalId ?? normalizeId(proposal.text, "proposal")}`,
    kind: "task_summary",
    text: proposal.text,
    scope: proposal.scope,
    projectId: proposal.projectId,
    conversationId: proposal.conversationId,
    artifactId: proposal.artifactId,
    source: proposal.source,
    provenance: {
      ...(proposal.provenance ?? {}),
      proposal_id: proposal.proposalId ?? null
    },
    quality: proposal.quality,
    createdAt: proposal.createdAt,
    updatedAt: now
  }], { now })[0] ?? null;
}

function mergeActivityHistoryItems(items = [], { now = nowIso() } = {}) {
  return normalizeActivityHistoryItems(items, { now }).slice(0, MAX_ACTIVITY_HISTORY);
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
  const normalizedProposals = normalizeMemoryProposals(profile.proposals ?? profile.memoryProposals ?? profile.memory_proposals ?? [], { now });
  const proposals = [];
  const migratedActivity = [];
  for (const proposal of normalizedProposals) {
    if (proposal.status === "pending" && proposal.quality?.lane === "activity_history") {
      const activity = proposalToActivityHistoryItem(proposal, { now });
      if (activity) migratedActivity.push(activity);
      continue;
    }
    proposals.push(proposal);
  }
  const activityHistory = mergeActivityHistoryItems([
    ...migratedActivity,
    ...(Array.isArray(profile.activityHistory)
      ? profile.activityHistory
      : (Array.isArray(profile.activity_history) ? profile.activity_history : []))
  ], { now });
  return {
    schemaVersion: USER_MEMORY_PROFILE_VERSION,
    enabled: profile.enabled !== false,
    autoApproveGenerated: normalizeGeneratedTaskMemoryMode(profile) === "auto_approve",
    generatedTaskMemoryMode: normalizeGeneratedTaskMemoryMode(profile),
    updatedAt: now,
    preferences: normalizeMemoryItems(profile.preferences ?? [], { defaultScope: "global" }),
    projectMemories: normalizeMemoryItems(profile.projectMemories ?? profile.project_memories ?? [], {
      defaultScope: "project"
    }),
    approvedMemories: normalizeGovernedMemoryItems(profile.approvedMemories ?? profile.approved_memories ?? [], { now }),
    proposals,
    activityHistory,
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
  const activityHistory = sanitized.activityHistory
    .filter((item) => matchesGovernanceFilter(item, filters, sanitized));
  const reviewHistory = sanitized.reviewHistory
    .filter((item) => matchesGovernanceFilter(item, filters, sanitized));
  return {
    ...sanitized,
    approvedMemories,
    proposals,
    activityHistory,
    reviewHistory,
    totals: {
      approvedMemories: sanitized.approvedMemories.length,
      proposals: sanitized.proposals.length,
      activityHistory: sanitized.activityHistory.length,
      reviewHistory: sanitized.reviewHistory.length
    }
  };
}

function renderGovernedMemoryList(items = []) {
  return items.map((item) => `- [${item.type}] ${item.text}`).join("\n");
}

export function buildUserMemoryBackgroundEntries(profile = {}, {
  projectId = null,
  conversationId = null,
  artifactId = null
} = {}) {
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

  const governed = relevantGovernedMemories(sanitized.approvedMemories, { projectId, conversationId, artifactId });
  const globalGoverned = governed.filter((item) => !["project", "conversation"].includes(item.scope));
  const conversationGoverned = governed.filter((item) => item.scope === "conversation");
  const normalizedProjectId = normalizeText(projectId, 120);
  const normalizedConversationId = normalizeText(conversationId, 120);
  const projectItems = sanitized.projectMemories
    .filter((item) => Boolean(normalizedProjectId) && item.projectId === normalizedProjectId);
  const projectGoverned = governed.filter((item) => item.scope === "project");
  // Specific scope should precede broad reviewed memory so conversation and
  // project facts win when a task explicitly carries those identifiers.
  if (conversationGoverned.length > 0) {
    entries.push({
      kind: "conversation_memory",
      priority: "background",
      origin: "pre_task_seed",
      content: [
        `Conversation memory${normalizedConversationId ? ` for conversation_id=${normalizedConversationId}` : ""}. Treat as scoped background, not a replacement for current instructions or fresh evidence.`,
        renderGovernedMemoryList(conversationGoverned)
      ].join("\n"),
      metadata: {
        conversation_id: normalizedConversationId || null,
        memory_governance: true,
        user_memory_ids: conversationGoverned.map((item) => item.id),
        memory_types: [...new Set(conversationGoverned.map((item) => item.type))]
      }
    });
  }

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

function boundedTurnSummary({ command = "", finalText = "" } = {}) {
  const user = normalizeText(command, 260);
  const outcome = normalizeText(finalText, 260);
  if (!user || !outcome) return "";
  return normalizeText(`User asked: ${user}\nAssistant outcome: ${outcome}`, MAX_TEXT_CHARS);
}

function taskScopeIdentity(task = {}) {
  const projectId = normalizeText(
    task?.project_id
      ?? task?.projectId
      ?? task?.context_packet?.selection_metadata?.project_id
      ?? task?.context_packet?.selectionMetadata?.project_id,
    120
  ) || null;
  const conversationId = normalizeText(
    task?.conversation_id
      ?? task?.conversationId
      ?? task?.context_packet?.selection_metadata?.conversation_id
      ?? task?.context_packet?.selectionMetadata?.conversation_id,
    120
  ) || null;
  const artifactId = normalizeText(
    task?.artifact_id
      ?? task?.artifactId
      ?? task?.context_packet?.selection_metadata?.artifact_id
      ?? task?.context_packet?.selectionMetadata?.artifact_id,
    120
  ) || null;
  return { projectId, conversationId, artifactId };
}

function activityHistoryForTaskOutcome({ task = {}, finalText = "", now = nowIso() } = {}) {
  const taskId = normalizeText(task?.task_id ?? task?.taskId, 120);
  if (!taskId) return null;
  const text = boundedTurnSummary({
    command: task?.user_command ?? task?.userCommand,
    finalText
  });
  if (!text) return null;
  const { projectId, conversationId, artifactId } = taskScopeIdentity(task);
  const scope = projectId ? "project" : (conversationId ? "conversation" : (artifactId ? "artifact" : "global"));
  return normalizeActivityHistoryItems([{
    activityId: `activity_task_summary_${taskId}`,
    kind: "task_summary",
    text,
    scope,
    projectId,
    conversationId,
    artifactId,
    source: "task_completion_summary",
    provenance: {
      task_id: taskId,
      conversation_id: conversationId,
      project_id: projectId,
      artifact_id: artifactId,
      executor: normalizeText(task?.executor, 80) || null,
      status: normalizeText(task?.status, 80) || null
    },
    createdAt: now,
    updatedAt: now
  }], { now })[0] ?? null;
}

function extractTaskMemoryCandidate(task = {}) {
  const candidates = [
    task?.memory_candidate,
    task?.memoryCandidate,
    task?.result?.memory_candidate,
    task?.result?.memoryCandidate,
    task?.outcome?.memory_candidate,
    task?.outcome?.memoryCandidate
  ];
  const raw = candidates.find((item) => item && typeof item === "object" && !Array.isArray(item));
  if (!raw) return null;
  const text = normalizeText(raw.text ?? raw.content ?? raw.memory);
  if (!text) return null;
  return {
    type: normalizeMemoryType(raw.type, "user_correction"),
    text,
    scope: normalizeScope(raw.scope, "global"),
    projectId: normalizeText(raw.projectId ?? raw.project_id, 120) || null,
    conversationId: normalizeText(raw.conversationId ?? raw.conversation_id, 120) || null,
    artifactId: normalizeText(raw.artifactId ?? raw.artifact_id, 120) || null,
    source: normalizeText(raw.source, 80) || "task_memory_candidate",
    provenance: normalizeProvenance(raw.provenance)
  };
}

export function proposeTaskCompletionMemory(profile = {}, {
  task = {},
  finalText = "",
  now = nowIso()
} = {}) {
  const sanitized = sanitizeUserMemoryProfile(profile, { now: profile.updatedAt ?? now });
  if (!sanitized.enabled) return sanitized;
  const taskId = normalizeText(task?.task_id ?? task?.taskId, 120);
  if (!taskId) return sanitized;
  const activity = activityHistoryForTaskOutcome({ task, finalText, now });
  const withActivity = activity && !(sanitized.activityHistory ?? []).some((item) => item?.provenance?.task_id === taskId)
    ? sanitizeUserMemoryProfile({
      ...sanitized,
      updatedAt: now,
      activityHistory: [activity, ...sanitized.activityHistory]
    }, { now })
    : sanitized;
  if (withActivity.generatedTaskMemoryMode === "off") return withActivity;

  const { projectId, conversationId, artifactId } = taskScopeIdentity(task);
  const candidate = extractTaskMemoryCandidate(task);
  if (!candidate) return withActivity;
  const candidateScope = candidate.scope !== "global"
    ? candidate.scope
    : (candidate.projectId || projectId
      ? "project"
      : (candidate.conversationId || conversationId
        ? "conversation"
        : (candidate.artifactId || artifactId ? "artifact" : "global")));
  const candidateProjectId = candidate.projectId ?? projectId;
  const candidateConversationId = candidate.conversationId ?? conversationId;
  const candidateArtifactId = candidate.artifactId ?? artifactId;
  const quality = classifyMemoryCandidate({
    type: candidate.type,
    text: candidate.text,
    source: candidate.source,
    status: "pending"
  });
  if (quality.lane !== "review_inbox") return withActivity;
  const alreadyKnown = [
    ...(withActivity.proposals ?? []),
    ...(withActivity.approvedMemories ?? [])
  ].some((item) => item?.provenance?.task_id === taskId && item?.text === candidate.text);
  if (alreadyKnown) return withActivity;

  const proposal = createMemoryProposal({
    type: candidate.type,
    text: candidate.text,
    scope: candidateScope,
    projectId: candidateProjectId,
    conversationId: candidateConversationId,
    artifactId: candidateArtifactId,
    source: candidate.source,
    provenance: {
      ...(candidate.provenance ?? {}),
      task_id: taskId,
      conversation_id: candidateConversationId,
      project_id: candidateProjectId,
      artifact_id: candidateArtifactId,
      executor: normalizeText(task?.executor, 80) || null,
      status: normalizeText(task?.status, 80) || null
    },
    now
  });
  const withProposal = sanitizeUserMemoryProfile({
    ...withActivity,
    updatedAt: now,
    proposals: [proposal, ...withActivity.proposals]
  }, { now });
  if (withProposal.generatedTaskMemoryMode === "auto_approve") {
    return approveMemoryProposal(withProposal, proposal.proposalId, {
      actor: "user_opt_in_auto_memory"
    }, { now });
  }
  return withProposal;
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

export function applyUserMemoryProfileToContext(contextPacket = {}, profile = {}, {
  projectId = null,
  conversationId = null,
  artifactId = null
} = {}) {
  let next = contextPacket;
  const entries = buildUserMemoryBackgroundEntries(profile, { projectId, conversationId, artifactId });
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
