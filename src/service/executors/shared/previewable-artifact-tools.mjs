export const STREAMABLE_ARTIFACT_TOOL_IDS = new Set([
  "write_file",
  "generate_document",
  "edit_file",
  "render_diagram",
  "render_svg"
]);

export function isStreamableArtifactTool(toolOrId) {
  const id = typeof toolOrId === "string" ? toolOrId : toolOrId?.id;
  return STREAMABLE_ARTIFACT_TOOL_IDS.has(String(id ?? ""));
}
