/**
 * UCA-077 P1-01: Signal layer protocol.
 *
 * A Signal is the output of one atomic detector. Signals carry evidence,
 * never decisions. Routing decisions live in policy/ and planning/.
 *
 * Strength is binary: "strong" signals are safe to short-circuit on; "weak"
 * signals can only suggest "optional" — they must never force "required".
 */

/**
 * @typedef {Object} Evidence
 * @property {string} type            - "regex" | "context" | "default" | "explicit_phrase" | "entity"
 * @property {string} source          - signal name
 * @property {string} [matched]       - the substring or context key that matched
 * @property {string} [reason]        - human-readable explanation
 */

/**
 * @typedef {Object} Signal
 * @property {string} name            - canonical signal id (matches filename)
 * @property {boolean} matched
 * @property {"strong"|"weak"|null} strength
 * @property {Evidence[]} evidence
 * @property {Object} [hint]          - optional structured hint (e.g. { source_scope: "external_world" })
 */

/**
 * @typedef {Object} SignalBundle
 * @property {Object<string, Signal>} signals  - keyed by signal name
 * @property {Evidence[]} evidence             - flattened evidence across all signals
 */

export const SIGNAL_NAMES = /** @type {const} */ ([
  "explicit_external",
  "source_scope",
  "explicit_search",
  "weak_freshness",
  "explicit_entity"
]);

/**
 * Build an empty signal record. Used by detectors when their pattern misses,
 * so callers can rely on `signals[name]` always being present.
 *
 * @param {string} name
 * @returns {Signal}
 */
export function emptySignal(name) {
  return { name, matched: false, strength: null, evidence: [], hint: {} };
}
