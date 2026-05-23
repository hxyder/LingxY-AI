import crypto from "node:crypto";

export const SESSION_COMPACTION_SCHEMA_VERSION = "1.0";
export const SESSION_COMPACTION_SOURCE = "session_compaction_service";

const DEFAULT_COMPACTION_OPTIONS = Object.freeze({
  minItems: 24,
  itemLimit: 2000,
  maxSummaryChars: 6000,
  maxLines: 18,
  maxFacts: 24,
  maxOpenThreads: 12
});

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function nowIso() {
  return new Date().toISOString();
}

function requireStoreMethod(store, method) {
  if (typeof store?.[method] !== "function") {
    throw new Error(`SessionCompactionService requires store.${method}`);
  }
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function truncate(value, maxChars) {
  const text = cleanText(value);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars))}...[truncated ${text.length} chars]`;
}

function uniq(values, limit) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const text = cleanText(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function lineForItem(item) {
  const order = Number.isInteger(item?.order_index) ? `#${item.order_index}` : "#?";
  const task = item?.task_id ? ` task=${item.task_id}` : "";
  const artifact = item?.artifact_id ? ` artifact=${item.artifact_id}` : "";
  const tool = item?.payload?.tool_id ? ` tool=${item.payload.tool_id}` : "";
  const kind = item?.kind ?? "runtime_note";
  const content = truncate(item?.content_text ?? item?.payload?.observation ?? item?.payload?.event_type ?? "", 260);
  return `${order} ${kind}${task}${artifact}${tool}${content ? `: ${content}` : ""}`;
}

function extractFacts(items, options) {
  const facts = [];
  for (const item of items) {
    if (item?.task_id) facts.push(`task:${item.task_id}`);
    if (item?.artifact_id) facts.push(`artifact:${item.artifact_id}`);
    if (item?.payload?.tool_id) facts.push(`tool:${item.payload.tool_id}`);
    if (item?.payload?.success === true) facts.push(`success:${item.payload.tool_id ?? item.kind ?? "tool"}`);
    if (item?.payload?.success === false) facts.push(`failure:${item.payload.tool_id ?? item.kind ?? "tool"}`);
  }
  return uniq(facts, options.maxFacts);
}

function extractOpenThreads(items, options) {
  const threads = [];
  for (const item of [...items].reverse()) {
    if (item?.kind === "task_anchor" && item?.task_id) {
      threads.push(`active task anchor ${item.task_id}`);
    }
    if (item?.kind === "artifact_reference" && item?.artifact_id) {
      threads.push(`artifact follow-up target ${item.artifact_id}`);
    }
    if (item?.kind === "tool_observation" && item?.payload?.success === false) {
      threads.push(`failed tool observation ${item.payload.tool_id ?? item.item_id ?? "unknown"}`);
    }
  }
  return uniq(threads, options.maxOpenThreads);
}

export function buildDeterministicSessionCompaction(items = [], options = {}) {
  const resolved = {
    ...DEFAULT_COMPACTION_OPTIONS,
    ...options
  };
  const boundedItems = Array.isArray(items) ? items : [];
  const first = boundedItems[0] ?? null;
  const last = boundedItems[boundedItems.length - 1] ?? null;
  const sourceStartOrder = Number.isInteger(first?.order_index) ? first.order_index : 0;
  const sourceEndOrder = Number.isInteger(last?.order_index) ? last.order_index : sourceStartOrder;
  const taskIds = uniq(boundedItems.map((item) => item?.task_id), 80);
  const artifactIds = uniq(boundedItems.map((item) => item?.artifact_id), 80);
  const facts = extractFacts(boundedItems, resolved);
  const openThreads = extractOpenThreads(boundedItems, resolved);
  const lines = boundedItems.slice(-resolved.maxLines).map(lineForItem);
  const header = [
    `Session compaction ${sourceStartOrder}-${sourceEndOrder}`,
    `Items: ${boundedItems.length}`,
    taskIds.length ? `Tasks: ${taskIds.join(", ")}` : "",
    artifactIds.length ? `Artifacts: ${artifactIds.join(", ")}` : ""
  ].filter(Boolean);
  const summaryText = truncate([...header, ...lines].join("\n"), resolved.maxSummaryChars);
  return {
    sourceStartOrder,
    sourceEndOrder,
    sourceItemCount: boundedItems.length,
    summaryText,
    facts,
    openThreads,
    artifactIds,
    taskIds
  };
}

export function createSessionCompactionService({ store, metrics = null } = {}) {
  for (const method of [
    "getConversationSession",
    "listSessionItems",
    "appendSessionCompaction",
    "listSessionCompactions",
    "getLatestSessionCompaction"
  ]) {
    requireStoreMethod(store, method);
  }

  function latestForSession(sessionId) {
    return store.getLatestSessionCompaction(sessionId);
  }

  function listForSession(sessionId, options = {}) {
    return store.listSessionCompactions(sessionId, options);
  }

  function compactSession({
    sessionId,
    throughOrder = null,
    minItems = DEFAULT_COMPACTION_OPTIONS.minItems,
    itemLimit = DEFAULT_COMPACTION_OPTIONS.itemLimit,
    maxSummaryChars = DEFAULT_COMPACTION_OPTIONS.maxSummaryChars,
    maxLines = DEFAULT_COMPACTION_OPTIONS.maxLines,
    metadata = {}
  } = {}) {
    if (!sessionId) throw new Error("compactSession: sessionId required");
    const session = store.getConversationSession(sessionId);
    if (!session) throw new Error(`compactSession: session ${sessionId} not found`);
    const previous = latestForSession(sessionId);
    const sinceOrder = Number.isInteger(previous?.source_end_order)
      ? previous.source_end_order + 1
      : 0;
    const items = store.listSessionItems(sessionId, {
      sinceOrder,
      limit: itemLimit
    }).filter((item) => !Number.isInteger(throughOrder) || item.order_index <= throughOrder);

    if (items.length < minItems) {
      metrics?.incrementRuntimeCounter?.("session_compaction.skipped", 1, {
        source: "session_compaction",
        reason: "not_enough_items"
      });
      return {
        compacted: false,
        reason: "not_enough_items",
        session_id: sessionId,
        item_count: items.length,
        since_order: sinceOrder
      };
    }

    const built = buildDeterministicSessionCompaction(items, {
      maxSummaryChars,
      maxLines
    });
    const record = store.appendSessionCompaction({
      compaction_id: newId("scomp"),
      session_id: sessionId,
      conversation_id: session.conversation_id ?? null,
      project_id: session.project_id ?? null,
      source_start_order: built.sourceStartOrder,
      source_end_order: built.sourceEndOrder,
      source_item_count: built.sourceItemCount,
      summary_text: built.summaryText,
      facts: built.facts,
      open_threads: built.openThreads,
      artifact_ids: built.artifactIds,
      task_ids: built.taskIds,
      metadata: {
        schema_version: SESSION_COMPACTION_SCHEMA_VERSION,
        source: SESSION_COMPACTION_SOURCE,
        ...(metadata ?? {})
      },
      created_at: nowIso()
    });
    metrics?.incrementRuntimeCounter?.("session_compaction.created", 1, {
      source: "session_compaction"
    });
    return {
      compacted: true,
      compaction: record
    };
  }

  return {
    compactSession,
    latestForSession,
    listForSession
  };
}
