import { access, stat, writeFile, unlink } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { prepareFileReversibilityCheckpoint } from "./file-reversibility.mjs";
import { renderMermaidScriptTag } from "./mermaid-assets.mjs";
import { sanitizeSvgMarkup } from "./svg-sanitize.mjs";
import { spreadsheetOutlineFromText } from "../../core/spreadsheet-outline.mjs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function resolveDocumentRendererScript() {
  const scriptName = "render-document.ps1";
  const candidates = [
    path.join(process.cwd(), "scripts", scriptName),
    path.resolve(__dirname, "..", "..", "..", "..", "scripts", scriptName),
    process.resourcesPath ? path.join(process.resourcesPath, "scripts", scriptName) : null
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.F_OK);
      return candidate;
    } catch { /* try next */ }
  }
  return candidates[0];
}

export const OUTLINE_KINDS = new Set(["pptx", "docx", "xlsx", "pdf", "html"]);
export const KIND_EXTENSIONS = { pptx: ".pptx", docx: ".docx", xlsx: ".xlsx", pdf: ".pdf", html: ".html" };
export const KIND_MIMES = {
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
  html: "text/html"
};

export function artifactKindFromTarget(targetPath = "") {
  const ext = path.extname(String(targetPath ?? "")).toLowerCase();
  if (ext === ".pptx") return "pptx";
  if (ext === ".docx") return "docx";
  if (ext === ".xlsx") return "xlsx";
  if (ext === ".pdf") return "pdf";
  if (ext === ".md") return "md";
  if (ext === ".txt") return "txt";
  if (ext === ".html" || ext === ".htm") return "html";
  if (ext === ".csv") return "csv";
  if (ext === ".json") return "json";
  return null;
}

function escapeHtmlForDocument(text) {
  return `${text}`
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function writePdfFromHtmlArtifact(htmlPath, pdfPath) {
  const browsers = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  ];

  let browserPath = null;
  for (const candidate of browsers) {
    try {
      await access(candidate, fsConstants.F_OK);
      browserPath = candidate;
      break;
    } catch { /* try next */ }
  }

  if (!browserPath) {
    throw new Error("No Edge/Chrome browser found for PDF conversion.");
  }

  await execFileAsync(browserPath, [
    "--headless",
    "--disable-gpu",
    "--no-sandbox",
    `--print-to-pdf=${pdfPath}`,
    "--print-to-pdf-no-header",
    pathToFileURL(htmlPath).href
  ], {
    encoding: "utf8",
    timeout: 15000,
    maxBuffer: 4 * 1024 * 1024
  });

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const info = await stat(pdfPath);
      if (info.size > 0) return;
    } catch { /* wait for browser to flush the PDF */ }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error("PDF conversion finished but output file was not created.");
}

function coerceOutlineToPlainText(kind, outline) {
  if (typeof outline === "string") return outline;
  if (!outline || typeof outline !== "object") return "";
  if (kind === "pptx") {
    const lines = [];
    if (outline.title) lines.push(String(outline.title));
    if (outline.subtitle) lines.push(String(outline.subtitle));
    lines.push("");
    for (const slide of Array.isArray(outline.slides) ? outline.slides : []) {
      if (slide?.heading) lines.push(`# ${slide.heading}`);
      for (const bullet of Array.isArray(slide?.bullets) ? slide.bullets : []) {
        lines.push(`- ${bullet}`);
      }
      lines.push("");
    }
    return lines.join("\n");
  }
  if (kind === "xlsx") {
    const rows = Array.isArray(outline.rows) ? outline.rows
      : Array.isArray(outline) ? outline
        : [];
    return rows.map((row) => Array.isArray(row) ? row.join("\t") : String(row ?? "")).join("\n");
  }
  // docx / pdf default: flatten sections/headings/body
  const lines = [];
  if (outline.title) lines.push(String(outline.title));
  if (outline.subtitle) lines.push(String(outline.subtitle));
  // Accept either `sections` (canonical) or `slides` (AI sometimes uses pptx
  // shape for docx when the prompt example is ambiguous).
  const sections = Array.isArray(outline.sections) ? outline.sections
    : Array.isArray(outline.slides) ? outline.slides
      : [];
  for (const section of sections) {
    const heading = section?.heading ?? section?.title ?? null;
    if (heading) lines.push(`# ${heading}`);
    // `body` (canonical), `content` or `bullets` array (pptx fallback)
    if (section?.body) {
      lines.push(String(section.body));
    } else if (Array.isArray(section?.bullets)) {
      for (const b of section.bullets) lines.push(`- ${b}`);
    } else if (section?.content) {
      lines.push(String(section.content));
    }
  }
  if (outline.body && sections.length === 0) lines.push(String(outline.body));
  return lines.join("\n");
}

function stripCodeFences(text) {
  return String(text ?? "")
    .replace(/```[a-z0-9_-]*\r?\n?/gi, "")
    .replace(/```/g, "")
    .trim();
}

function tryParseOutlineJson(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const candidates = [value, stripCodeFences(value)];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") return parsed;
    } catch { /* try next */ }
  }
  return null;
}

function heuristicPptxOutlineFromText(text) {
  const lines = stripCodeFences(text).split(/\r?\n/);
  const slides = [];
  let current = null;
  for (const raw of lines) {
    const line = String(raw ?? "").trim();
    if (!line) {
      if (current && (current.heading || current.bullets.length > 0)) {
        slides.push(current);
        current = null;
      }
      continue;
    }
    if (!current) {
      current = { heading: line.replace(/^#+\s*/, ""), bullets: [] };
      continue;
    }
    current.bullets.push(line.replace(/^[-*]\s*/, ""));
  }
  if (current && (current.heading || current.bullets.length > 0)) slides.push(current);
  return {
    title: slides[0]?.heading ?? "Presentation",
    slides: slides.length > 0 ? slides : [{ heading: "Presentation", bullets: [stripCodeFences(text).slice(0, 200)] }]
  };
}

function heuristicSectionOutlineFromText(text) {
  const cleaned = stripCodeFences(text);
  const lines = cleaned.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return { title: "Document", sections: [] };
  return {
    title: lines[0].replace(/^#+\s*/, ""),
    sections: [{ heading: lines[0].replace(/^#+\s*/, ""), body: lines.slice(1).join("\n") || cleaned }]
  };
}

function heuristicXlsxOutlineFromText(text) {
  const structured = spreadsheetOutlineFromText(text);
  if (structured) return structured;
  const rows = stripCodeFences(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\t|,|\|/).map((cell) => cell.trim()).filter(Boolean));
  return rows.some((row) => row.length >= 2) ? { rows } : {};
}

export function normalizeDocumentOutline(kind, outline) {
  if (outline && typeof outline === "object") return outline;
  const parsed = tryParseOutlineJson(outline);
  if (parsed) return parsed;
  const raw = String(outline ?? "").trim();
  if (!raw) return {};
  if (kind === "pptx") return heuristicPptxOutlineFromText(raw);
  if (kind === "xlsx") return heuristicXlsxOutlineFromText(raw);
  return heuristicSectionOutlineFromText(raw);
}

export function previewSidecarPathForArtifact(targetPath) {
  const parsed = path.parse(targetPath);
  return path.join(parsed.dir, `${parsed.name}-preview.html`);
}

async function buildDocumentPreviewHtml(kind, outline, targetPath = "") {
  if (kind === "pdf") {
    return buildPdfHtml(outline);
  }
  const { renderDocumentPreviewHtml } = await import("./document-renderer.mjs");
  return renderDocumentPreviewHtml({
    kind,
    outline,
    title: outline?.title || path.basename(targetPath || `result.${kind}`)
  });
}

export async function writeDocumentPreviewSidecar({ kind, targetPath, outline }) {
  const previewPath = previewSidecarPathForArtifact(targetPath);
  const html = await buildDocumentPreviewHtml(kind, outline, targetPath);
  await writeFile(previewPath, html, "utf8");
  return previewPath;
}

export async function prepareGeneratedDocumentCheckpoint(ctx, targetPath, operation) {
  return prepareFileReversibilityCheckpoint(ctx, {
    toolId: "generate_document",
    targetPath,
    operation
  });
}

export async function invokeDocumentRenderer({ kind, targetPath, outline }) {
  // Try the Node.js renderer first (pptxgenjs / docx / exceljs — styled output).
  try {
    const { renderDocument } = await import("./document-renderer.mjs");
    await renderDocument({ kind, targetPath, outline });
    return;
  } catch (nodeErr) {
    // Fall back to PowerShell bare-XML renderer if the npm packages are missing
    // or if the outline shape confused the Node renderer. We pass the outline
    // text through a UTF-8 temp file rather than a CLI argument: Windows caps
    // command-line length at 8191 chars, and a single long bullet or body
    // paragraph trivially exceeds that. The temp file is deleted in finally.
    const tempFile = path.join(
      os.tmpdir(),
      `lingxy-doc-${crypto.randomBytes(8).toString("hex")}.txt`
    );
    try {
      const scriptPath = await resolveDocumentRendererScript();
      const plainText = coerceOutlineToPlainText(kind, outline);
      await writeFile(tempFile, plainText, "utf8");
      await execFileAsync("powershell", [
        "-NoProfile", "-ExecutionPolicy", "Bypass",
        "-File", scriptPath,
        "-TargetPath", targetPath,
        "-Kind", kind,
        "-TextFile", tempFile
      ], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
    } catch (psErr) {
      throw new Error(`Document render failed (Node: ${nodeErr.message}; PS: ${psErr.message})`);
    } finally {
      await unlink(tempFile).catch(() => { /* best-effort cleanup */ });
    }
  }
}


export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function diagramCodeOf(value) {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  return String(value.code ?? value.mermaid ?? value.source ?? "").trim();
}

function diagramCaptionOf(value) {
  if (!value || typeof value !== "object") return "";
  return String(value.caption ?? value.title ?? "").trim();
}

function sectionDiagrams(section = {}) {
  const diagrams = [];
  if (section.diagram) diagrams.push(section.diagram);
  if (Array.isArray(section.diagrams)) diagrams.push(...section.diagrams);
  return diagrams
    .map((entry) => ({
      code: diagramCodeOf(entry),
      caption: diagramCaptionOf(entry)
    }))
    .filter((entry) => entry.code);
}

function svgMarkupOf(value) {
  if (typeof value === "string") return sanitizeSvgMarkup(value);
  if (!value || typeof value !== "object") return "";
  return sanitizeSvgMarkup(value.svg ?? value.markup ?? value.source ?? "");
}

function svgCaptionOf(value) {
  if (!value || typeof value !== "object") return "";
  return String(value.caption ?? value.title ?? "").trim();
}

function sectionSvgs(section = {}) {
  const svgs = [];
  if (section.svg) svgs.push(section.svg);
  if (Array.isArray(section.svgs)) svgs.push(...section.svgs);
  return svgs
    .map((entry) => ({
      svg: svgMarkupOf(entry),
      caption: svgCaptionOf(entry)
    }))
    .filter((entry) => entry.svg);
}

/**
 * Convert a structured outline (same shape as docx) to a styled HTML document
 * suitable for printing to PDF via headless Chrome.
 * Mermaid code blocks in body text are automatically rendered via mermaid.js.
 */
export function buildPdfHtml(outline) {
  const title    = outline.title    ?? "Document";
  const subtitle = outline.subtitle ?? "";
  const author   = outline.author   ?? "";
  const date     = outline.date     ?? "";

  const sections = Array.isArray(outline.sections) ? outline.sections
    : Array.isArray(outline.slides)                ? outline.slides
    : [];

  const bodyLines = [];

  if (title) {
    bodyLines.push(`<h1 class="doc-title">${escapeHtml(title)}</h1>`);
  }
  if (subtitle) {
    bodyLines.push(`<p class="doc-subtitle">${escapeHtml(subtitle)}</p>`);
  }
  const meta = [author, date].filter(Boolean).join("   ·   ");
  if (meta) {
    bodyLines.push(`<p class="doc-meta">${escapeHtml(meta)}</p>`);
  }
  if (title) {
    bodyLines.push(`<hr class="title-rule">`);
  }

  for (const sec of sections) {
    const heading = sec.heading ?? sec.title;
    if (heading) {
      const tag = sec.level === 2 ? "h3" : "h2";
      bodyLines.push(`<${tag}>${escapeHtml(heading)}</${tag}>`);
    }

    if (sec.body) {
      bodyLines.push(renderBodyWithMermaid(String(sec.body)));
    }

    for (const diagram of sectionDiagrams(sec)) {
      bodyLines.push(renderHtmlDiagram(diagram));
    }

    for (const svg of sectionSvgs(sec)) {
      bodyLines.push(renderHtmlSvg(svg));
    }

    if (Array.isArray(sec.bullets) && sec.bullets.length > 0) {
      bodyLines.push("<ul>");
      for (const b of sec.bullets) {
        bodyLines.push(`  <li>${escapeHtml(String(b))}</li>`);
      }
      bodyLines.push("</ul>");
    }

    if (sec.table && Array.isArray(sec.table.rows)) {
      bodyLines.push(renderHtmlTable(sec.table));
    }
  }

  // Plain body fallback
  if (outline.body && sections.length === 0) {
    bodyLines.push(renderBodyWithMermaid(String(outline.body)));
  }

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${renderMermaidScriptTag()}
<style>
  * { box-sizing: border-box; }
  body {
    font-family: "Segoe UI", "Microsoft YaHei", Calibri, Arial, sans-serif;
    font-size: 11pt; line-height: 1.65; color: #374151;
    max-width: 760px; margin: 0 auto; padding: 40px 48px;
    background: #fff;
  }
  h1.doc-title  { font-size: 26pt; font-weight: 700; color: #1E293B; margin: 0 0 6px; }
  p.doc-subtitle{ font-size: 14pt; color: #64748B; margin: 0 0 4px; }
  p.doc-meta    { font-size: 9pt;  color: #94A3B8; margin: 0 0 12px; }
  hr.title-rule { border: none; border-top: 2px solid #2563EB; margin: 16px 0 28px; }
  h2 { font-size: 16pt; font-weight: 700; color: #1E293B;
       border-bottom: 1px solid #E2E8F0; padding-bottom: 4px;
       margin: 32px 0 10px; }
  h3 { font-size: 13pt; font-weight: 600; color: #374151; margin: 24px 0 8px; }
  p  { margin: 0 0 10px; }
  ul, ol { margin: 6px 0 12px 24px; padding: 0; }
  li { margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; margin: 14px 0 20px; font-size: 10pt; }
  thead tr { background: #1E293B; color: #fff; }
  thead th { padding: 7px 10px; text-align: left; font-weight: 600; }
  tbody tr:nth-child(even) { background: #F8FAFC; }
  tbody td { padding: 6px 10px; border: 1px solid #E2E8F0; vertical-align: top; }
  .mermaid { margin: 16px 0; text-align: center; }
  figure.doc-diagram { margin: 18px 0; }
  figure.doc-diagram figcaption { margin-top: 6px; color: #64748B; font-size: 9pt; text-align: center; }
  figure.doc-svg { margin: 18px 0; text-align: center; }
  figure.doc-svg svg { max-width: 100%; height: auto; }
  figure.doc-svg figcaption { margin-top: 6px; color: #64748B; font-size: 9pt; text-align: center; }
  pre.mermaid-fallback {
    background: #F1F5F9; border: 1px solid #E2E8F0;
    padding: 12px; border-radius: 4px; font-size: 9pt;
    white-space: pre-wrap; color: #475569; margin: 12px 0;
  }
  @media print {
    body { padding: 0; max-width: none; }
    h2 { page-break-after: avoid; }
  }
</style>
</head>
<body>
${bodyLines.join("\n")}
<script>
  if (typeof mermaid !== "undefined") {
    mermaid.initialize({ startOnLoad: true, theme: "default", securityLevel: "loose" });
  } else {
    document.querySelectorAll(".mermaid").forEach(el => {
      const pre = document.createElement("pre");
      pre.className = "mermaid-fallback";
      pre.textContent = el.textContent;
      el.replaceWith(pre);
    });
  }
</script>
</body>
</html>`;
}

/** Wrap ```mermaid...``` blocks; escape everything else. */
function renderBodyWithMermaid(text) {
  const parts = text.split(/(```mermaid[\s\S]*?```)/g);
  return parts.map(part => {
    const m = part.match(/^```mermaid\n?([\s\S]*?)```$/);
    if (m) {
      return `<div class="mermaid">${escapeHtml(m[1].trim())}</div>`;
    }
    // Regular text: split by double newline → paragraphs
    return part.split(/\n\n+/).map(p => {
      const t = p.replace(/\n/g, " ").trim();
      return t ? `<p>${escapeHtml(t)}</p>` : "";
    }).filter(Boolean).join("\n");
  }).join("\n");
}

function renderHtmlDiagram(diagram) {
  const caption = diagram.caption
    ? `<figcaption>${escapeHtml(diagram.caption)}</figcaption>`
    : "";
  return `<figure class="doc-diagram"><div class="mermaid">${escapeHtml(diagram.code)}</div>${caption}</figure>`;
}

function renderHtmlSvg(svg) {
  const caption = svg.caption
    ? `<figcaption>${escapeHtml(svg.caption)}</figcaption>`
    : "";
  return `<figure class="doc-svg">${svg.svg}${caption}</figure>`;
}

function renderHtmlTable(table) {
  const headers = Array.isArray(table.headers) ? table.headers : [];
  const rows    = Array.isArray(table.rows)    ? table.rows    : [];
  const lines   = ['<table class="doc-table">'];
  if (headers.length) {
    lines.push("  <thead><tr>");
    for (const h of headers) lines.push(`    <th>${escapeHtml(String(h ?? ""))}</th>`);
    lines.push("  </tr></thead>");
  }
  lines.push("  <tbody>");
  for (const row of rows) {
    lines.push("  <tr>");
    const cells = Array.isArray(row) ? row : [row];
    for (const c of cells) lines.push(`    <td>${escapeHtml(String(c ?? ""))}</td>`);
    lines.push("  </tr>");
  }
  lines.push("  </tbody></table>");
  return lines.join("\n");
}

