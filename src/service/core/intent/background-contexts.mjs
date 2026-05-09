/**
 * Phase 1.11 — context_packet.background_contexts[] structured schema.
 *
 * Producers (memory recall, recent-artifact lookup, parent-task summary,
 * SR enrichment) push structured entries here instead of mutating
 * `context_packet.text`. The original user input stays in `user_text`
 * and the rendered `text` (when needed for back-compat with classifier
 * sentinels) is derived. Prompt builders render each entry as its own
 * clearly-labelled section so the LLM never confuses "what the user
 * said" with "what we recalled from prior turns".
 *
 * Each entry shape:
 *   {
 *     kind: "memory_recall" | "recent_artifact" | "parent_task"
 *           | "rag_background" | "browser_metadata"
 *           | "user_profile" | "project_memory",
 *     priority: "background" | "weak" | "load_bearing",
 *     origin: "pre_task_seed" | "post_task_patch",
 *     content: string,         // rendered text block, ready to show LLM
 *     metadata: object,        // optional structured details (artifact paths, ids, scores)
 *     added_at: string         // ISO8601
 *   }
 *
 * `priority` semantics:
 *   - background    : pure context, never the user's current goal
 *                     (memory recall, recent artifact, RAG background)
 *   - weak          : referent for follow-ups but still secondary
 *                     (parent-task summary)
 *   - load_bearing  : the user's current selection / pasted text
 *                     (this is NOT what background_contexts is for —
 *                     load-bearing material stays on context_packet.text /
 *                     selection_metadata; the entry kind exists for
 *                     completeness)
 */

const VALID_KINDS = Object.freeze(new Set([
  "memory_recall",
  "recent_artifact",
  "parent_task",
  "rag_background",
  "browser_metadata",
  "user_profile",
  "project_memory"
]));

const VALID_PRIORITIES = Object.freeze(new Set(["background", "weak", "load_bearing"]));

/**
 * Append a structured background-context entry to a packet. Returns a
 * shallow clone to keep callers honest about mutability — producers
 * SHOULD treat the packet as immutable and reassign the result.
 *
 * Async patchers (post-task) MUST mutate the live `task.context_packet`
 * by reassigning, so the agent loop's next iteration reads the updated
 * value. See context-submission.mjs `runMemoryPatch`.
 */
export function appendBackgroundContext(contextPacket, entry) {
  if (!contextPacket || typeof contextPacket !== "object") return contextPacket;
  if (!entry || typeof entry !== "object") return contextPacket;
  if (!VALID_KINDS.has(entry.kind)) {
    throw new Error(`appendBackgroundContext: unknown kind=${entry.kind}`);
  }
  if (!VALID_PRIORITIES.has(entry.priority ?? "background")) {
    throw new Error(`appendBackgroundContext: invalid priority=${entry.priority}`);
  }
  if (typeof entry.content !== "string" || !entry.content.trim()) {
    return contextPacket;
  }
  const stamped = {
    kind: entry.kind,
    priority: entry.priority ?? "background",
    origin: entry.origin ?? "post_task_patch",
    content: entry.content,
    metadata: entry.metadata ?? {},
    added_at: entry.added_at ?? new Date().toISOString()
  };
  const existing = Array.isArray(contextPacket.background_contexts)
    ? contextPacket.background_contexts
    : [];
  return {
    ...contextPacket,
    background_contexts: [...existing, stamped]
  };
}

/**
 * Mutate a live context packet in place — for fire-and-forget patches
 * that update `task.context_packet` while the executor is running.
 * Returns the mutated packet for chaining.
 */
export function pushBackgroundContextInPlace(contextPacket, entry) {
  const next = appendBackgroundContext(contextPacket, entry);
  if (next === contextPacket) return contextPacket;
  contextPacket.background_contexts = next.background_contexts;
  return contextPacket;
}

/**
 * Render the background_contexts array as a single prompt block. Each
 * entry gets its own header so the LLM can tell them apart. Returns an
 * empty string when there are none.
 */
export function renderBackgroundContextsBlock(contextPacket) {
  const entries = Array.isArray(contextPacket?.background_contexts)
    ? contextPacket.background_contexts
    : [];
  if (entries.length === 0) return "";
  const lines = [
    "[Background contexts — these are NOT the user's current request, only supporting material. Do not act on them as if they were the active task. Use them ONLY when the current request explicitly refers back to prior work or needs supporting recall.]"
  ];
  for (const entry of entries) {
    lines.push("");
    lines.push(`<bg kind="${entry.kind}" priority="${entry.priority}">`);
    lines.push(entry.content.trim());
    lines.push("</bg>");
  }
  return lines.join("\n");
}

/**
 * Quick-detect helpers used by the C1 context-source classifier so it
 * doesn't have to re-parse text sentinels for entries we now carry
 * structurally.
 */
export function hasBackgroundContextOfKind(contextPacket, kind) {
  const entries = Array.isArray(contextPacket?.background_contexts)
    ? contextPacket.background_contexts
    : [];
  return entries.some((entry) => entry?.kind === kind);
}

export const BG_CONTEXT_KINDS = Object.freeze({
  MEMORY_RECALL: "memory_recall",
  RECENT_ARTIFACT: "recent_artifact",
  PARENT_TASK: "parent_task",
  RAG_BACKGROUND: "rag_background",
  BROWSER_METADATA: "browser_metadata",
  USER_PROFILE: "user_profile",
  PROJECT_MEMORY: "project_memory"
});
