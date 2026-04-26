/**
 * UCA-077 P1-08: Centralised success-contract validator.
 *
 * Shared between tool_using and agentic so both executors apply the same
 * downgrade rules. Pulls the rules out of `agent-loop.mjs` so we can call
 * them from anywhere (including a future task-runtime finalize hook in
 * Phase 2's OutputPolicy work).
 *
 * Validates:
 *   - For every entry in `success_contract.required_policy_groups`, the
 *     transcript must contain at least one tool_result for ANY tool that
 *     belongs to the group — and the result must look non-empty.
 *     "Called but returned nothing" still counts as a violation. This is
 *     the P4-00.7 group-aware check; it replaces the previous hardcoded
 *     `web_search_fetch === required → must call web_search_fetch` rule
 *     so the LLM is allowed to satisfy "external_web_read=required" by
 *     calling fetch_url_content (a sibling tool in the same group) or
 *     web_search instead.
 *
 * Phase 2 will extend this with: artifact_required → artifact actually
 * created; output=conversational → no spurious file writes.
 */

import { toolsInGroup } from "./policy-groups.mjs";

/**
 * @typedef {Object} TranscriptEntry
 * @property {string} [type]              - "tool_call" | "tool_result" | ...
 * @property {string} [tool]              - tool id when applicable
 * @property {*}      [result]            - tool result body (shape varies)
 * @property {string} [observation]       - some executors store the rendered
 *                                          observation text instead of result
 */

/**
 * @typedef {Object} ContractViolation
 * @property {string} kind     - machine-readable code (e.g. "web_search_required_not_called")
 * @property {string} message  - human-readable message for the user
 */

/**
 * @typedef {"continue"|"retry"|"escalate"|"abort"} StepNextAction
 *
 * @typedef {Object} StepGateResult
 * @property {boolean}             satisfied
 * @property {ContractViolation[]} violations
 * @property {StepNextAction}      next_action
 */

/**
 * @param {object} taskSpec
 * @param {TranscriptEntry[]} transcript
 * @returns {{ satisfied: boolean, violations: ContractViolation[] }}
 */
export function validateSuccessContract(taskSpec, transcript = []) {
  const violations = [];

  // P4-00.7: required policy groups. The LLM may call ANY tool in the
  // group to satisfy the requirement — that's the whole point of the
  // group abstraction (LLM can pick the most appropriate sibling — e.g.
  // fetch_url_content when web_search_fetch returned nothing).
  //
  // P4-00.7 revised (§18.6.1.B): hits are filtered to drop entries that
  // FAILED at the tool layer. Without this, a `web_search_fetch` call
  // blocked by the registry policy guard returns a long observation
  // explaining the block ("Tool ... is forbidden by task policy: ...")
  // and `resultHasSubstance` happily accepts it as substance. That gave
  // the validator's `satisfied=true` for tasks that never actually
  // touched the open web. We now fail closed: an entry only counts if
  // it ran successfully (no entry.error, no entry.success === false).
  const requiredGroups = Array.isArray(taskSpec?.success_contract?.required_policy_groups)
    ? taskSpec.success_contract.required_policy_groups
    : [];
  for (const group of requiredGroups) {
    const members = toolsInGroup(group);
    if (members.length === 0) continue;
    const memberSet = new Set(members);
    const allCalls = (transcript ?? []).filter(
      (entry) => entry?.type === "tool_result" && memberSet.has(entry?.tool)
    );
    const successfulHits = allCalls.filter(isSuccessfulHit);
    if (successfulHits.length === 0) {
      // Distinguish "never called" from "called but every call failed" so
      // the user / audit log can see what actually went wrong.
      const kind = allCalls.length === 0
        ? `${group}_required_not_called`
        : `${group}_required_all_failed`;
      const message = allCalls.length === 0
        ? `success_contract.required_policy_groups includes "${group}" but the executor never invoked any of: ${members.join(", ")}.`
        : `success_contract.required_policy_groups includes "${group}"; tools were called (${allCalls.map((h) => h.tool).join(", ")}) but every call failed (errors: ${allCalls.map((h) => h.error ?? "(none)").join(", ")}).`;
      violations.push({ kind, message });
      continue;
    }
    if (!successfulHits.some((hit) => resultHasSubstance(hit))) {
      violations.push({
        kind: `${group}_required_returned_empty`,
        message: `success_contract.required_policy_groups includes "${group}"; tools succeeded (${successfulHits.map((h) => h.tool).join(", ")}) but none returned usable results.`
      });
    }
  }

  return { satisfied: violations.length === 0, violations };
}

/**
 * A transcript entry "counts" toward satisfying a requirement only if the
 * tool actually ran successfully. Failed/blocked/errored calls leave a
 * record but don't move the success contract forward.
 *
 * Inspects every signal the registry sets on a failure:
 *   - `entry.success === false`  (canonical: createActionResult sets this)
 *   - `entry.error`              (canonical: blocked_by_policy / rate_limited)
 *   - `entry.result?.success === false`  (legacy adapters that wrap result)
 *   - `entry.result?.error`              (legacy adapters that wrap error)
 *
 * Defaults to "successful" only when nothing on the entry flags a failure
 * — fail-closed is wrong here (we'd miss legitimate successes from
 * adapters that just don't set `success`); fail-open is also wrong (the
 * §18.6.1.B bug). The compromise: any explicit failure signal disqualifies
 * the entry; everything else counts.
 *
 * @param {object} entry
 * @returns {boolean}
 */
function isSuccessfulHit(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (entry.success === false) return false;
  if (entry.error != null && entry.error !== "") return false;
  const result = entry.result;
  if (result && typeof result === "object") {
    if (result.success === false) return false;
    if (result.error != null && result.error !== "") return false;
  }
  return true;
}

/**
 * UCA-077 P4-08 (main plan §16.5 / §18.4): per-step phase gate.
 *
 * Where `validateSuccessContract` is the FINALIZE gate (called once at
 * task end), `validateStepGate` is the IN-LOOP gate the agent loop
 * calls after each tool_call_completed. It surfaces failure patterns
 * early and returns a `next_action` hint so the loop can decide:
 *
 *   - `continue`  no problem detected (or contract just got satisfied)
 *   - `retry`     last tool call failed once — let the model try again
 *   - `escalate`  same tool failed multiple times, OR contract is
 *                 unreachable from the current executor → caller
 *                 should switch executor / upgrade policy / hand off
 *                 to runbook (P4-RB)
 *   - `abort`     out of iterations and contract still not met →
 *                 downgrade to partial_success and stop
 *
 * Pre-this-gate the tool loop ran the full maxIterations even when the
 * same web_search_fetch was failing four turns in a row. The phase
 * gate detects that pattern at iteration 2 and signals escalate; the
 * loop can then break out and (with P4-08 step 2 wiring) trigger the
 * SemanticRouter re-judgment / executor upgrade flow.
 *
 * Pure function — same inputs, same output. No side effects, no audit
 * writes. Caller decides what to do with `next_action`.
 *
 * @param {object} taskSpec
 * @param {TranscriptEntry[]} transcript
 * @param {{ iteration?: number, maxIterations?: number, perToolFailureThreshold?: number }} [options]
 * @returns {StepGateResult}
 */
export function validateStepGate(taskSpec, transcript = [], options = {}) {
  const iteration = Number.isFinite(options.iteration) ? options.iteration : 0;
  const maxIterations = Number.isFinite(options.maxIterations) ? options.maxIterations : 8;
  const perToolFailureThreshold = Number.isFinite(options.perToolFailureThreshold)
    ? options.perToolFailureThreshold
    : 2;

  // 1. Cheap early-out: if the finalize gate would already pass, the
  //    current iteration is on track. Just continue.
  const finalGate = validateSuccessContract(taskSpec, transcript);
  if (finalGate.satisfied) {
    return { satisfied: true, violations: [], next_action: "continue" };
  }

  // 2. About to hit the iteration ceiling. Anything not satisfied at
  //    iteration N-1 will not be satisfied at N either; abort and let
  //    the caller mark partial_success.
  if (iteration >= maxIterations - 1) {
    return {
      satisfied: false,
      violations: finalGate.violations,
      next_action: "abort"
    };
  }

  // 3. Examine the transcript tail for a same-tool failure streak. We
  //    only count CONSECUTIVE failures of the SAME tool from the end
  //    — a different-tool retry breaks the streak (the agent is
  //    actually exploring alternatives).
  const toolResults = (transcript ?? []).filter((e) => e?.type === "tool_result");
  if (toolResults.length === 0) {
    return { satisfied: false, violations: finalGate.violations, next_action: "continue" };
  }
  const lastResult = toolResults[toolResults.length - 1];
  if (isSuccessfulHit(lastResult)) {
    // Last call succeeded but contract still not met — agent is making
    // progress, let it keep going.
    return { satisfied: false, violations: finalGate.violations, next_action: "continue" };
  }

  let consecutiveFailures = 0;
  for (let i = toolResults.length - 1; i >= 0; i -= 1) {
    const r = toolResults[i];
    if (r?.tool !== lastResult.tool) break;
    if (isSuccessfulHit(r)) break;
    consecutiveFailures += 1;
  }

  if (consecutiveFailures >= perToolFailureThreshold) {
    return {
      satisfied: false,
      violations: [
        ...finalGate.violations,
        {
          kind: "tool_repeated_failure",
          message: `${lastResult.tool} failed ${consecutiveFailures} consecutive times — escalating to a different approach.`
        }
      ],
      next_action: "escalate"
    };
  }

  // Single failure (or first failure of a new tool). Let the agent
  // try one more time before we escalate. This also covers the
  // "called something else first, then failed once" flow.
  return {
    satisfied: false,
    violations: finalGate.violations,
    next_action: "retry"
  };
}

function resultHasSubstance(entry) {
  // web_search_fetch returns results in different shapes depending on the
  // provider. Accept any of: a non-empty `results`/`sources` array, a
  // non-empty `observation` string, or any non-trivial nested data.
  const result = entry?.result ?? null;
  if (Array.isArray(result?.results) && result.results.length > 0) return true;
  if (Array.isArray(result?.sources) && result.sources.length > 0) return true;
  if (typeof entry?.observation === "string" && entry.observation.trim().length > 32) return true;
  if (result && typeof result === "object") {
    for (const value of Object.values(result)) {
      if (Array.isArray(value) && value.length > 0) return true;
      if (typeof value === "string" && value.trim().length > 32) return true;
    }
  }
  return false;
}
