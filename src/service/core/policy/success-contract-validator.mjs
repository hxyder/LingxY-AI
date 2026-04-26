/**
 * UCA-077 P1-08: Centralised success-contract validator.
 *
 * Shared between tool_using and agentic so both executors apply the same
 * downgrade rules. Pulls the rules out of `agent-loop.mjs` so we can call
 * them from anywhere (including a future task-runtime finalize hook in
 * Phase 2's OutputPolicy work).
 *
 * Currently validates:
 *   - When tool_policy.web_search_fetch === "required", the transcript must
 *     contain at least one web_search_fetch tool_result whose payload looks
 *     non-empty. "Called but returned nothing" still counts as a violation —
 *     otherwise the task can answer from training memory and tick the box.
 *
 * Phase 2 will extend this with: artifact_required → artifact actually
 * created; output=conversational → no spurious file writes.
 */

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
 * @param {object} taskSpec
 * @param {TranscriptEntry[]} transcript
 * @returns {{ satisfied: boolean, violations: ContractViolation[] }}
 */
export function validateSuccessContract(taskSpec, transcript = []) {
  const violations = [];

  const webMode = taskSpec?.tool_policy?.web_search_fetch?.mode;
  if (webMode === "required") {
    const hit = (transcript ?? []).find(
      (entry) => entry?.type === "tool_result" && entry?.tool === "web_search_fetch"
    );
    if (!hit) {
      violations.push({
        kind: "web_search_required_not_called",
        message: "tool_policy.web_search_fetch=required but the executor never invoked web_search_fetch."
      });
    } else if (!resultHasSubstance(hit)) {
      violations.push({
        kind: "web_search_required_returned_empty",
        message: "tool_policy.web_search_fetch=required and the tool was called but returned no usable results."
      });
    }
  }

  return { satisfied: violations.length === 0, violations };
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
