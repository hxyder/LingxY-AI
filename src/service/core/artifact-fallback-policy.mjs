export const FILE_GENERATION_TOOL_IDS = new Set([
  "generate_document",
  "write_file",
  "edit_file",
  "render_diagram",
  "render_svg"
]);

const EXECUTORS_WITH_FILE_GENERATION_TOOLS = new Set(["tool_using", "agentic"]);

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

export function hasFileGenerationToolCapability({
  executorId = null,
  actionToolRegistry = null
} = {}) {
  if (!EXECUTORS_WITH_FILE_GENERATION_TOOLS.has(executorId)) return false;
  if (!actionToolRegistry) return false;

  if (typeof actionToolRegistry.get === "function") {
    for (const toolId of FILE_GENERATION_TOOL_IDS) {
      if (actionToolRegistry.get(toolId)) return true;
    }
    return false;
  }

  if (typeof actionToolRegistry.list === "function") {
    return actionToolRegistry.list().some((tool) => FILE_GENERATION_TOOL_IDS.has(tool?.id));
  }

  return false;
}

/**
 * Returns a reason string if artifact recovery should be blocked, or null.
 * Centralized here so the agent-loop doesn't duplicate policy logic that
 * belongs in the shared artifact fallback layer (Codex round-1).
 */
export function artifactRecoveryBlockedReason(taskSpec = {}) {
  const goal = String(taskSpec?.goal ?? "").trim();
  const requiredToolNames = Array.isArray(taskSpec?.success_contract?.required_tool_names)
    ? taskSpec.success_contract.required_tool_names.map((name) => String(name ?? "").trim())
    : [];
  const requiredKinds = Array.isArray(taskSpec?.artifact?.required_kinds)
    ? taskSpec.artifact.required_kinds.map((kind) => String(kind ?? "").trim()).filter(Boolean)
    : [];
  if (goal === "transform_existing_file") {
    return "goal_transform_existing_file_requires_edit_file";
  }
  if (requiredToolNames.includes("edit_file")) {
    return "required_tool_edit_file_not_called";
  }
  if (requiredKinds.length > 1) {
    return "multi_artifact_required_kinds_need_explicit_tool_calls";
  }
  return null;
}

export function shouldSynthesizeRequestedFallbackArtifact({
  requestedFormat = null,
  generatedArtifacts = [],
  task = null,
  fileGeneration = null,
  fileGenerationToolCapability = false
} = {}) {
  if (!requestedFormat || requestedFormat.id === "conversational") return false;
  if (Array.isArray(generatedArtifacts) && generatedArtifacts.length > 0) return false;
  if (task?.task_spec?.goal === "transform_existing_file") return false;

  const artifactRequired = task?.task_spec?.artifact?.required === true
    || task?.task_spec?.success_contract?.artifact_created === true;
  const blockedByFailedGenerator = artifactRequired
    && fileGeneration?.attempted === true
    && fileGeneration?.succeeded !== true;
  const blockedByMissingGenerator = artifactRequired
    && fileGenerationToolCapability === true
    && fileGeneration?.attempted !== true;
  if (blockedByMissingGenerator) return false;
  return !blockedByFailedGenerator;
}
