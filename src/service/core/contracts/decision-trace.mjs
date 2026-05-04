/**
 * UCA-077 P2-01: DecisionTrace — every routing/policy decision the system
 * makes is recorded as one trace entry, accumulated against a single task.
 *
 * The plan called for this in Phase 2 §13 ("All key decisions must have a
 * DecisionTrace"). Until now the system had ad-hoc reasons sprinkled in
 * resolver outputs but no canonical record; the agentic verifier could
 * print "executor=agentic" but not "we chose agentic because X, having
 * rejected Y because Z".
 *
 * Shape:
 *   {
 *     decision_id : string  // stable, ULID-ish; survives task replay
 *     stage       : string  // "goal-classification" | "tool-policy" | …
 *     output      : object  // the decision result (executor name, mode, …)
 *     reason      : string  // single-sentence rationale
 *     evidence    : Evidence[]  // signals/context that drove the choice
 *     rejected    : { candidate, reason }[]  // explicitly considered + dropped
 *     created_at  : ISO timestamp
 *   }
 *
 * Resolvers do NOT import this module directly — they keep returning their
 * native shapes (so unit tests stay simple). The orchestrator (createTaskSpec
 * in P2-02) wraps each resolver call with `recordDecision()` and persists
 * the bundle on the task. SSE emission lives in task-runtime in P2-03.
 */

import crypto from "node:crypto";

/**
 * @typedef {Object} DecisionTraceEntry
 * @property {string} decision_id
 * @property {string} stage
 * @property {Object} output
 * @property {string} reason
 * @property {import("../intent/signals/_signal-types.mjs").Evidence[]} evidence
 * @property {{ candidate: string, reason: string }[]} rejected
 * @property {string[]} [triggered_raid_ids]
 *           // P4-RR: optional list of RAID identifiers (e.g. ["RR-03", "A-02"])
 *           // that this decision recognised and acted on. Empty array stripped
 *           // so unaware consumers ignore the field entirely.
 * @property {string} created_at
 */

/**
 * Build a single trace entry. Caller normally goes through `createTracker()`
 * but this helper is exported for one-shot uses.
 *
 * @param {string} stage
 * @param {{ output: Object, reason?: string, evidence?: Array, rejected?: Array, triggered_raid_ids?: string[] }} payload
 * @returns {DecisionTraceEntry}
 */
export function buildDecisionTrace(stage, { output, reason = "", evidence = [], rejected = [], triggered_raid_ids = [] } = {}) {
  /** @type {DecisionTraceEntry} */
  const entry = {
    decision_id: shortId(),
    stage: String(stage ?? "unknown"),
    output: output ?? {},
    reason: String(reason ?? ""),
    evidence: Array.isArray(evidence) ? evidence : [],
    rejected: Array.isArray(rejected) ? rejected : [],
    created_at: new Date().toISOString()
  };
  // Only attach the field when the caller actually flagged something —
  // keeps existing snapshots / logs unchanged for decisions that don't
  // map to a RAID id.
  if (Array.isArray(triggered_raid_ids) && triggered_raid_ids.length > 0) {
    entry.triggered_raid_ids = [...triggered_raid_ids];
  }
  return entry;
}

/**
 * Per-task accumulator. Each call to `record()` appends an entry; `entries()`
 * returns the full ordered list, `summary()` returns a compact projection
 * suitable for SSE / UI.
 *
 * @returns {{
 *   record: (stage: string, payload: object) => DecisionTraceEntry,
 *   entries: () => DecisionTraceEntry[],
 *   summary: () => { stage: string, output: Object, reason: string }[]
 * }}
 */
export function createTracker() {
  /** @type {DecisionTraceEntry[]} */
  const log = [];

  return {
    record(stage, payload) {
      const entry = buildDecisionTrace(stage, payload);
      log.push(entry);
      return entry;
    },
    entries() {
      return [...log];
    },
    summary() {
      return log.map((entry) => ({
        stage: entry.stage,
        output: entry.output,
        reason: entry.reason
      }));
    }
  };
}

/**
 * Canonical stage names. Centralised so SSE consumers can switch on stable
 * identifiers without duplicating string literals.
 */
export const STAGES = Object.freeze({
  GOAL_CLASSIFICATION: "goal-classification",
  TOOL_POLICY: "tool-policy",
  POLICY_CONFLICT_RESOLVED: "policy-conflict-resolved", // P4-00.6 invariant
  SEMANTIC_ROUTER: "semantic-router",                   // P4-03 LLM suggestion (decision OR rejection)
  FILE_READ_BUDGET: "file-read-budget",
  EXECUTOR_SELECTION: "executor-selection",
  OUTPUT_POLICY: "output-policy",          // reserved for Phase 2 OutputPolicy step
  SUCCESS_CONTRACT: "success-contract",    // reserved for finalize-time checks
  EVIDENCE_SUMMARY: "evidence-summary"     // P4-RQ C3: post-loop URL/domain coverage (audit-only)
});

function shortId() {
  // 9 random hex chars — enough for one task's worth of traces without
  // pulling a full ULID dependency.
  return `dec_${crypto.randomBytes(5).toString("hex")}`;
}
