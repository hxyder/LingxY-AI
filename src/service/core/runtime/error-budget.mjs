/**
 * UCA-077 P4-EB (main plan §17.4.2 / §18.4): aggregate error budget.
 *
 * Pre-this-module, an agent loop's defensive ceilings were:
 *   1. agent-loop maxIterations (8) — coarse-grained, only catches
 *      "loop ran for too long"
 *   2. policy-guard per-tool rate limit — per-tool, doesn't catch a
 *      task that bounces between several tools all failing
 *
 * Neither catches "this task tried 4 different tools, every one
 * returned empty, but the loop is technically still progressing".
 * That kept the user waiting through the full 8-iteration window for
 * a task that should have escalated to runbook / partial_success at
 * iteration 2.
 *
 * Error budget adds the missing layer: TASK-LEVEL aggregate counters
 * across failure modes. Each counter has a default ceiling; any one
 * counter hitting zero emits `budget_exhausted` and the runtime
 * escalates (via P4-RB runbook or partial_success).
 *
 * Semantics: counter `max=N` means the budget exhausts on the Nth event
 * (consumed >= max is the trip condition — see chargeBudget). The Nth
 * event hits the ceiling; the (N+1)th and beyond are past-ceiling.
 *
 * Defaults (safe; per main plan §17.4.2):
 *   max_empty_search_results : 1   first empty external-web-read result
 *                                   trips the budget. Runbook
 *                                   EMPTY_WEB_SEARCH_RESULT can still
 *                                   run its relax+retry step (runbook
 *                                   firing is independent of budget
 *                                   exhaustion); the budget just says
 *                                   "do not loop on empty results
 *                                   beyond this one event".
 *   max_tool_failures        : 2   one transient failure absorbed; the
 *                                   second hits the ceiling. Reading:
 *                                   1 strike OK, 2 strikes triggers
 *                                   escalation.
 *   max_replan_rounds        : 2   route_reconsider can fire once
 *                                   without exhausting; the second
 *                                   re-judgment trips the ceiling.
 *   max_no_file_change_runs  : 1   first run that promised an artifact
 *                                   but produced no diff trips the
 *                                   ceiling immediately.
 *
 * Override path: TaskSpec.execution_constraints.error_budget can ship
 * task-specific ceilings; createTaskSpec doesn't currently populate
 * them, but the runtime can read overrides when SemanticRouter
 * decides a task warrants more leniency.
 *
 * Status: data + helper module. Wiring into agent-loop / task-runtime
 * is the follow-up alongside P4-08 step 2.
 */

/**
 * @typedef {Object} ErrorBudgetState
 * @property {number} max_empty_search_results
 * @property {number} max_tool_failures
 * @property {number} max_replan_rounds
 * @property {number} max_no_file_change_runs
 * @property {number} consumed_empty_search_results
 * @property {number} consumed_tool_failures
 * @property {number} consumed_replan_rounds
 * @property {number} consumed_no_file_change_runs
 *
 * @typedef {"empty_search_result"|"tool_failure"|"replan_round"|"no_file_change_run"} BudgetEvent
 */

export const DEFAULT_BUDGET = Object.freeze({
  max_empty_search_results: 1,
  max_tool_failures: 2,
  max_replan_rounds: 2,
  max_no_file_change_runs: 1
});

const EVENT_TO_FIELDS = Object.freeze({
  empty_search_result: { max: "max_empty_search_results", consumed: "consumed_empty_search_results" },
  tool_failure:        { max: "max_tool_failures",        consumed: "consumed_tool_failures" },
  replan_round:        { max: "max_replan_rounds",        consumed: "consumed_replan_rounds" },
  no_file_change_run:  { max: "max_no_file_change_runs",  consumed: "consumed_no_file_change_runs" }
});

/**
 * Initialise an error-budget state. Per-task overrides win over
 * defaults; an override of 0 means "this counter is disabled" (any
 * event would immediately exhaust it, so the caller likely doesn't
 * intend that — treated as 0 anyway, fail-soft).
 *
 * @param {Partial<ErrorBudgetState>} [overrides]
 * @returns {ErrorBudgetState}
 */
export function createErrorBudget(overrides = {}) {
  const safeMax = (key) => {
    const v = overrides?.[key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
    return DEFAULT_BUDGET[key];
  };
  return {
    max_empty_search_results: safeMax("max_empty_search_results"),
    max_tool_failures:        safeMax("max_tool_failures"),
    max_replan_rounds:        safeMax("max_replan_rounds"),
    max_no_file_change_runs:  safeMax("max_no_file_change_runs"),
    consumed_empty_search_results: 0,
    consumed_tool_failures:        0,
    consumed_replan_rounds:        0,
    consumed_no_file_change_runs:  0
  };
}

/**
 * Charge the budget for an event. Returns a fresh ErrorBudgetState (no
 * mutation) plus a flag indicating whether the budget is now exhausted.
 *
 * `unknown` event types are no-ops with `exhausted: false` — the
 * runtime should never silently drop a known event, but defending
 * against typos / future event names is cheap.
 *
 * @param {ErrorBudgetState} state
 * @param {BudgetEvent} event
 * @returns {{ state: ErrorBudgetState, exhausted: boolean, reason: string|null }}
 */
export function chargeBudget(state, event) {
  const fields = EVENT_TO_FIELDS[event];
  if (!fields) {
    return { state, exhausted: false, reason: null };
  }
  const next = { ...state };
  next[fields.consumed] = (state?.[fields.consumed] ?? 0) + 1;
  const exhausted = next[fields.consumed] >= next[fields.max];
  return {
    state: next,
    exhausted,
    reason: exhausted
      ? `${event} budget exhausted (consumed ${next[fields.consumed]}/${next[fields.max]})`
      : null
  };
}

/**
 * Snapshot the current budget for inclusion in DecisionTrace. Cheap;
 * just clones the state so downstream mutations don't bleed back into
 * the trace record.
 *
 * @param {ErrorBudgetState} state
 * @returns {ErrorBudgetState}
 */
export function snapshotBudget(state) {
  if (!state || typeof state !== "object") return null;
  return { ...state };
}

/**
 * @param {ErrorBudgetState} state
 * @returns {boolean} true when ANY counter is exhausted
 */
export function isAnyBudgetExhausted(state) {
  if (!state || typeof state !== "object") return false;
  return Object.entries(EVENT_TO_FIELDS).some(([, fields]) => {
    return (state[fields.consumed] ?? 0) >= (state[fields.max] ?? Infinity);
  });
}

/**
 * Convenience: which counter(s) are currently exhausted? Returns the
 * field names so the caller can render an explicit message.
 *
 * @param {ErrorBudgetState} state
 * @returns {string[]}
 */
export function listExhaustedCounters(state) {
  if (!state || typeof state !== "object") return [];
  const out = [];
  for (const [event, fields] of Object.entries(EVENT_TO_FIELDS)) {
    if ((state[fields.consumed] ?? 0) >= (state[fields.max] ?? Infinity)) {
      out.push(event);
    }
  }
  return out;
}
