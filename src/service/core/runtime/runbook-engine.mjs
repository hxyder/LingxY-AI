/**
 * UCA-077 P4-RB (main plan §17.4.1 / §18.4): runbook engine.
 *
 * A runbook is a declarative recovery sequence for a known failure
 * mode. The agent loop hits a phase-gate failure (P4-08 step 1
 * `next_action !== "continue"`); instead of asking the LLM to figure
 * out what to do — which gives a different recovery every time and
 * makes failures non-reproducible — it queries this engine for a
 * canonical fix.
 *
 * Today's built-in catalogue (deliberately narrow per §17.4.1: do not
 * try to enumerate every failure mode):
 *
 *   EMPTY_WEB_SEARCH_RESULT
 *     web_search_fetch returned 0 sources for a `required` web read.
 *     Recovery: relax the query once, retry once, then mark partial.
 *
 *   FORBIDDEN_TOOL_REQUESTED
 *     Registry guard blocked a forbidden-policy tool call.
 *     Recovery: log the change request (operator audit trail),
 *     evaluate scope impact, and continue without that tool.
 *
 *   NO_FILE_CHANGE_DETECTED
 *     Task that promised an artifact (artifact_required=true) finished
 *     without a verifiable file change.
 *     Recovery: re-check git diff / artifact manifest, mark as
 *     false_success and route to the rework path.
 *
 *   AGENT_LOOP_NO_PROGRESS
 *     `validateStepGate` returned `escalate` from a same-tool failure
 *     streak.
 *     Recovery: compress context once, retry with simpler prompt, then
 *     abort to partial_success.
 *
 *   TOOL_REPEATED_FAILURE
 *     Same tool failed perToolFailureThreshold consecutive times (the
 *     phase-gate `escalate` signal). Slightly different from
 *     AGENT_LOOP_NO_PROGRESS — that one is broader (any signal of
 *     no progress); this one is the specific tool-stuck pattern.
 *     Recovery: ask the resolver to re-judge with `route_reconsider`,
 *     possibly switch executor.
 *
 *   GATE_ABORT_AT_ITERATION_CEILING
 *     `validateStepGate` returned `abort` at iteration max - 1.
 *     Recovery: stop the loop and surface partial_success cleanly.
 *
 * The engine is deliberately not "smart": it returns a fixed sequence
 * of action labels. The agent loop / task-runtime is responsible for
 * mapping each label to a real operation. That keeps the engine
 * testable without runtime state and lets the same runbook script
 * fire from any caller.
 *
 * Status: data + lookup helper only. Wiring into agent-loop /
 * task-runtime is a follow-up task tracked in §19.
 */

/**
 * @typedef {Object} RunbookAction
 * @property {string} id            // canonical action label
 * @property {string} description   // operator-facing one-liner
 *
 * @typedef {Object} Runbook
 * @property {string} id            // failure-mode identifier (matches detect signal)
 * @property {string} description   // when this runbook fires
 * @property {RunbookAction[]} steps   // ordered recovery actions
 * @property {"retry"|"escalate"|"abort"|"partial_success"} terminal_action
 *           // what to do after the steps finish (or if a step itself fails)
 */

/** @type {Object<string, Runbook>} */
export const RUNBOOKS = Object.freeze({
  EMPTY_WEB_SEARCH_RESULT: Object.freeze({
    id: "EMPTY_WEB_SEARCH_RESULT",
    description: "External-web-read tool was called but returned no usable sources for a required-web task.",
    steps: Object.freeze([
      Object.freeze({ id: "relax_query_once", description: "Drop tight phrasing / quotes; re-issue web_search_fetch once with broader keywords." }),
      Object.freeze({ id: "fallback_to_fetch_url_content", description: "If a known authoritative URL or public data endpoint exists for the entity (weather.gov, official/regulator pages, finance.yahoo.com, en.wikipedia.org), fetch it directly; raise max_chars when the page likely contains detailed fields." }),
      Object.freeze({ id: "mark_partial_success_no_external_data", description: "If still empty, mark the task partial_success and tell the user external data was unreachable — do NOT fabricate from training memory." })
    ]),
    terminal_action: "partial_success"
  }),
  FORBIDDEN_TOOL_REQUESTED: Object.freeze({
    id: "FORBIDDEN_TOOL_REQUESTED",
    description: "Registry guard blocked a tool call against a forbidden-policy entry.",
    steps: Object.freeze([
      Object.freeze({ id: "log_change_request", description: "Append a tool.change_request audit entry so the operator can review whether the policy was wrong." }),
      Object.freeze({ id: "evaluate_scope_impact", description: "Decide whether the blocked tool was load-bearing for the task; if yes, escalate to partial_success with a clear explanation; if no, continue." }),
      Object.freeze({ id: "record_decision_trace", description: "Stamp the FORBIDDEN_TOOL_REQUESTED runbook fire on DecisionTrace so inspect-routing surfaces it." })
    ]),
    terminal_action: "escalate"
  }),
  NO_FILE_CHANGE_DETECTED: Object.freeze({
    id: "NO_FILE_CHANGE_DETECTED",
    description: "Task promised an artifact (artifact_required=true) but no verifiable file change exists at finalize time.",
    steps: Object.freeze([
      Object.freeze({ id: "check_git_diff_or_artifact_manifest", description: "Re-inspect runtime.artifactStore + on-disk timestamps; the executor may have created the file under a different path than the LLM reported." }),
      Object.freeze({ id: "mark_false_success", description: "If still no diff, downgrade success → false_success; the truthfulness guard (UCA-049 §B) takes care of the user-visible reply." }),
      Object.freeze({ id: "return_to_rework_queue", description: "Optionally re-enqueue with rework hint so the user gets a retry rather than a confused success." })
    ]),
    terminal_action: "abort"
  }),
  AGENT_LOOP_NO_PROGRESS: Object.freeze({
    id: "AGENT_LOOP_NO_PROGRESS",
    description: "validateStepGate returned `escalate` because the agent loop is making no measurable progress.",
    steps: Object.freeze([
      Object.freeze({ id: "compress_context_once", description: "Drop older transcript turns to reset the LLM's working set; sometimes the planner has lost the thread." }),
      Object.freeze({ id: "retry_with_simpler_prompt", description: "Re-call the LLM with an explicit hint that the previous approach didn't work." }),
      Object.freeze({ id: "abort_and_partial_success", description: "If still stuck after compression, stop the loop and surface partial_success." })
    ]),
    terminal_action: "partial_success"
  }),
  TOOL_REPEATED_FAILURE: Object.freeze({
    id: "TOOL_REPEATED_FAILURE",
    description: "The same tool failed perToolFailureThreshold consecutive times (phase-gate escalate signal).",
    steps: Object.freeze([
      Object.freeze({ id: "request_route_reconsider", description: "Emit a route_reconsider event so task-runtime + SemanticRouter can re-judge the executor." }),
      Object.freeze({ id: "switch_executor_if_supported", description: "If the new judgment upgrades fast → tool_using or tool_using → agentic, hand off the transcript and continue." }),
      Object.freeze({ id: "fall_through_to_no_progress_runbook", description: "If the upgrade is not possible (no other executor available), defer to AGENT_LOOP_NO_PROGRESS." })
    ]),
    terminal_action: "escalate"
  }),
  GATE_ABORT_AT_ITERATION_CEILING: Object.freeze({
    id: "GATE_ABORT_AT_ITERATION_CEILING",
    description: "validateStepGate returned `abort` because iterations ran out before the contract was satisfied.",
    steps: Object.freeze([
      Object.freeze({ id: "stop_loop", description: "Break out of the agent loop immediately." }),
      Object.freeze({ id: "mark_partial_success", description: "Set status=partial_success with completed_with_warnings sub-status." }),
      Object.freeze({ id: "surface_violations_to_user", description: "Render the contract violations in the final reply so the user knows what was incomplete." })
    ]),
    terminal_action: "partial_success"
  }),
  // P4-RQ D4: research_quality coverage failure. Routes from any of
  // the three new violation kinds — single-publisher / insufficient
  // sources / roundup-only — and tells the agent loop the right
  // recovery is to *broaden* the search, not just retry the same
  // query. The terminal action is partial_success WITH disclosure:
  // when the loop has done its best and still doesn't have enough
  // independent sources, the user must know the answer is limited.
  INSUFFICIENT_RESEARCH_SOURCES: Object.freeze({
    id: "INSUFFICIENT_RESEARCH_SOURCES",
    description: "Multi-source research task did not gather enough independent sources (insufficient_sources / single_domain_only / single_roundup_only).",
    steps: Object.freeze([
      Object.freeze({ id: "broaden_query_once", description: "Re-issue web_search_fetch with a broader / less-specific query — current results are dominated by one publisher (or by a roundup page that aggregates internal links)." }),
      Object.freeze({ id: "search_with_alternative_terms", description: "Try synonyms or sibling phrasings (English ↔ Chinese, formal ↔ casual, primary entity ↔ adjacent entity). Many news/research items are reported across publishers under different headlines." }),
      Object.freeze({ id: "prefer_independent_domains", description: "If results still cluster on one publisher, fetch a known independent source (Reuters / AP / Nature / Wikipedia / industry-standard outlet for the topic) via fetch_url_content." }),
      Object.freeze({ id: "return_partial_success_with_disclosure", description: "If still under-covered, mark partial_success and tell the user explicitly: \"based on N sources from M publishers — limited coverage on this topic\"." })
    ]),
    terminal_action: "partial_success"
  })
});

// P4-RQ D4: violation kinds that route to INSUFFICIENT_RESEARCH_SOURCES.
// All three are emitted by validateSuccessContract / validateStepGate
// when research_quality enforcement fails coverage (D3).
const RESEARCH_QUALITY_VIOLATION_KINDS = Object.freeze(new Set([
  "external_web_read_insufficient_sources",
  "external_web_read_single_domain_only",
  "external_web_read_single_roundup_only"
]));

/**
 * Look up a runbook by failure-mode id.
 *
 * @param {string} id
 * @returns {Runbook|null}
 */
export function getRunbook(id) {
  return RUNBOOKS[id] ?? null;
}

/**
 * Suggest a runbook based on a phase-gate result. Decision tree:
 *
 *   - next_action === "continue"   → null (no recovery needed)
 *   - next_action === "abort"      → GATE_ABORT_AT_ITERATION_CEILING
 *   - next_action === "escalate"   → look at violations:
 *       - "tool_repeated_failure" present → TOOL_REPEATED_FAILURE
 *       - any "*_required_returned_empty" → EMPTY_WEB_SEARCH_RESULT
 *       - any "*_required_all_failed"     → AGENT_LOOP_NO_PROGRESS
 *       - default                         → AGENT_LOOP_NO_PROGRESS
 *   - next_action === "retry"      → null (let the agent try again on its own)
 *
 * Return value lets the caller decide whether to fire the runbook
 * automatically OR ask the LLM to handle it (when the engine returns
 * null, the agent loop falls back to today's LLM-decides path).
 *
 * @param {{ next_action: string, violations?: { kind: string }[] }} stepGateResult
 * @returns {Runbook|null}
 */
export function suggestRunbookForStepGate(stepGateResult) {
  if (!stepGateResult || typeof stepGateResult !== "object") return null;
  const { next_action: nextAction, violations = [] } = stepGateResult;
  if (nextAction === "continue" || nextAction === "retry") return null;

  const kinds = (Array.isArray(violations) ? violations : []).map((v) => v?.kind ?? "");

  // Research-quality violations get the more actionable runbook
  // regardless of next_action (abort or escalate). The recovery
  // ("broaden the query / find independent sources") is the same
  // whether the loop is escalating mid-flight or aborting at the
  // ceiling — what differs is whether the runbook gets to attempt
  // its steps before partial_success closes the task.
  if (kinds.some((k) => RESEARCH_QUALITY_VIOLATION_KINDS.has(k))) {
    return RUNBOOKS.INSUFFICIENT_RESEARCH_SOURCES;
  }

  if (nextAction === "abort") return RUNBOOKS.GATE_ABORT_AT_ITERATION_CEILING;
  if (nextAction !== "escalate") return null;

  if (kinds.includes("tool_repeated_failure")) {
    return RUNBOOKS.TOOL_REPEATED_FAILURE;
  }
  if (kinds.some((k) => k.endsWith("_required_returned_empty"))) {
    return RUNBOOKS.EMPTY_WEB_SEARCH_RESULT;
  }
  return RUNBOOKS.AGENT_LOOP_NO_PROGRESS;
}

/**
 * Suggest a runbook based on a tool result that's been blocked /
 * errored at the registry layer. Used when the agent loop wants to
 * react to a single failure event before the phase gate fires.
 *
 * Recognises:
 *   - blocked_by_policy   → FORBIDDEN_TOOL_REQUESTED
 *   - everything else     → null (let the phase gate decide)
 *
 * @param {{ success?: boolean, error?: string }} toolResult
 * @returns {Runbook|null}
 */
export function suggestRunbookForToolFailure(toolResult) {
  if (!toolResult || typeof toolResult !== "object") return null;
  if (toolResult.error === "blocked_by_policy") return RUNBOOKS.FORBIDDEN_TOOL_REQUESTED;
  return null;
}

/**
 * Suggest a runbook based on a finalize-time signal that doesn't show
 * up in the step gate. Currently: NO_FILE_CHANGE_DETECTED for tasks
 * that asserted artifact_required=true but produced no diff.
 *
 * @param {{ artifact_required: boolean, artifact_changed?: boolean }} finalizeSignals
 * @returns {Runbook|null}
 */
export function suggestRunbookForFinalize(finalizeSignals) {
  if (!finalizeSignals || typeof finalizeSignals !== "object") return null;
  if (finalizeSignals.artifact_required === true && finalizeSignals.artifact_changed === false) {
    return RUNBOOKS.NO_FILE_CHANGE_DETECTED;
  }
  return null;
}

export const RUNBOOK_IDS = Object.freeze(Object.keys(RUNBOOKS));
