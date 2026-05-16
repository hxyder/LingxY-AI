import path from "node:path";
import { spreadsheetOutlineFromText } from "../../core/spreadsheet-outline.mjs";

const DOCUMENT_KINDS = new Set(["pptx", "docx", "xlsx", "pdf", "html"]);
const TEXT_FILE_KINDS = new Set(["md", "txt", "csv", "json"]);
const RAW_HTML_FILE_KINDS = new Set(["html", "htm"]);
const KIND_ALIASES = Object.freeze({
  word: "docx",
  excel: "xlsx",
  ppt: "pptx",
  powerpoint: "pptx",
  markdown: "md",
  text: "txt"
});
const REVIEW_REJECTION_PATTERNS = [
  /这次任务没有可靠完成/u,
  /This task did not complete reliably/u
];

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

function requestTextFromTask(task = {}, taskSpec = {}) {
  return String(task?.user_command ?? taskSpec?.user_goal_text ?? task?.title ?? "")
    .trim();
}

function stripRuntimeReviewFooter(value = "") {
  return String(value ?? "")
    .replace(/\n+\s*Accuracy check:[\s\S]*$/u, "")
    .trim();
}

function isRuntimeReviewRejection(value = "") {
  return REVIEW_REJECTION_PATTERNS.some((pattern) => pattern.test(String(value ?? "")));
}

function escapeHtml(value = "") {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function dedupe(values = []) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const item = String(value ?? "").trim();
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function extractExplicitLiterals(text = "") {
  const raw = String(text ?? "");
  const literals = [];
  for (const match of raw.matchAll(/["'`“”‘’]([^"'`“”‘’]{2,160})["'`“”‘’]/gu)) {
    literals.push(match[1]);
  }
  for (const match of raw.matchAll(/\b[A-Z][A-Z0-9_]*(?:-[A-Z0-9_]+)+\b/gu)) {
    literals.push(match[0]);
  }
  return dedupe(literals).slice(0, 8);
}

function filenamePatternForKind(kind = "") {
  const normalized = String(kind ?? "").toLowerCase();
  if (normalized === "html" || normalized === "htm") {
    return /([^\s"'“”‘’()（）<>|:*?]+\.html?)(?=$|[\s"'“”‘’),，。；;])/iu;
  }
  return new RegExp(`([^\\s"'“”‘’()（）<>|:*?]+\\.${normalized})(?=$|[\\s"'“”‘’),，。；;])`, "iu");
}

function requestedFilenameFromText(text = "", kind = "") {
  const pattern = filenamePatternForKind(kind);
  const match = pattern.exec(String(text ?? ""));
  return match?.[1] ? path.basename(match[1]) : null;
}

function resolvedOutputPathFromTranscript(transcript = []) {
  for (let i = transcript.length - 1; i >= 0; i -= 1) {
    const entry = transcript[i];
    if (entry?.tool !== "resolve_output_path" || entry?.success === false) continue;
    const metadataPath = entry?.metadata?.path ?? entry?.result?.metadata?.path;
    if (typeof metadataPath === "string" && metadataPath.trim()) return metadataPath.trim();
    const observation = String(entry?.observation ?? entry?.result?.observation ?? "");
    const match = /Resolved output path:\s*(.+)$/imu.exec(observation);
    if (match?.[1]) return match[1].trim();
  }
  return null;
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

function htmlFileContent({ requestText, finalText, title }) {
  const body = stripRuntimeReviewFooter(finalText);
  const usefulBody = body && !isRuntimeReviewRejection(body)
    ? body
    : "Generated HTML artifact.";
  const literals = extractExplicitLiterals(requestText);
  const literalLine = literals.join(" ");
  const htmlTitle = literalLine || title || "HTML Artifact";
  const bodyParts = dedupe([literalLine, usefulBody]);
  const paragraphs = bodyParts.length > 0 ? bodyParts : ["Generated HTML artifact."];
  return [
    "<!doctype html>",
    "<html lang=\"zh-CN\">",
    "<head>",
    "  <meta charset=\"utf-8\">",
    "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    `  <title>${escapeHtml(htmlTitle)}</title>`,
    "</head>",
    "<body>",
    ...paragraphs.map((paragraph) => `  <p>${escapeHtml(paragraph)}</p>`),
    "</body>",
    "</html>"
  ].join("\n");
}

export function buildDeterministicArtifactPlan({
  task = {},
  taskSpec = {},
  finalText = "",
  transcript = [],
  defaultKind = "html"
} = {}) {
  const body = stripRuntimeReviewFooter(finalText);
  if (!body) return { ok: false, reason: "no_final_text" };

  const rawKind = taskArtifactKind(taskSpec);
  const normalizedKind = rawKind ? (KIND_ALIASES[rawKind] ?? rawKind) : defaultKind;
  const kindDefaultApplied = rawKind === "";
  const title = titleFromTask(task, taskSpec);
  const requestText = requestTextFromTask(task, taskSpec);
  const requestedFilename = requestedFilenameFromText(requestText, normalizedKind);
  const resolvedOutputPath = Array.isArray(transcript)
    ? resolvedOutputPathFromTranscript(transcript)
    : null;

  if (RAW_HTML_FILE_KINDS.has(normalizedKind) && requestedFilename) {
    return {
      ok: true,
      toolId: "write_file",
      kind: "html",
      rawKind,
      kindDefaultApplied,
      args: {
        ...(resolvedOutputPath ? { path: resolvedOutputPath } : { filename: requestedFilename }),
        content: htmlFileContent({ requestText, finalText: body, title }),
        overwrite: true
      }
    };
  }

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
