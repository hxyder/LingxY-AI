import path from "node:path";
import { spreadsheetOutlineFromText } from "../../core/spreadsheet-outline.mjs";

const DOCUMENT_KINDS = new Set(["pptx", "docx", "xlsx", "pdf", "html"]);
const TEXT_FILE_KINDS = new Set(["md", "txt", "csv", "json"]);
const KIND_ALIASES = Object.freeze({
  word: "docx",
  excel: "xlsx",
  ppt: "pptx",
  powerpoint: "pptx",
  markdown: "md",
  text: "txt"
});

function taskArtifactKind(taskSpec = {}) {
  return String(taskSpec?.artifact?.kind ?? taskSpec?.contract?.output_contract?.kind ?? "")
    .trim()
    .toLowerCase();
}

function slugFileBase(value = "") {
  const slug = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "artifact";
}

function titleFromTask(task = {}, taskSpec = {}) {
  return String(task?.title ?? task?.user_command ?? taskSpec?.user_goal_text ?? "Document")
    .trim()
    .slice(0, 80) || "Document";
}

function stripRuntimeReviewFooter(value = "") {
  return String(value ?? "")
    .replace(/\n+\s*Accuracy check:[\s\S]*$/u, "")
    .trim();
}

function documentOutlineForKind(kind, finalText, title) {
  if (kind === "xlsx") {
    return spreadsheetOutlineFromText(finalText, { title });
  }
  if (kind === "pptx") {
    return { title, slides: [{ heading: title, body: finalText }] };
  }
  return { title, sections: [{ heading: title, body: finalText }] };
}

export function buildDeterministicArtifactPlan({
  task = {},
  taskSpec = {},
  finalText = "",
  defaultKind = "html"
} = {}) {
  const body = stripRuntimeReviewFooter(finalText);
  if (!body) return { ok: false, reason: "no_final_text" };

  const rawKind = taskArtifactKind(taskSpec);
  const normalizedKind = rawKind ? (KIND_ALIASES[rawKind] ?? rawKind) : defaultKind;
  const kindDefaultApplied = rawKind === "";
  const title = titleFromTask(task, taskSpec);

  if (DOCUMENT_KINDS.has(normalizedKind)) {
    const outline = documentOutlineForKind(normalizedKind, body, title);
    if (normalizedKind === "xlsx" && !outline) {
      return { ok: false, reason: "spreadsheet_outline_required" };
    }
    return {
      ok: true,
      toolId: "generate_document",
      kind: normalizedKind,
      rawKind,
      kindDefaultApplied,
      args: { kind: normalizedKind, outline }
    };
  }

  if (TEXT_FILE_KINDS.has(normalizedKind)) {
    const fileBase = slugFileBase(title);
    return {
      ok: true,
      toolId: "write_file",
      kind: normalizedKind,
      rawKind,
      kindDefaultApplied,
      args: {
        filename: `${fileBase}.${normalizedKind}`,
        content: body,
        overwrite: true
      }
    };
  }

  return { ok: false, reason: `unsupported_kind:${rawKind || normalizedKind}` };
}

export function artifactPlanRelativeName(plan = {}) {
  const filename = plan?.args?.filename;
  return typeof filename === "string" && filename.trim()
    ? path.basename(filename)
    : null;
}
