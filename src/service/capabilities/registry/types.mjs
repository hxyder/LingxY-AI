export const ACTION_TOOL_RISK_LEVELS = Object.freeze(["low", "medium", "high"]);

export function createActionResult({ success, observation, artifactPaths = [], error = null, metadata = {} }) {
  return {
    success,
    observation,
    artifact_paths: artifactPaths,
    error,
    metadata
  };
}
