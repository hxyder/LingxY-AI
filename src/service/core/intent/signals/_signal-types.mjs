/**
 * UCA-077 P1-01: Signal layer protocol.
 *
 * A Signal is the output of one atomic detector. Signals carry evidence,
 * never decisions. Routing decisions live in policy/ and planning/.
 *
 * Strength is binary: "strong" signals are safe to short-circuit on; "weak"
 * signals can only suggest "optional" — they must never force "required".
 *
 * UCA-077 P4-01 (plan §18.3): each signal also carries a `kind` annotation
 * — `fact | hint | assumption` — to tell downstream consumers (especially
 * the Phase 4 SemanticRouter) how much trust to put in the signal:
 *
 *   - `fact`        Direct observation; no interpretation. e.g. "user
 *                   attached 3 files", "user literally typed '整个项目'".
 *   - `hint`        Text contains a marker that traditionally implies
 *                   something. The marker is real, the implication is
 *                   conventional. e.g. "user said '查一下' → may want
 *                   search", "user named 'weather' → may want fresh data".
 *   - `assumption`  System is interpreting an indirect reference and could
 *                   be wrong. e.g. "user said '这个' → meant the current
 *                   project". Future Phase 4 RAID Assumptions surface
 *                   these for "the system is guessing X, confidence Y".
 *
 * The taxonomy is deliberately limited to 3 (per §18.3 — fact / hint /
 * assumption — no `strong_fact`, `weak_hint`, etc.). Future SemanticRouter
 * input only needs to distinguish hard data from heuristic suggestions
 * from inferences; finer gradation costs design time without buying
 * routing accuracy.
 */

/**
 * @typedef {"fact"|"hint"|"assumption"} SignalKind
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
 * @property {SignalKind|null} kind   - P4-01: fact / hint / assumption,
 *                                       null when matched is false
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
  "explicit_entity",
  "pending_offer",
  "explicit_single_url"
]);

/**
 * Canonical SignalKind values. Frozen so tests can iterate them without
 * importing additional helpers; consumers should validate against this set
 * rather than hard-coding strings.
 */
export const SIGNAL_KINDS = Object.freeze(["fact", "hint", "assumption"]);

/**
 * Build an empty signal record. Used by detectors when their pattern misses,
 * so callers can rely on `signals[name]` always being present. `kind` is
 * null when the signal didn't match — there's nothing to annotate yet.
 *
 * @param {string} name
 * @returns {Signal}
 */
export function emptySignal(name) {
  return { name, matched: false, strength: null, kind: null, evidence: [], hint: {} };
}
