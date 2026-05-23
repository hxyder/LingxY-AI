import { ACTION_OBLIGATION_GROUPS } from "../../core/policy/obligation-evaluator.mjs";
import { groupsOfTool } from "../../core/policy/policy-groups.mjs";

// UCA-181 follow-up: a tool counts as "side-effect" if it belongs to
// any known action-obligation policy group OR is flagged risk_level=high
// at the registry. We use this to refuse repeat fires after a successful
// invocation in the same loop.
export function isSideEffectTool(tool, registry) {
  if (!tool) return false;
  const groups = groupsOfTool(tool.id);
  if (groups.some((g) => ACTION_OBLIGATION_GROUPS.includes(g))) return true;
  const spec = registry?.get?.(tool.id) ?? tool;
  return spec?.risk_level === "high" || spec?.requires_confirmation === true;
}

export function transcriptHasSuccessfulToolCall(transcript = [], toolId) {
  if (!toolId) return false;
  return (transcript ?? []).some((entry) =>
    entry?.type === "tool_result"
    && entry.tool === toolId
    && entry.success !== false
    && (entry.error == null || entry.error === "")
  );
}

/**
 * Mirrors `resultHasSubstance` in success-contract-validator.mjs but
 * operates on the raw `result` object the registry returns. Used by the
 * error-budget wire-up to decide whether an external_web_read success
 * returned anything usable.
 */
export function toolResultHasSubstance(result) {
  if (!result || typeof result !== "object") return false;
  if (Array.isArray(result.results) && result.results.length > 0) return true;
  if (Array.isArray(result.sources) && result.sources.length > 0) return true;
  if (typeof result.observation === "string" && result.observation.trim().length > 32) return true;
  for (const value of Object.values(result)) {
    if (Array.isArray(value) && value.length > 0) return true;
    if (typeof value === "string" && value.trim().length > 32) return true;
  }
  return false;
}
