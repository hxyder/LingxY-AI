import path from "node:path";
import {
  evaluateDocumentOutlineQuality,
  formatDocumentQualityError
} from "../../core/artifact-quality.mjs";
import { isSafeSvgMarkup } from "../../action_tools/tools/svg-sanitize.mjs";

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

const DOCUMENT_KINDS = new Set(["pptx", "docx", "xlsx", "pdf"]);

function hasNonEmptyOutline(value, depth = 0) {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) {
    return value.some((entry) => hasNonEmptyOutline(entry, depth + 1));
  }
  if (!value || typeof value !== "object" || depth > 5) return false;
  return Object.values(value).some((entry) => hasNonEmptyOutline(entry, depth + 1));
}

function validateGenerateDocumentArgs(args = {}, ctx = {}) {
  const kind = String(args.kind ?? "").toLowerCase().trim();
  if (!DOCUMENT_KINDS.has(kind)) {
    return {
      ok: false,
      error: "generate_document requires kind to be one of: pptx, docx, xlsx, pdf"
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
