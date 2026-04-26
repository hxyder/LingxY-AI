/**
 * UCA-077 P4-02.x C1 (plan §p4-03-p4-02-goofy-forest): context-source
 * classifier.
 *
 * Layer 1 of the routing pipeline. Classifies WHAT KIND of content lives
 * in `contextPacket.text`. No decisions; only labels. Downstream layers
 * (signal extraction, policy resolver, semantic router) consume these
 * labels to make correct routing choices.
 *
 * The bug this fixes: `context_packet.text` is a single field that may
 * carry many orthogonal kinds of content — a real user selection, a
 * web-page extract, file content the user pasted, conversation history
 * injected by the runtime, RAG memory recalls, parent-task summaries,
 * editable-artifact snapshots, or any combination of those concatenated
 * with `\n\n---\n\n` delimiters. Pre-fix, source-scope.mjs treated any
 * non-empty distinct text as "selection" and forbid web search, which
 * collapsed to a chain that broke "今天天气怎么样" when RAG happened to
 * recall an unrelated email task.
 *
 * Two-stage classifier:
 *
 *   1. AUTHORITATIVE METADATA FLAGS — set by the producers themselves.
 *      `selection_metadata.conversation_history_injected` (set by
 *      `seedStructuredConversationHistory` at conversation-memory.mjs:166),
 *      `selection_metadata.semantic_recall_ids?.length > 0` (set by
 *      `seedSemanticMemories` at context-submission.mjs:202 and
 *      conversation-memory.mjs:232), `selection_metadata.parent_task_id`
 *      (set by `seedParentTaskContext` at conversation-memory.mjs:124),
 *      `selection_metadata.editable_target_path` (set by
 *      `maybeSeedRecentArtifactContext` at context-submission.mjs:295),
 *      and `selection_metadata.memory_background_injected` (the new C2
 *      RAG flag). When present, these are ground truth.
 *
 *   2. SENTINEL SCAN — fallback for text that arrived from another path
 *      (e.g. an extension that hand-rolled a digest, or a tracking-only
 *      check on text whose producer didn't set a flag). Splits the text
 *      on the canonical `\n\n---\n\n` delimiter and classifies each
 *      block by its first-line header.
 *
 * Default for "text non-empty + no sentinels + ≠ command" is
 * `real_selection: true`. This preserves existing fixtures
 * (`tests/routing/web-search-policy-cases.jsonl` case 10) and matches
 * the historical assumption that text in contextPacket without producer
 * markers came from the user.
 *
 * Trust note: this module READS metadata + text but never mutates either.
 * It returns a fresh object that the orchestrator stamps onto a cloned
 * contextPacket so downstream signal extraction is purely additive.
 */

/**
 * @typedef {Object} ContextSources
 * @property {boolean} real_selection
 * @property {boolean} browser_page
 * @property {boolean} file_text
 * @property {boolean} conversation_history
 * @property {boolean} rag_background
 * @property {boolean} parent_task_context
 * @property {boolean} editable_artifact
 * @property {boolean} uploaded_files
 * @property {boolean} uploaded_images
 */

/**
 * The exact sentinel header strings producers emit. Confirmed via Phase 1
 * exploration (see plan §C1). Order matters only for traceability — the
 * scan checks each block's first line against the full set.
 *
 * Each entry: { sentinel: literal start-of-block string, source: which
 * ContextSources flag to set when matched }.
 *
 * Includes:
 *   - the legacy RAG sentinel `[跨对话相关任务（语义召回 · 可作为背景）]`
 *     (still emitted by older code paths until C2 renames it)
 *   - the legacy duplicate `[跨任务语义记忆（RAG）]` from the dead
 *     conversation-memory.mjs duplicate (kept for safety)
 *   - the new C2 sentinel `[memory_background ·` (prefix match — the
 *     full sentinel grows with descriptive suffix that may evolve)
 */
const SENTINEL_RULES = Object.freeze([
  { match: "[当前对话上下文]",                          source: "conversation_history" },
  { match: "[跨任务语义记忆（RAG）]",                    source: "rag_background" },
  { match: "[跨对话相关任务（语义召回 · 可作为背景）]",      source: "rag_background" },
  // C2 prefix match — the descriptive tail "· 仅作背景，请勿当作当前任务上下文"
  // is informative for the LLM and not part of the canonical match.
  { startsWith: "[memory_background ·",                source: "rag_background" },
  { startsWith: "[上一轮任务摘要 · parent=",             source: "parent_task_context" },
  { match: "[Editable target artifact]",               source: "editable_artifact" },
  // legacy regex fallback from conversation-memory.mjs:136
  { regex: /^对话历史[:：]/m,                          source: "conversation_history" }
]);

const BLOCK_DELIMITER = "\n\n---\n\n";

function makeEmptySources() {
  return {
    real_selection: false,
    browser_page: false,
    file_text: false,
    conversation_history: false,
    rag_background: false,
    parent_task_context: false,
    editable_artifact: false,
    uploaded_files: false,
    uploaded_images: false
  };
}

/**
 * Classify the context packet's text + metadata into a ContextSources
 * record. Pure: input is not mutated.
 *
 * @param {{ text?: string, contextPacket?: object }} input
 * @returns {ContextSources}
 */
export function classifyContextSources({ text, contextPacket = {} } = {}) {
  const sources = makeEmptySources();
  const ctx = contextPacket ?? {};
  const meta = ctx.selection_metadata ?? {};
  const userCommand = String(text ?? "").trim();
  const ctxText = typeof ctx.text === "string" ? ctx.text : "";
  const trimmedCtxText = ctxText.trim();

  // Stage 0: structural attachments — observable state, no interpretation.
  if (Array.isArray(ctx.file_paths) && ctx.file_paths.length > 0) {
    sources.uploaded_files = true;
  }
  if (Array.isArray(ctx.image_paths) && ctx.image_paths.length > 0) {
    sources.uploaded_images = true;
  }
  if (typeof ctx.url === "string" && ctx.url.trim().length > 0) {
    sources.browser_page = true;
  }

  // Stage 1: authoritative producer flags. These are set by the same
  // module that wrote the sentinel into ctx.text, so they're ground
  // truth. We set the corresponding ContextSources flag without
  // touching ctx.text.
  if (meta.conversation_history_injected === true) {
    sources.conversation_history = true;
  }
  if (Array.isArray(meta.semantic_recall_ids) && meta.semantic_recall_ids.length > 0) {
    sources.rag_background = true;
  }
  if (meta.memory_background_injected === true) {
    sources.rag_background = true;
  }
  if (typeof meta.parent_task_id === "string" && meta.parent_task_id.length > 0) {
    sources.parent_task_context = true;
  }
  if (typeof meta.editable_target_path === "string" && meta.editable_target_path.length > 0) {
    sources.editable_artifact = true;
  }

  // Stage 2: sentinel scan over ctx.text — handles cases where text
  // arrived without a producer flag (older paths, hand-rolled digests,
  // future producers that haven't been wired to set flags).
  if (trimmedCtxText.length > 0) {
    const blocks = ctxText.split(BLOCK_DELIMITER);
    let nonSentinelBlockSeen = false;
    for (const block of blocks) {
      const trimmed = block.trim();
      if (!trimmed) continue;
      const firstLine = trimmed.split(/\r?\n/, 1)[0];
      let matched = false;
      for (const rule of SENTINEL_RULES) {
        if (rule.match && firstLine === rule.match) {
          sources[rule.source] = true;
          matched = true;
          break;
        }
        if (rule.startsWith && firstLine.startsWith(rule.startsWith)) {
          sources[rule.source] = true;
          matched = true;
          break;
        }
        if (rule.regex && rule.regex.test(firstLine)) {
          sources[rule.source] = true;
          matched = true;
          break;
        }
      }
      if (!matched) {
        nonSentinelBlockSeen = true;
      }
    }

    // Stage 3: real_selection default. If the text contains content not
    // covered by any sentinel AND that content is meaningfully distinct
    // from the user's command, treat it as a real selection. This keeps
    // existing fixtures green ("分析下面代码" with selected text).
    //
    // The "command echo" guard mirrors source-scope.mjs:90 — when the
    // capture path duplicates the user command into ctx.text by default,
    // we don't want to classify that as a real selection.
    const isJustCommandEcho = userCommand.length > 0 && trimmedCtxText === userCommand;
    if (nonSentinelBlockSeen && !isJustCommandEcho) {
      sources.real_selection = true;
    }
    // Special case: when there are NO sentinels and NO blocks (single
    // block of plain text), the loop above sets nonSentinelBlockSeen
    // for the only block. Already handled.
  }

  return sources;
}

/**
 * @returns {readonly string[]}  the ContextSources field names, frozen.
 */
export const CONTEXT_SOURCE_KEYS = Object.freeze([
  "real_selection", "browser_page", "file_text",
  "conversation_history", "rag_background", "parent_task_context",
  "editable_artifact", "uploaded_files", "uploaded_images"
]);

/**
 * The set of ContextSources that count as "local-only anchors" — content
 * the user wants the assistant to read and analyse rather than research
 * externally. Used by source-scope.mjs (C3) to gate the LOCAL_SCOPES
 * forbid path. NOT a list of "this means forbid web search" — Layer 4
 * (resolver) makes that decision based on these labels.
 */
export const LOCAL_ANCHOR_KEYS = Object.freeze([
  "real_selection", "browser_page", "file_text"
]);

/**
 * Convenience: does the classifier output indicate any local anchor?
 * @param {ContextSources} sources
 * @returns {boolean}
 */
export function hasLocalAnchor(sources) {
  if (!sources || typeof sources !== "object") return false;
  return LOCAL_ANCHOR_KEYS.some((key) => sources[key] === true);
}
