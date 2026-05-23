const TOOL_ACTIONS = new Map([
  ["write_file", "create_new"],
  ["generate_document", "create_new"],
  ["render_diagram", "create_new"],
  ["render_svg", "create_new"],
  ["edit_file", "update_existing"]
]);

const ACTION_SOURCES = new Map([
  ["create_new", "generated"],
  ["update_existing", "edited"]
]);
const KNOWN_ACTION_SOURCES = new Set(ACTION_SOURCES.values());

export function normalizeArtifactSource(value = "") {
  const source = String(value ?? "").trim();
  return KNOWN_ACTION_SOURCES.has(source) ? source : null;
}

export function artifactActionForTool(toolId = "") {
  return TOOL_ACTIONS.get(String(toolId ?? "").trim()) ?? null;
}

export function artifactSourceForAction(action = "") {
  return ACTION_SOURCES.get(String(action ?? "").trim()) ?? null;
}

export function artifactSourceForTool(toolId = "") {
  const action = artifactActionForTool(toolId);
  return action ? artifactSourceForAction(action) : null;
}

export function artifactEventFieldsForToolResult(toolId = "", result = {}) {
  const paths = Array.isArray(result?.artifact_paths)
    ? result.artifact_paths.filter(Boolean)
    : [];
  if (paths.length === 0) return {};
  const artifact_action = artifactActionForTool(toolId);
  const artifact_source = artifactSourceForAction(artifact_action);
  if (!artifact_action || !artifact_source) return { artifact_paths: paths };
  return {
    artifact_paths: paths,
    artifact_action,
    artifact_source
  };
}

export function artifactSourceFromEventPayload(payload = {}) {
  return artifactSourceForAction(payload?.artifact_action)
    ?? normalizeArtifactSource(payload?.artifact_source);
}

export function artifactMetadataEntriesFromToolEvent(payload = {}) {
  const paths = Array.isArray(payload?.artifact_paths)
    ? payload.artifact_paths.filter(Boolean)
    : [];
  if (paths.length === 0) return [];
  const source = artifactSourceFromEventPayload(payload);
  if (!source) return [];
  return paths.map((artifactPath) => ({
    path: artifactPath,
    source
  }));
}

export function rememberArtifactMetadataFromToolEvent(metadataByPath, payload = {}) {
  if (!metadataByPath?.set) return metadataByPath;
  for (const entry of artifactMetadataEntriesFromToolEvent(payload)) {
    metadataByPath.set(entry.path, { source: entry.source });
  }
  return metadataByPath;
}

export function artifactRegistrationOptionsForPath(artifactPath, { metadataByPath = null, payload = null } = {}) {
  const source = artifactSourceFromEventPayload(payload)
    ?? metadataByPath?.get?.(artifactPath)?.source
    ?? null;
  return source ? { source } : {};
}
