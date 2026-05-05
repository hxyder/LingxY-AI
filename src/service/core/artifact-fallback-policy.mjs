export const FILE_GENERATION_TOOL_IDS = new Set([
  "generate_document",
  "write_file",
  "edit_file",
  "render_diagram",
  "render_svg"
]);

export function createFileGenerationAttemptState() {
  return {
    attempted: false,
    succeeded: false
  };
}

export function recordFileGenerationToolEvent(state, payload = {}) {
  if (!state || !FILE_GENERATION_TOOL_IDS.has(payload.tool_id ?? payload.tool ?? "")) {
    return state;
  }
  state.attempted = true;
  if (payload.success === true) state.succeeded = true;
  return state;
}

export function recordArtifactGenerated(state) {
  if (state) state.succeeded = true;
  return state;
}

export function shouldSynthesizeRequestedFallbackArtifact({
  requestedFormat = null,
  generatedArtifacts = [],
  task = null,
  fileGeneration = null
} = {}) {
  if (!requestedFormat || requestedFormat.id === "conversational") return false;
  if (Array.isArray(generatedArtifacts) && generatedArtifacts.length > 0) return false;
  if (task?.task_spec?.goal === "transform_existing_file") return false;

  const artifactRequired = task?.task_spec?.artifact?.required === true
    || task?.task_spec?.success_contract?.artifact_created === true;
  const toolUseRequired = task?.task_spec?.success_contract?.tool_called === true;
  const blockedByFailedGenerator = artifactRequired
    && fileGeneration?.attempted === true
    && fileGeneration?.succeeded !== true;
  const blockedByMissingGenerator = artifactRequired
    && toolUseRequired
    && fileGeneration?.attempted !== true;
  if (blockedByMissingGenerator) return false;
  return !blockedByFailedGenerator;
}
