import {
  extractLaunchAppCandidates,
  normalizeLaunchAppArg,
  normalizeLaunchAppKey
} from "./planners/launch-helpers.mjs";

export function repairSchemaArgAliases(args = {}, tool = null) {
  const repaired = { ...(args ?? {}) };
  const properties = tool?.parameters?.properties && typeof tool.parameters.properties === "object"
    ? tool.parameters.properties
    : {};
  if (!("query" in repaired) && "query" in properties && typeof repaired.q === "string") {
    repaired.query = repaired.q;
    delete repaired.q;
  }
  const propertyKeys = Object.keys(properties);
  const providedKeys = Object.keys(repaired);
  if (propertyKeys.length === 1 && providedKeys.length === 1 && !(providedKeys[0] in properties)) {
    repaired[propertyKeys[0]] = repaired[providedKeys[0]];
    delete repaired[providedKeys[0]];
  }
  return repaired;
}

const DOCUMENT_KINDS = new Set(["pptx", "docx", "xlsx", "pdf"]);

function normalizeDocumentKind(value) {
  const raw = String(value ?? "").toLowerCase().trim();
  if (raw === "word") return "docx";
  if (raw === "excel") return "xlsx";
  if (raw === "ppt" || raw === "powerpoint") return "pptx";
  return DOCUMENT_KINDS.has(raw) ? raw : "";
}

function repairGenerateDocumentArgs(args = {}, task = {}, tool = null) {
  const repaired = repairSchemaArgAliases(args, tool);
  const explicitKind = normalizeDocumentKind(
    repaired.kind ?? repaired.format ?? repaired.type ?? repaired.document_type
  );
  const contractKind = normalizeDocumentKind(task?.task_spec?.artifact?.kind);
  if (!explicitKind && contractKind) {
    repaired.kind = contractKind;
  } else if (explicitKind) {
    repaired.kind = explicitKind;
  }
  delete repaired.format;
  delete repaired.type;
  delete repaired.document_type;

  if (repaired.outline == null) {
    const outlineAlias = repaired.content ?? repaired.text ?? repaired.body ?? null;
    if (outlineAlias != null) repaired.outline = outlineAlias;
  }
  delete repaired.content;
  delete repaired.text;
  delete repaired.body;
  return repaired;
}

function repairRenderSvgArgs(args = {}, tool = null) {
  const repaired = repairSchemaArgAliases(args, tool);
  if (repaired.svg == null) {
    const svgAlias = repaired.markup ?? repaired.source ?? null;
    if (svgAlias != null) repaired.svg = svgAlias;
  }
  delete repaired.markup;
  delete repaired.source;
  return repaired;
}

export function repairToolArgs(decision, task, transcript = [], tool = null) {
  if (!decision) return {};
  if (decision.tool === "generate_document") {
    return repairGenerateDocumentArgs(decision.args ?? {}, task, tool);
  }
  if (decision.tool === "render_svg") {
    return repairRenderSvgArgs(decision.args ?? {}, tool);
  }
  if (decision.tool !== "launch_app") return repairSchemaArgAliases(decision.args ?? {}, tool);
  const args = { ...(decision.args ?? {}) };
  const explicit = normalizeLaunchAppArg(args.app ?? args.name ?? args.appName);
  if (explicit) {
    args.app = explicit;
    delete args.name;
    delete args.appName;
    return repairSchemaArgAliases(args, tool);
  }

  const candidates = extractLaunchAppCandidates(task?.user_command ?? "");
  if (candidates.length === 0) return repairSchemaArgAliases(args, tool);

  const alreadyUsed = new Set(
    transcript
      .filter((entry) => entry?.type === "tool_result" && entry.tool === "launch_app")
      .map((entry) => normalizeLaunchAppKey(entry.args?.app))
      .filter(Boolean)
  );
  const next = candidates.find((candidate) => !alreadyUsed.has(normalizeLaunchAppKey(candidate)))
    ?? candidates[0];
  args.app = next;
  delete args.name;
  delete args.appName;
  return repairSchemaArgAliases(args, tool);
}
