/**
 * UCA-077 P4-03 (§19 #3): conversation-memory module retains only the
 * `normalizeConversationTurns` helper used by the browser-submission
 * boundary (browser-submission.mjs:12).
 *
 * Earlier versions of this file also exported parent-task / RAG /
 * conversation-history seeders, but the live submission flow uses the
 * canonical implementations in context-submission.mjs (lines 161-258).
 * Those duplicates were dead code — confirmed by grep across src/ and
 * scripts/ — and have been removed.
 *
 * Browser-capture independence is locked down by
 * scripts/verify-browser-capture-resilience.mjs: that verifier asserts
 * browser-submission imports ONLY `normalizeConversationTurns` from
 * this module (no `seedSemanticMemories` etc.). RAG / parent-task
 * seeding stays an OPTIONAL enhancement on the context-submission path.
 */

const DEFAULT_HISTORY_MAX_TURNS = 20;
const DEFAULT_HISTORY_TURN_CHAR_CAP = 1200;

function trimText(value = "", maxChars = DEFAULT_HISTORY_TURN_CHAR_CAP) {
  const text = String(value ?? "").replace(/\s+\n/g, "\n").trim();
  if (!text) return "";
  return text.length > maxChars ? `${text.slice(0, Math.max(0, maxChars - 1))}…` : text;
}

/**
 * Normalize an array of conversation turns to the role-content shape
 * the rest of the runtime expects. Filters out non-{user,assistant,system}
 * roles, trims overlong content, and caps the count.
 *
 * @param {Array} turns
 * @param {{ maxTurns?: number, maxCharsPerTurn?: number }} [options]
 * @returns {Array<{ role: string, content: string }>}
 */
export function normalizeConversationTurns(turns = [], options = {}) {
  const maxTurns = Math.max(1, Math.min(50, Number(options.maxTurns ?? DEFAULT_HISTORY_MAX_TURNS) || DEFAULT_HISTORY_MAX_TURNS));
  const maxCharsPerTurn = Math.max(80, Math.min(4000, Number(options.maxCharsPerTurn ?? DEFAULT_HISTORY_TURN_CHAR_CAP) || DEFAULT_HISTORY_TURN_CHAR_CAP));
  if (!Array.isArray(turns)) return [];
  return turns
    .filter((turn) => turn?.role === "user" || turn?.role === "assistant" || turn?.role === "system")
    .map((turn) => ({
      role: turn.role,
      content: trimText(turn.content, maxCharsPerTurn)
    }))
    .filter((turn) => turn.content)
    .slice(-maxTurns);
}
