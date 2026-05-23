import { repairToolArgs } from "../tool_using/tool-arg-repair.mjs";
import { validateToolCall } from "../tool_using/tool-call-validator.mjs";

const ARTIFACT_TOOL_IDS = new Set([
  "generate_document",
  "edit_file",
  "render_diagram",
  "render_svg"
]);

export function shouldRunArtifactToolPreflight(tool) {
  return ARTIFACT_TOOL_IDS.has(tool?.id);
}

export function prepareArtifactToolCall({
  tool,
  call,
  task,
  transcript = [],
  toolContext = {}
} = {}) {
  if (!shouldRunArtifactToolPreflight(tool)) {
    return {
      ok: true,
      applied: false,
      args: call?.arguments ?? {}
    };
  }

  const repairedArgs = repairToolArgs({
    type: "tool_call",
    tool: tool.id,
    args: call?.arguments ?? {}
  }, task ?? {}, transcript, tool);

  const validation = validateToolCall(tool, repairedArgs, {
    ...(toolContext ?? {}),
    task
  });
  if (!validation.ok) {
    return {
      ok: false,
      applied: true,
      args: repairedArgs,
      error: validation.error
    };
  }

  return {
    ok: true,
    applied: true,
    args: repairedArgs,
    warning: validation.warning ?? null
  };
}
