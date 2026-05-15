import path from "node:path";
import {
  evaluateDocumentOutlineQuality,
  formatDocumentQualityError
} from "../../core/artifact-quality.mjs";
import { SYNTHESIS_REQUIRED_OUTPUTS } from "../../core/intent/semantic-router.mjs";
import { extractEvidence } from "../../core/policy/evidence-normalizer.mjs";
import { isSafeSvgMarkup } from "../../capabilities/tools/svg-sanitize.mjs";

function isString(value) {
  return typeof value === "string";
}

function validateAgainstSchema(schema, args) {
  if (schema.type !== "object" || typeof args !== "object" || args === null || Array.isArray(args)) {
    return { ok: false, reason: "args must be an object" };
  }

  for (const requiredKey of schema.required ?? []) {
    if (!(requiredKey in args)) {
      return { ok: false, reason: `missing required field: ${requiredKey}` };
    }
  }

  for (const [key, descriptor] of Object.entries(schema.properties ?? {})) {
    if (!(key in args)) {
      continue;
    }
    const value = args[key];

    // empty schema {} means accept anything
    if (!descriptor.type && !descriptor.enum) continue;

    if (descriptor.type === "string" && !isString(value)) {
      return { ok: false, reason: `${key} must be string, got ${typeof value}` };
    }
    if (descriptor.type === "array" && !Array.isArray(value)) {
      return { ok: false, reason: `${key} must be array` };
    }
    if (descriptor.type === "array" && descriptor.items?.type === "string" && !value.every((item) => typeof item === "string")) {
      return { ok: false, reason: `${key} array items must be strings` };
    }
    if (descriptor.type === "integer" && (typeof value !== "number" || !Number.isInteger(value))) {
      return { ok: false, reason: `${key} must be integer` };
    }
    if (descriptor.type === "boolean" && typeof value !== "boolean") {
      return { ok: false, reason: `${key} must be boolean` };
    }
    if (descriptor.enum && !descriptor.enum.includes(value)) {
      return { ok: false, reason: `${key} must be one of: ${descriptor.enum.join(", ")}` };
    }
  }

  return { ok: true };
}

const DOCUMENT_KINDS = new Set(["pptx", "docx", "xlsx", "pdf", "html"]);
const EMAIL_SEND_TOOL_IDS = new Set([
  "account_send_email",
  "send_email_smtp",
  "google.gmail.send_email",
  "microsoft.outlook.send_email"
]);

const NON_USER_CONTENT_TOOL_IDS = new Set([
  "account_list_connected_accounts",
  "connector_catalog_search"
]);

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function bigramSet(value) {
  const text = normalizeText(value);
  const set = new Set();
  for (let i = 0; i < text.length - 1; i += 1) {
    set.add(text.slice(i, i + 2));
  }
  return set;
}

function overlapRatio(a, b) {
  const aSet = bigramSet(a);
  const bSet = bigramSet(b);
  if (aSet.size === 0 || bSet.size === 0) return 0;
  let hits = 0;
  for (const item of aSet) {
    if (bSet.has(item)) hits += 1;
  }
  return hits / Math.min(aSet.size, bSet.size);
}

function taskRequiresSynthesizedSideEffectBody(task = {}) {
  const taskSpec = task?.task_spec ?? {};
  const expected = taskSpec?.synthesis?.expected_output ?? null;
  if (typeof expected === "string" && SYNTHESIS_REQUIRED_OUTPUTS.has(expected)) return true;
  if (taskSpec?.research_quality && typeof taskSpec.research_quality === "object") return true;
  const requiredGroups = taskSpec?.success_contract?.required_policy_groups;
  return Array.isArray(requiredGroups)
    && requiredGroups.includes("external_web_read")
    && requiredGroups.includes("email_send");
}

function transcriptObservations(transcript = []) {
  return (Array.isArray(transcript) ? transcript : [])
    .filter((entry) => (entry?.type === "tool_result" || entry?.type === "tool_call_completed") && entry.success !== false)
    .map((entry) => ({
      tool: String(entry?.tool ?? entry?.name ?? entry?.tool_id ?? ""),
      observation: typeof entry?.observation === "string" ? entry.observation.trim() : ""
    }))
    .filter((entry) => entry.observation);
}

function validateEmailSendContentArgs(args = {}, ctx = {}) {
  if (!taskRequiresSynthesizedSideEffectBody(ctx.task)) return { ok: true };
  const body = typeof args.body === "string" ? args.body.trim()
    : typeof args.text === "string" ? args.text.trim()
      : "";
  if (!body) {
    return { ok: false, error: "email_body_requires_synthesized_content" };
  }

  const observations = transcriptObservations(ctx.transcript);
  if (observations.length === 0) return { ok: true };

  for (const entry of observations) {
    if (!NON_USER_CONTENT_TOOL_IDS.has(entry.tool)) continue;
    if (entry.observation.length >= 24 && body.includes(entry.observation.slice(0, Math.min(160, entry.observation.length)))) {
      return { ok: false, error: "email_body_must_not_include_connector_or_account_logs" };
    }
  }

  const rawTranscript = observations.map((entry) => entry.observation).join("\n\n---\n\n");
  const normalizedBody = normalizeText(body);
  if (body.includes("\n---\n")
      || observations.some((entry) => entry.observation.length >= 120 && normalizedBody === normalizeText(entry.observation))
      || (rawTranscript.length >= 120 && body.includes("---") && overlapRatio(body, rawTranscript) > 0.82)) {
    return { ok: false, error: "email_body_raw_tool_transcript_dump" };
  }

  const evidence = extractEvidence(ctx.transcript);
  if ((evidence.blended_source_count ?? 0) > 0 && body.length < 80) {
    return { ok: false, error: "email_body_requires_synthesized_content" };
  }

  return { ok: true };
}

function normalizeDocumentKind(value) {
  const raw = String(value ?? "").toLowerCase().trim();
  if (raw === "word") return "docx";
  if (raw === "excel") return "xlsx";
  if (raw === "ppt" || raw === "powerpoint") return "pptx";
  return DOCUMENT_KINDS.has(raw) ? raw : "";
}

function documentKindFromPath(value) {
  const ext = path.extname(String(value ?? "")).toLowerCase();
  if (ext === ".pptx") return "pptx";
  if (ext === ".docx") return "docx";
  if (ext === ".xlsx") return "xlsx";
  if (ext === ".pdf") return "pdf";
  if (ext === ".html" || ext === ".htm") return "html";
  return "";
}

function hasNonEmptyOutline(value, depth = 0) {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) {
    return value.some((entry) => hasNonEmptyOutline(entry, depth + 1));
  }
  if (!value || typeof value !== "object" || depth > 5) return false;
  return Object.values(value).some((entry) => hasNonEmptyOutline(entry, depth + 1));
}

function validateGenerateDocumentArgs(args = {}, ctx = {}) {
  const kind = normalizeDocumentKind(args.kind);
  if (!DOCUMENT_KINDS.has(kind)) {
    return {
      ok: false,
      error: "generate_document requires kind to be one of: pptx, docx, xlsx, pdf, html"
    };
  }
  if (!hasNonEmptyOutline(args.outline)) {
    return {
      ok: false,
      error: "generate_document_outline_required"
    };
  }
  const quality = evaluateDocumentOutlineQuality({
    kind,
    outline: args.outline,
    task: ctx.task ?? null
  });
  if (!quality.ok) {
    return {
      ok: false,
      error: formatDocumentQualityError(quality)
    };
  }
  return { ok: true };
}

function validateEditFileArgs(args = {}, ctx = {}) {
  if (typeof args?.path !== "string" || !args.path.trim()) {
    return {
      ok: false,
      error: "edit_file_path_required"
    };
  }

  const kind = normalizeDocumentKind(args.kind) || documentKindFromPath(args.path);
  if (!DOCUMENT_KINDS.has(kind)) {
    return { ok: true };
  }

  const outline = args.outline ?? args.content ?? args.text ?? {};
  if (!hasNonEmptyOutline(outline)) {
    return {
      ok: false,
      error: "edit_file_outline_required"
    };
  }

  const quality = evaluateDocumentOutlineQuality({
    kind,
    outline,
    task: ctx.task ?? null
  });
  if (!quality.ok) {
    return {
      ok: false,
      error: formatDocumentQualityError(quality, "edit_file")
    };
  }
  return { ok: true };
}

function validateRenderDiagramArgs(args = {}) {
  if (typeof args?.code !== "string" || !args.code.trim()) {
    return {
      ok: false,
      error: "render_diagram_code_required"
    };
  }
  return { ok: true };
}

function validateRenderSvgArgs(args = {}) {
  if (!isSafeSvgMarkup(args?.svg ?? args?.markup ?? args?.source ?? "")) {
    return {
      ok: false,
      error: "render_svg_markup_required"
    };
  }
  return { ok: true };
}

export function validateToolCall(tool, args, ctx = {}) {
  if (tool.id === "generate_document") {
    const documentResult = validateGenerateDocumentArgs(args, ctx);
    if (!documentResult.ok) return documentResult;
  }
  if (tool.id === "edit_file") {
    const editResult = validateEditFileArgs(args, ctx);
    if (!editResult.ok) return editResult;
  }
  if (tool.id === "render_diagram") {
    const diagramResult = validateRenderDiagramArgs(args);
    if (!diagramResult.ok) return diagramResult;
  }
  if (tool.id === "render_svg") {
    const svgResult = validateRenderSvgArgs(args);
    if (!svgResult.ok) return svgResult;
  }

  const result = validateAgainstSchema(tool.parameters, args);
  if (!result.ok) {
    return {
      ok: false,
      error: `schema validation failed: ${result.reason}`
    };
  }

  if (EMAIL_SEND_TOOL_IDS.has(tool.id)) {
    const emailResult = validateEmailSendContentArgs(args, ctx);
    if (!emailResult.ok) return emailResult;
  }

  if ((tool.id === "file_op" || tool.id === "open_file" || tool.id === "reveal_in_explorer") && typeof args.path === "string") {
    const normalized = path.normalize(args.path);
    if (normalized.includes("..")) {
      return {
        ok: false,
        error: "path_traversal_blocked"
      };
    }
  }

  if (tool.id === "launch_app" && Array.isArray(ctx.allowedApps) && !ctx.allowedApps.includes(args.app)) {
    return {
      ok: true,
      warning: "launch_app_outside_whitelist"
    };
  }

  return {
    ok: true,
    warning: null
  };
}
