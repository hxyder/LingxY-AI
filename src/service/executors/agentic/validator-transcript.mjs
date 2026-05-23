/**
 * Agentic validator transcript seam.
 *
 * The agentic planner keeps a provider-replay transcript internally, while
 * the success contract validator and evidence normalizer consume the
 * tool_using-style `tool_result` shape. Keep that translation at this seam so
 * the planner loop does not leak validator-specific data shapes everywhere.
 */

export function transcriptForValidator(plannerTranscript = []) {
  const out = [];
  for (const entry of plannerTranscript) {
    if (!entry || entry.role !== "tool") continue;
    out.push({
      type: "tool_result",
      tool: entry.name,
      success: entry.success,
      observation: entry.observation ?? "",
      metadata: entry.metadata ?? {},
      artifact_paths: entry.artifact_paths ?? []
    });
  }
  return out;
}

export function agenticToolResultHasSubstance(result) {
  if (!result || typeof result !== "object") return false;
  if (Array.isArray(result.results) && result.results.length > 0) return true;
  if (Array.isArray(result.sources) && result.sources.length > 0) return true;
  if (typeof result.observation === "string" && result.observation.trim().length > 32) return true;
  if (Array.isArray(result.metadata?.results) && result.metadata.results.length > 0) return true;
  for (const value of Object.values(result)) {
    if (Array.isArray(value) && value.length > 0) return true;
    if (typeof value === "string" && value.trim().length > 32) return true;
  }
  return false;
}
