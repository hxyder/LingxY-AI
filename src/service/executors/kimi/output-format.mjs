import { access, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { extractPureLaunchApp } from "../../core/router/fast-path-router.mjs";
import { renderMermaidScriptTag } from "../../action_tools/tools/mermaid-assets.mjs";
import { sanitizeHtml } from "../../preview/providers/markdown.mjs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function stripCodeFences(text) {
  return `${text}`
    .replace(/```[a-z0-9_-]*\r?\n?/gi, "")
    .replace(/```/g, "")
    .trim();
}

function stripMarkdownSyntax(text) {
  return stripCodeFences(text)
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function escapeHtml(text) {
  return `${text}`
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function previewSidecarPath(outputPath) {
  const parsed = path.parse(outputPath);
  return path.join(parsed.dir, `${parsed.name}-preview.html`);
}

async function writeStructuredPreviewHtml({ kind, outputPath, outline = null, plainText = "" }) {
  const previewPath = previewSidecarPath(outputPath);
  let html = "";
  if (outline) {
    const { renderDocumentPreviewHtml } = await import("../../action_tools/tools/document-renderer.mjs");
    html = renderDocumentPreviewHtml({ kind, outline, title: path.basename(outputPath) });
  } else {
    html = await renderMarkdownDocumentHtml(plainText || "(empty)", {
      title: path.basename(outputPath)
    });
  }
  await writeFile(previewPath, `${html}\n`, "utf8");
  return previewPath;
}

function escapeCsvCell(text) {
  return `"${`${text}`.replace(/"/g, "\"\"")}"`;
}

function wantsFileOutput(normalized) {
  return /(?:保存|存为|导出|生成文件|生成报告|写入文件|输出到文件|save\s+(?:as|to)|export|generate\s+(?:a\s+)?(?:file|report|document)|write\s+to|output\s+(?:as|to)\s+file)/i.test(normalized);
}

function wantsExplicitFormat(normalized) {
  return /(?:\.docx|\.html|\.json|\.csv|\.txt|\.md|\.pptx|docx|word|html|json|csv|pptx|powerpoint|\bppt\b|幻灯片|演示(?:文稿|文档)?|slides?|slideshow|纯文本|文本文件|网页格式|网页文件|表格文件|逗号分隔|文档格式|word文档|word文件|markdown)/i.test(normalized);
}

function isConversationalIntent(normalized) {
  if (wantsExplicitFormat(normalized) || wantsFileOutput(normalized)) {
    return false;
  }
  return true;
}

function descriptorForFormat(id = "conversational") {
  switch (id) {
    case "docx":
      return {
        id: "docx",
        extension: ".docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        primaryRequirement: "word_document",
        promptInstruction: "Return clean structured plain text suitable for saving into a Word document."
      };
    case "html":
      return {
        id: "html",
        extension: ".html",
        mimeType: "text/html",
        primaryRequirement: "html_document",
        promptInstruction: "Return a complete HTML fragment or document only."
      };
    case "json":
      return {
        id: "json",
        extension: ".json",
        mimeType: "application/json",
        primaryRequirement: "json_file",
        promptInstruction: "Return valid JSON only."
      };
    case "csv":
      return {
        id: "csv",
        extension: ".csv",
        mimeType: "text/csv",
        primaryRequirement: "csv_file",
        promptInstruction: "Return CSV content only."
      };
    case "pdf":
      return {
        id: "pdf",
        extension: ".pdf",
        mimeType: "application/pdf",
        primaryRequirement: "pdf_document",
        promptInstruction: "Return a well-structured HTML document suitable for printing to PDF. Use clean headings, paragraphs, and tables."
      };
    case "xlsx":
      return {
        id: "xlsx",
        extension: ".xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        primaryRequirement: "excel_spreadsheet",
        promptInstruction: "Return clean structured plain text suitable for saving into an Excel spreadsheet. Use one line per row, separate columns with tabs."
      };
    case "pptx":
      return {
        id: "pptx",
        extension: ".pptx",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        primaryRequirement: "pptx_presentation",
        promptInstruction: "Return a JSON outline with shape: { \"title\": string, \"subtitle\": string?, \"slides\": [{ \"heading\": string, \"bullets\": [string] }] }. Do not wrap in code fences. The generator will produce a real .pptx file from this outline."
      };
    case "txt":
      return {
        id: "txt",
        extension: ".txt",
        mimeType: "text/plain",
        primaryRequirement: "plain_text_report",
        promptInstruction: "Return plain text only, without markdown syntax."
      };
    case "markdown":
      return {
        id: "markdown",
        extension: ".md",
        mimeType: "text/markdown",
        primaryRequirement: "markdown_report",
        promptInstruction: "Return a complete markdown report."
      };
    default:
      return {
        id: "conversational",
        extension: null,
        mimeType: "text/plain",
        primaryRequirement: "inline_response",
        promptInstruction: "Reply concisely and directly. Do not wrap your answer in code fences or markdown formatting."
      };
  }
}

function detectRequestedOutputFormat(userCommand = "") {
  const normalized = `${userCommand}`.toLowerCase();

  if (/(?:\.docx|docx|word\s*文档|word\s*文件|word\b|文档格式)/i.test(normalized)) return descriptorForFormat("docx");
  if (/(?:\.html|html|网页格式|网页文件)/i.test(normalized)) return descriptorForFormat("html");
  if (/(?:\.json|json)/i.test(normalized)) return descriptorForFormat("json");
  if (/(?:\.csv|csv|逗号分隔)/i.test(normalized)) return descriptorForFormat("csv");
  if (/(?:\.pdf|pdf|导出\s*pdf)/i.test(normalized)) return descriptorForFormat("pdf");
  if (/(?:\.xlsx|xlsx|excel|电子表格|表格文件|spreadsheet)/i.test(normalized)) return descriptorForFormat("xlsx");
  if (/(?:\.pptx|pptx|powerpoint|\bppt\b|幻灯片|演示(?:文稿|文档)?|slides?|slideshow)/i.test(normalized)) return descriptorForFormat("pptx");
  if (/(?:\.txt|txt|纯文本|文本文件)/i.test(normalized)) return descriptorForFormat("txt");
  if (isConversationalIntent(normalized)) return descriptorForFormat("conversational");
  return descriptorForFormat("markdown");
}

function detectRequestedOutputFormatForTask(task = {}) {
  if (task?.task_spec?.goal === "launch_and_act"
      && task?.task_spec?.artifact?.required !== true) {
    return descriptorForFormat("conversational");
  }
  if (extractPureLaunchApp(task?.user_command ?? "")
      && task?.task_spec?.artifact?.required !== true) {
    return descriptorForFormat("conversational");
  }

  const detected = detectRequestedOutputFormat(task?.user_command ?? "");
  if (detected.id !== "conversational") return detected;

  const artifactKind = task?.task_spec?.artifact?.kind ?? null;
  const noteIntent = task?.context_packet?.source_type === "audio_note"
    || task?.context_packet?.source_app === "uca.note"
    || task?.task_spec?.intent_tags?.includes?.("note_capture");

  if (artifactKind === "md" || noteIntent) return descriptorForFormat("markdown");
  if (artifactKind === "docx") return descriptorForFormat("docx");
  if (artifactKind === "pdf") return descriptorForFormat("pdf");
  if (artifactKind === "pptx") return descriptorForFormat("pptx");
  if (artifactKind === "xlsx") return descriptorForFormat("xlsx");
  if (artifactKind === "html") return descriptorForFormat("html");
  if (artifactKind === "csv") return descriptorForFormat("csv");
  if (artifactKind === "txt") return descriptorForFormat("txt");
  return detected;
}

function coerceJson(text) {
  const candidate = stripCodeFences(text);
  try {
    return JSON.stringify(JSON.parse(candidate), null, 2);
  } catch {
    return JSON.stringify({ response: stripMarkdownSyntax(text) }, null, 2);
  }
}

function coerceCsv(text) {
  const candidate = stripCodeFences(text);
  if (candidate.includes(",") && candidate.split(/\r?\n/).length > 1) {
    return candidate.trim();
  }
  return `response\n${escapeCsvCell(stripMarkdownSyntax(text))}\n`;
}

function extractMarkdownTitle(text = "") {
  const heading = String(text ?? "").match(/^\s*#\s+(.+)$/m);
  if (heading?.[1]) return heading[1].trim();
  const firstLine = String(text ?? "").split(/\r?\n/).find((line) => line.trim());
  return firstLine ? stripMarkdownSyntax(firstLine).slice(0, 80) : "UCA Result";
}

async function renderMarkdownDocumentHtml(text, { title = "" } = {}) {
  const source = String(text ?? "");
  const { marked } = await import("marked");
  marked.setOptions({ breaks: true, gfm: true });
  const bodyHtml = sanitizeHtml(marked.parse(source));
  const hasMermaid = /```mermaid\b/i.test(source);
  const resolvedTitle = title || extractMarkdownTitle(source);
  return [
    "<!doctype html>",
    "<html lang=\"zh-CN\">",
    "  <head>",
    "    <meta charset=\"utf-8\">",
    "    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    `    <title>${escapeHtml(resolvedTitle)}</title>`,
    hasMermaid ? `    ${renderMermaidScriptTag()}` : "",
    "    <style>",
    "      body{margin:0;background:#f8fafc;color:#1f2937;font:15px/1.7 \"Segoe UI\",\"Microsoft YaHei\",Arial,sans-serif;}",
    "      main{max-width:860px;margin:0 auto;padding:44px 52px;background:#fff;min-height:100vh;}",
    "      h1{font-size:30px;line-height:1.25;margin:0 0 18px;color:#111827;} h2{font-size:22px;margin:30px 0 10px;border-bottom:1px solid #e5e7eb;padding-bottom:6px;}",
    "      h3{font-size:18px;margin:22px 0 8px;} p{margin:0 0 12px;} ul,ol{margin:8px 0 16px 24px;padding:0;} li{margin:4px 0;}",
    "      table{width:100%;border-collapse:collapse;margin:16px 0 22px;font-size:14px;} th,td{border:1px solid #e5e7eb;padding:8px 10px;text-align:left;vertical-align:top;} th{background:#111827;color:#fff;} tr:nth-child(even) td{background:#f9fafb;}",
    "      code{background:#f3f4f6;border-radius:4px;padding:1px 4px;} pre{background:#111827;color:#e5e7eb;border-radius:8px;padding:14px;overflow:auto;} blockquote{border-left:3px solid #93c5fd;margin:14px 0;padding:4px 0 4px 14px;color:#4b5563;}",
    "      .mermaid{margin:18px 0;text-align:center;} pre.mermaid-fallback{background:#f1f5f9;color:#475569;border:1px solid #e2e8f0;white-space:pre-wrap;}",
    "    </style>",
    "  </head>",
    "  <body>",
    `    <main>${bodyHtml}</main>`,
    hasMermaid
      ? "    <script>if(typeof mermaid!==\"undefined\"){mermaid.initialize({startOnLoad:true,theme:\"default\",securityLevel:\"loose\"});}</script>"
      : "",
    "  </body>",
    "</html>"
  ].filter(Boolean).join("\n");
}

async function coerceHtml(text) {
  const candidate = stripCodeFences(text).trim();
  if (/<html[\s>]|<body[\s>]|<main[\s>]|<section[\s>]|<article[\s>]/i.test(candidate)) {
    return candidate;
  }
  return renderMarkdownDocumentHtml(text);
}

async function writePdfFromHtml(htmlPath, pdfPath) {
  // try Edge first (available on all Windows 10/11), then Chrome
  const browsers = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  ];

  let browserPath = null;
  for (const candidate of browsers) {
    try {
      const { statSync } = await import("node:fs");
      if (statSync(candidate).isFile()) { browserPath = candidate; break; }
    } catch { /* not found */ }
  }

  if (!browserPath) {
    throw new Error("No browser found for PDF conversion");
  }

  const fileUrl = `file:///${htmlPath.replace(/\\/g, "/").replace(/^\//, "")}`;
  await execFileAsync(browserPath, [
    "--headless",
    "--disable-gpu",
    "--no-sandbox",
    `--print-to-pdf=${pdfPath}`,
    "--print-to-pdf-no-header",
    fileUrl
  ], { encoding: "utf8", timeout: 15000 });
}

async function resolveDocumentRendererScript() {
  const scriptName = "render-document.ps1";
  const candidates = [
    path.join(process.cwd(), "scripts", scriptName),
    path.resolve(__dirname, "..", "..", "..", "..", "scripts", scriptName),
    process.resourcesPath ? path.join(process.resourcesPath, "scripts", scriptName) : null
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next known launch layout.
    }
  }

  return candidates[0];
}

async function writeDocxArtifact(targetPath, plainText) {
  const scriptPath = await resolveDocumentRendererScript();
  await execFileAsync(
    "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-TargetPath",
      targetPath,
      "-Kind",
      "docx",
      "-Text",
      plainText
    ],
    {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024
    }
  );
}

async function writeXlsxArtifact(targetPath, plainText) {
  const scriptPath = await resolveDocumentRendererScript();
  await execFileAsync(
    "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-TargetPath",
      targetPath,
      "-Kind",
      "xlsx",
      "-Text",
      plainText
    ],
    {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024
    }
  );
}

function parsePptxOutlineFromText(text) {
  const stripped = stripCodeFences(text);
  try {
    const parsed = JSON.parse(stripped);
    if (parsed && typeof parsed === "object") return parsed;
  } catch { /* not JSON — fall through to heuristic parse */ }

  // Heuristic: treat each `# heading` or blank-line block as a new slide,
  // with `-` bullets beneath. This lets planners that forget to return JSON
  // still produce a readable pptx.
  const lines = stripMarkdownSyntax(text).split(/\r?\n/);
  const slides = [];
  let current = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (current) { slides.push(current); current = null; }
      continue;
    }
    if (!current) {
      current = { heading: line, bullets: [] };
    } else {
      current.bullets.push(line);
    }
  }
  if (current) slides.push(current);
  return {
    title: slides[0]?.heading ?? "UCA Presentation",
    slides: slides.length > 0 ? slides : [{ heading: "UCA Presentation", bullets: [stripMarkdownSyntax(text).slice(0, 200)] }]
  };
}

function renderPptxOutlineToPlainText(outline) {
  const blocks = [];
  if (outline.title) blocks.push(String(outline.title));
  if (outline.subtitle) blocks.push(String(outline.subtitle));
  for (const slide of Array.isArray(outline.slides) ? outline.slides : []) {
    const parts = [];
    if (slide?.heading) parts.push(String(slide.heading));
    for (const bullet of Array.isArray(slide?.bullets) ? slide.bullets : []) {
      parts.push(`- ${bullet}`);
    }
    if (parts.length > 0) blocks.push(parts.join("\n"));
  }
  return blocks.join("\n\n").trim() || "UCA generated pptx (empty).";
}

async function writePptxArtifact(targetPath, plainText) {
  const scriptPath = await resolveDocumentRendererScript();
  await execFileAsync(
    "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-TargetPath",
      targetPath,
      "-Kind",
      "pptx",
      "-Text",
      plainText
    ],
    {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024
    }
  );
}

export function choosePreviewArtifactPath(artifacts = []) {
  const previewableExtensions = [".md", ".txt", ".json", ".csv", ".html", ".htm"];
  return artifacts.find((artifact) => previewableExtensions.includes(path.extname(artifact.path).toLowerCase()))?.path ?? null;
}

export async function writeRequestedArtifacts({
  assistantText,
  outputDir,
  requestedFormat,
  preferredFileName = null
}) {
  const artifacts = [];
  const baseText = assistantText?.trim() || "UCA completed without returning content.";

  if (requestedFormat.id === "docx") {
    const docxPath = path.join(outputDir, "result.docx");
    const previewPath = path.join(outputDir, "result-preview.txt");
    const previewText = stripMarkdownSyntax(baseText) || "UCA completed without returning content.";
    await writeDocxArtifact(docxPath, previewText);
    await writeFile(previewPath, `${previewText}\n`, "utf8");
    await writeStructuredPreviewHtml({ kind: "docx", outputPath: docxPath, plainText: previewText });
    artifacts.push(
      { path: docxPath, mime_type: requestedFormat.mimeType },
      { path: previewPath, mime_type: "text/plain" }
    );
    return artifacts;
  }

  if (requestedFormat.id === "pdf") {
    // generate HTML first, then convert to PDF via PowerShell
    const htmlContent = await coerceHtml(baseText);
    const htmlPath = path.join(outputDir, "result.html");
    const pdfPath = path.join(outputDir, "result.pdf");
    await writeFile(htmlPath, `${htmlContent}\n`, "utf8");
    await writeStructuredPreviewHtml({ kind: "pdf", outputPath: pdfPath, plainText: stripMarkdownSyntax(baseText) });

    try {
      await writePdfFromHtml(htmlPath, pdfPath);
      artifacts.push({ path: pdfPath, mime_type: "application/pdf" });
    } catch {
      // PDF conversion failed — deliver HTML instead
      artifacts.push({ path: htmlPath, mime_type: "text/html" });
    }
    return artifacts;
  }

  if (requestedFormat.id === "xlsx") {
    const xlsxPath = path.join(outputDir, "result.xlsx");
    const previewPath = path.join(outputDir, "result-preview.txt");
    const previewText = stripMarkdownSyntax(baseText) || "UCA completed without returning content.";
    await writeXlsxArtifact(xlsxPath, previewText);
    await writeFile(previewPath, `${previewText}\n`, "utf8");
    await writeStructuredPreviewHtml({ kind: "xlsx", outputPath: xlsxPath, plainText: previewText });
    artifacts.push(
      { path: xlsxPath, mime_type: requestedFormat.mimeType },
      { path: previewPath, mime_type: "text/plain" }
    );
    return artifacts;
  }

  if (requestedFormat.id === "pptx") {
    const pptxPath = path.join(outputDir, "result.pptx");
    const previewPath = path.join(outputDir, "result-preview.txt");
    const outline = parsePptxOutlineFromText(baseText);
    const plainText = renderPptxOutlineToPlainText(outline);
    await writePptxArtifact(pptxPath, plainText);
    await writeFile(previewPath, `${plainText}\n`, "utf8");
    await writeStructuredPreviewHtml({ kind: "pptx", outputPath: pptxPath, outline, plainText });
    artifacts.push(
      { path: pptxPath, mime_type: requestedFormat.mimeType },
      { path: previewPath, mime_type: "text/plain" }
    );
    return artifacts;
  }

  const safePreferredName = typeof preferredFileName === "string"
    ? path.basename(preferredFileName).replace(/[<>:"/\\|?*]/g, "_").trim()
    : "";
  const fileName = safePreferredName
    || (requestedFormat.id === "markdown" ? "report.md" : `result${requestedFormat.extension}`);
  const targetPath = path.join(outputDir, fileName);

  let renderedText = baseText;
  if (requestedFormat.id === "txt") {
    renderedText = stripMarkdownSyntax(baseText);
  } else if (requestedFormat.id === "json") {
    renderedText = coerceJson(baseText);
  } else if (requestedFormat.id === "csv") {
    renderedText = coerceCsv(baseText);
  } else if (requestedFormat.id === "html") {
    renderedText = await coerceHtml(baseText);
  }

  await writeFile(targetPath, `${renderedText.trim()}\n`, "utf8");
  artifacts.push({
    path: targetPath,
    mime_type: requestedFormat.mimeType
  });

  return artifacts;
}

export { detectRequestedOutputFormat, detectRequestedOutputFormatForTask };
