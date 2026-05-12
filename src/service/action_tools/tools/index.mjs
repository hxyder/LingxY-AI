import { mkdir, writeFile, readFile, lstat, stat, readdir, access, unlink } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ACTION_TOOL_SCHEMAS } from "../../capabilities/schemas/index.mjs";
import { createActionResult } from "../../capabilities/registry/types.mjs";
import { translateText } from "../../translation/free-translator.mjs";
import { searchWeb, formatResultsForAssistant, normalizeSearchRecency } from "../../search/free-search.mjs";
import { CONNECTOR_ACTION_TOOLS } from "../../capabilities/connectors/tools/action-tool-aggregator.mjs";
import { MEMORY_TOOLS } from "../../capabilities/tools/memory-tools.mjs";
import { TRANSLATE_TEXT_TOOL, WEB_SEARCH_FETCH_TOOL, FETCH_URL_CONTENT_TOOL, OPEN_URL_TOOL, WEB_SEARCH_TOOL } from "../../capabilities/tools/browser-web-tools.mjs";
import { OPEN_FILE_TOOL, REVEAL_IN_EXPLORER_TOOL, FILE_OP_TOOL, COPY_TO_CLIPBOARD_TOOL, READ_CLIPBOARD_TOOL, NOTIFY_TOOL } from "../../capabilities/tools/os-app-tools.mjs";
import { COMPOSE_EMAIL_TOOL, SEND_EMAIL_SMTP_TOOL } from "../../capabilities/tools/email-tools.mjs";
import { CREATE_SCHEDULED_TASK_TOOL, LIST_SCHEDULED_TASKS_TOOL, DELETE_SCHEDULED_TASK_TOOL, PAUSE_SCHEDULED_TASK_TOOL } from "../../capabilities/tools/scheduler-tools.mjs";
import { STAT_FILE_TOOL, VERIFY_FILE_EXISTS_TOOL, LIST_FILES_TOOL, GLOB_FILES_TOOL, FIND_RECENT_FILES_TOOL, GET_LATEST_ARTIFACT_TOOL } from "../../capabilities/tools/file-read-tools.mjs";
import { VISION_ANALYZE_TOOL } from "../../capabilities/tools/vision-analyze.mjs";
import { TAKE_SCREENSHOT_TOOL, GUI_FIND_ELEMENT_TOOL, GUI_CLICK_TOOL, GUI_TYPE_TEXT_TOOL } from "../../capabilities/tools/desktop-capture-gui-tools.mjs";
import { LAUNCH_APP_TOOL } from "../../capabilities/tools/desktop-launch-tools.mjs";
import { READ_FILE_TEXT_TOOL, READ_FOLDER_TEXT_TOOL, SEARCH_FILE_CONTENT_TOOL, INDEX_FILE_CONTENT_TOOL, REGISTER_ARTIFACT_TOOL, RESOLVE_OUTPUT_PATH_TOOL } from "../../capabilities/tools/file-content-tools.mjs";
import { renderMermaidScriptTag } from "../../capabilities/tools/mermaid-assets.mjs";
import { sanitizeSvgMarkup } from "../../capabilities/tools/svg-sanitize.mjs";
import { buildSideEffectContract } from "../../core/policy/side-effect-contracts.mjs";
import {
  applyCapabilityInterviewAnswer,
  buildCapabilityDraft,
  buildCapabilityInterviewState,
  buildCapabilityRecoveryProposal,
  discardCapabilityInterviewState,
  validateCapabilityDraft
} from "../../core/capability-creator/index.mjs";
import { resolveMcpDraftsDir } from "../../capabilities/mcp/drafts.mjs";
import { createEditableSkill, slugifySkillId } from "../../capabilities/skills/lifecycle.mjs";
import {
  PREVIEW_SKILL_FROM_GITHUB_TOOL,
  INSTALL_SKILL_FROM_GITHUB_TOOL
} from "../../capabilities/tools/skill-install-tools.mjs";
import { prepareFileReversibilityCheckpoint } from "../../capabilities/tools/file-reversibility.mjs";
import { spreadsheetOutlineFromText } from "../../core/spreadsheet-outline.mjs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export {
  createLaunchAmbiguityResult,
  normalizeLaunchCandidates
} from "../../capabilities/tools/desktop-launch-tools.mjs";

/* ------------------------------------------------------------------------ */
/* UCA-049 commit 2: universal tool belt                                     */
/*                                                                           */
/*   - write_file:        sandbox-checked file writing                       */
/*   - run_script:        whitelisted language execution with timeout        */
/*   - generate_document: pptx / docx / xlsx / pdf / html via render-document */
import { resolveOutputDirForTool, ensureOutputDir, configuredWritableArtifactRoots, resolveSandboxedTarget } from "../../core/artifact-path-helper.mjs";
async function resolveEditableTargetForEdit(ctx, targetArg) {
  const outputDir = await ensureOutputDir(resolveOutputDirForTool(ctx));
  if (!path.isAbsolute(targetArg)) {
    return resolveSandboxedTarget(outputDir, targetArg);
  }

  const absTarget = path.resolve(targetArg);
  const allowedRoots = [
    ctx?.runtime?.paths?.outputsDir,
    ctx?.runtime?.configStore?.load?.()?.output?.defaultDir,
    path.join(os.homedir(), "Desktop", "UCA"),
    outputDir
  ]
    .filter(Boolean)
    .map((candidate) => path.resolve(candidate));

  const withinAllowedRoot = allowedRoots.some((root) =>
    absTarget === root || absTarget.startsWith(root + path.sep)
  );
  if (!withinAllowedRoot) {
    throw new Error(`path escapes editable artifact roots: ${targetArg}`);
  }
  const info = await lstat(absTarget);
  if (info.isSymbolicLink()) {
    throw new Error(`target path is a symlink: ${targetArg}`);
  }
  return absTarget;
}

function decodeWriteFileContent({ content, text, encoding }) {
  const raw = typeof content === "string" ? content
    : typeof text === "string" ? text
      : "";
  const enc = (encoding || "utf8").toLowerCase();
  if (enc === "utf8" || enc === "utf-8") {
    return Buffer.from(raw, "utf8");
  }
  if (enc === "base64") {
    return Buffer.from(raw, "base64");
  }
  throw new Error(`unsupported encoding: ${encoding}`);
}

export const WRITE_FILE_TOOL = {
  id: "write_file",
  name: "Write File",
  description: "Write text or base64-encoded content to a file inside the task workspace. Rejects '..' segments and symlink escapes.",
  parameters: ACTION_TOOL_SCHEMAS.write_file,
  risk_level: "medium",
  required_capabilities: ["file_write"],
  requires_confirmation: false,
  async execute(args = {}, ctx = {}) {
    const outputDir = await ensureOutputDir(resolveOutputDirForTool(ctx));
    const targetArg = args.path ?? args.filename ?? "";
    try {
      const absTarget = await resolveSandboxedTarget(outputDir, targetArg, {
        allowedRoots: configuredWritableArtifactRoots(ctx)
      });
      if (!args.overwrite) {
        try {
          await access(absTarget, fsConstants.F_OK);
          return createActionResult({
            success: false,
            observation: `File already exists at ${path.relative(outputDir, absTarget)}; pass overwrite:true to replace it.`,
            metadata: { tool_id: "write_file", path: absTarget }
          });
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
      }
      await mkdir(path.dirname(absTarget), { recursive: true });
      const buffer = decodeWriteFileContent(args);
      const reversibility = await prepareFileReversibilityCheckpoint(ctx, {
        toolId: "write_file",
        targetPath: absTarget,
        operation: args.overwrite ? "overwrite_file" : "create_file"
      });
      await writeFile(absTarget, buffer);
      return createActionResult({
        success: true,
        observation: `Wrote ${buffer.length} bytes to ${path.relative(outputDir, absTarget) || path.basename(absTarget)}`,
        metadata: {
          tool_id: "write_file",
          path: absTarget,
          bytes: buffer.length,
          reversibility
        },
        artifactPaths: [absTarget]
      });
    } catch (error) {
      return createActionResult({
        success: false,
        observation: `write_file failed: ${error.message}`,
        metadata: { tool_id: "write_file", attempted_path: targetArg }
      });
    }
  }
};

const RUN_SCRIPT_LANGUAGES = Object.freeze({
  powershell: { interpreter: "powershell.exe", args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"], ext: ".ps1" },
  node: { interpreter: process.execPath, args: [], ext: ".mjs" },
  python: { interpreter: "python", args: [], ext: ".py" }
});

function clampTimeout(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 20;
  return Math.min(20, Math.max(1, Math.floor(n)));
}

async function spawnScript({ language, scriptPath, timeoutSeconds }) {
  const spec = RUN_SCRIPT_LANGUAGES[language];
  if (!spec) {
    throw new Error(`unsupported language: ${language}`);
  }
  return new Promise((resolve) => {
    const child = spawn(spec.interpreter, [...spec.args, scriptPath], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const killTimer = setTimeout(() => {
      if (settled) return;
      try { child.kill("SIGKILL"); } catch { /* noop */ }
      settled = true;
      resolve({ exitCode: null, stdout, stderr, timedOut: true });
    }, timeoutSeconds * 1000);

    child.stdout?.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      resolve({ exitCode: null, stdout, stderr: stderr + `\n${error.message}`, spawnError: true });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      resolve({ exitCode: code, stdout, stderr, timedOut: false });
    });
  });
}

export const RUN_SCRIPT_TOOL = {
  id: "run_script",
  name: "Run Script",
  description: "Execute a short powershell / node / python script inside the task workspace. Output is captured and returned as the observation. Scripts are killed after 20 seconds.",
  parameters: ACTION_TOOL_SCHEMAS.run_script,
  risk_level: "medium",
  required_capabilities: ["subprocess_exec"],
  requires_confirmation: false,
  async execute(args = {}, ctx = {}) {
    const language = String(args.language ?? "").toLowerCase().trim();
    const source = typeof args.script === "string" ? args.script
      : typeof args.code === "string" ? args.code
        : "";
    if (!RUN_SCRIPT_LANGUAGES[language]) {
      return createActionResult({
        success: false,
        observation: `run_script rejected: language must be one of powershell/node/python. Got "${args.language}".`,
        metadata: { tool_id: "run_script" }
      });
    }
    if (!source.trim()) {
      return createActionResult({
        success: false,
        observation: "run_script rejected: script/code is empty.",
        metadata: { tool_id: "run_script" }
      });
    }
    const outputDir = await ensureOutputDir(resolveOutputDirForTool(ctx));
    const spec = RUN_SCRIPT_LANGUAGES[language];
    const scriptPath = path.join(outputDir, `run-script-${crypto.randomUUID().slice(0, 8)}${spec.ext}`);
    await writeFile(scriptPath, source, "utf8");
    const timeoutSeconds = clampTimeout(args.timeout);
    try {
      const result = await spawnScript({ language, scriptPath, timeoutSeconds });
      if (result.timedOut) {
        return createActionResult({
          success: false,
          observation: `run_script (${language}) timed out after ${timeoutSeconds}s and was killed.\n--- stdout ---\n${result.stdout.slice(0, 2000)}\n--- stderr ---\n${result.stderr.slice(0, 2000)}`,
          metadata: { tool_id: "run_script", language, timed_out: true, timeout_seconds: timeoutSeconds }
        });
      }
      if (result.spawnError || result.exitCode !== 0) {
        return createActionResult({
          success: false,
          observation: `run_script (${language}) exited with code ${result.exitCode ?? "unknown"}.\n--- stdout ---\n${result.stdout.slice(0, 2000)}\n--- stderr ---\n${result.stderr.slice(0, 2000)}`,
          metadata: { tool_id: "run_script", language, exit_code: result.exitCode }
        });
      }
      return createActionResult({
        success: true,
        observation: `run_script (${language}) finished with exit 0.\n--- stdout ---\n${result.stdout.slice(0, 4000) || "(empty)"}\n--- stderr ---\n${result.stderr.slice(0, 2000)}`,
        metadata: {
          tool_id: "run_script",
          language,
          exit_code: 0,
          stdout_bytes: result.stdout.length,
          stderr_bytes: result.stderr.length
        }
      });
    } catch (error) {
      return createActionResult({
        success: false,
        observation: `run_script crashed: ${error.message}`,
        metadata: { tool_id: "run_script", language }
      });
    }
  }
};

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

const OUTLINE_KINDS = new Set(["pptx", "docx", "xlsx", "pdf", "html"]);
const KIND_EXTENSIONS = { pptx: ".pptx", docx: ".docx", xlsx: ".xlsx", pdf: ".pdf", html: ".html" };
const KIND_MIMES = {
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
  html: "text/html"
};

function artifactKindFromTarget(targetPath = "") {
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

async function writePdfFromHtmlArtifact(htmlPath, pdfPath) {
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

function normalizeDocumentOutline(kind, outline) {
  if (outline && typeof outline === "object") return outline;
  const parsed = tryParseOutlineJson(outline);
  if (parsed) return parsed;
  const raw = String(outline ?? "").trim();
  if (!raw) return {};
  if (kind === "pptx") return heuristicPptxOutlineFromText(raw);
  if (kind === "xlsx") return heuristicXlsxOutlineFromText(raw);
  return heuristicSectionOutlineFromText(raw);
}

function previewSidecarPathForArtifact(targetPath) {
  const parsed = path.parse(targetPath);
  return path.join(parsed.dir, `${parsed.name}-preview.html`);
}

async function buildDocumentPreviewHtml(kind, outline, targetPath = "") {
  if (kind === "pdf") {
    return buildPdfHtml(outline);
  }
  const { renderDocumentPreviewHtml } = await import("../../capabilities/tools/document-renderer.mjs");
  return renderDocumentPreviewHtml({
    kind,
    outline,
    title: outline?.title || path.basename(targetPath || `result.${kind}`)
  });
}

async function writeDocumentPreviewSidecar({ kind, targetPath, outline }) {
  const previewPath = previewSidecarPathForArtifact(targetPath);
  const html = await buildDocumentPreviewHtml(kind, outline, targetPath);
  await writeFile(previewPath, html, "utf8");
  return previewPath;
}

async function prepareGeneratedDocumentCheckpoint(ctx, targetPath, operation) {
  return prepareFileReversibilityCheckpoint(ctx, {
    toolId: "generate_document",
    targetPath,
    operation
  });
}

async function invokeDocumentRenderer({ kind, targetPath, outline }) {
  // Try the Node.js renderer first (pptxgenjs / docx / exceljs — styled output).
  try {
    const { renderDocument } = await import("../../capabilities/tools/document-renderer.mjs");
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

export const GENERATE_DOCUMENT_TOOL = {
  id: "generate_document",
  name: "Generate Document",
  description: `Produce a professionally styled pptx / docx / xlsx / pdf / html artifact from a structured outline.

Outline shapes:
• pptx → { title, subtitle?, author?, date?, slides: [{ heading, bullets?: string[], body?: string, table?: { headers: string[], rows: any[][] }, layout?: "section" }] }
• docx/pdf/html → { title, subtitle?, author?, date?, sections: [{ heading, level?: 1|2, body?: string, bullets?: string[], table?: { headers: string[], rows: any[][] }, diagram?: { code, caption? }, svg?: { markup, caption? } }] }
• xlsx → { headers: string[], rows: any[][] }  OR  { sheets: [{ name, headers, rows }] }

Preferred calling convention:
• Pass \`outline\` as a native object, not a stringified JSON string.
• The tool will still normalize stringified JSON or plain-text outlines as a fallback, but object input is more reliable across models.

For reports with charts: include Mermaid diagram code in body text wrapped in triple-backtick mermaid blocks or as \`diagram\` components. SVG components are sanitized before rendering. HTML output is a first-class artifact, not a fallback.`,
  parameters: ACTION_TOOL_SCHEMAS.generate_document,
  risk_level: "low",
  required_capabilities: ["file_write"],
  requires_confirmation: false,
  async execute(args = {}, ctx = {}) {
    const kind = String(args.kind ?? "").toLowerCase().trim();
    if (!OUTLINE_KINDS.has(kind)) {
      return createActionResult({
        success: false,
        observation: `generate_document rejected: kind must be one of pptx/docx/xlsx/pdf/html. Got "${args.kind}".`,
        metadata: { tool_id: "generate_document" }
      });
    }
    try {
      const outputDir = await ensureOutputDir(resolveOutputDirForTool(ctx));
      const targetArg = typeof args.path === "string" && args.path.trim()
        ? args.path.trim()
        : (typeof args.filename === "string" && args.filename.trim()
          ? args.filename.trim()
          : `result${KIND_EXTENSIONS[kind]}`);
      const absTarget = await resolveSandboxedTarget(outputDir, targetArg);
      const outline   = normalizeDocumentOutline(kind, args.outline ?? {});
      const primaryReversibility = await prepareGeneratedDocumentCheckpoint(
        ctx,
        absTarget,
        `generate_document_${kind}`
      );

      if (kind === "html") {
        const htmlContent = buildPdfHtml(outline);
        await writeFile(absTarget, htmlContent, "utf8");
        return createActionResult({
          success: true,
          observation: `generate_document produced HTML at ${path.relative(outputDir, absTarget) || path.basename(absTarget)}`,
          metadata: {
            tool_id: "generate_document",
            kind,
            path: absTarget,
            mime_type: KIND_MIMES[kind],
            preview_html_path: absTarget,
            reversibility: primaryReversibility
          },
          artifactPaths: [absTarget]
        });
      }

      if (kind === "pdf") {
        const htmlPath = absTarget.replace(/\.pdf$/i, ".html");
        const htmlContent = buildPdfHtml(outline);
        const htmlSourceReversibility = await prepareGeneratedDocumentCheckpoint(
          ctx,
          htmlPath,
          "generate_document_pdf_html_source"
        );
        await writeFile(htmlPath, htmlContent, "utf8");
        try {
          await writePdfFromHtmlArtifact(htmlPath, absTarget);
          const previewTarget = previewSidecarPathForArtifact(absTarget);
          const previewReversibility = await prepareGeneratedDocumentCheckpoint(
            ctx,
            previewTarget,
            "generate_document_preview_sidecar"
          );
          const previewPath = await writeDocumentPreviewSidecar({ kind, targetPath: absTarget, outline });
          return createActionResult({
            success: true,
            observation: `generate_document produced PDF at ${path.relative(outputDir, absTarget) || path.basename(absTarget)}`,
            metadata: {
              tool_id: "generate_document", kind,
              path: absTarget, mime_type: KIND_MIMES[kind],
              html_source_path: htmlPath,
              preview_html_path: previewPath,
              reversibility: primaryReversibility,
              reversibility_sidecars: [htmlSourceReversibility, previewReversibility]
            },
            artifactPaths: [absTarget]
          });
        } catch (error) {
          return createActionResult({
            success: true,
            observation: `generate_document could not convert to PDF (${error.message}); produced HTML at ${path.relative(outputDir, htmlPath)}.`,
            metadata: {
              tool_id: "generate_document", kind,
              path: htmlPath, mime_type: "text/html",
              preview_html_path: htmlPath,
              needs_pdf_conversion: true, pdf_conversion_error: error.message,
              reversibility: htmlSourceReversibility
            },
            artifactPaths: [htmlPath]
          });
        }
      }

      await invokeDocumentRenderer({ kind, targetPath: absTarget, outline });
      const previewTarget = previewSidecarPathForArtifact(absTarget);
      const previewReversibility = await prepareGeneratedDocumentCheckpoint(
        ctx,
        previewTarget,
        "generate_document_preview_sidecar"
      );
      const previewPath = await writeDocumentPreviewSidecar({ kind, targetPath: absTarget, outline });
      return createActionResult({
        success: true,
        observation: `generate_document produced ${kind.toUpperCase()} at ${path.relative(outputDir, absTarget) || path.basename(absTarget)}`,
        metadata: {
          tool_id: "generate_document",
          kind,
          path: absTarget,
          mime_type: KIND_MIMES[kind],
          preview_html_path: previewPath,
          reversibility: primaryReversibility,
          reversibility_sidecars: [previewReversibility]
        },
        artifactPaths: [absTarget]
      });
    } catch (error) {
      return createActionResult({
        success: false,
        observation: `generate_document failed: ${error.message}`,
        metadata: { tool_id: "generate_document", kind }
      });
    }
  }
};

export const EDIT_FILE_TOOL = {
  id: "edit_file",
  name: "Edit File",
  description: "Update an existing file in place. For pptx/docx/xlsx/pdf/html pass a full updated outline and the existing absolute path; for text-like files pass the full replacement content.",
  parameters: ACTION_TOOL_SCHEMAS.edit_file,
  risk_level: "medium",
  required_capabilities: ["file_write"],
  requires_confirmation: false,
  async execute(args = {}, ctx = {}) {
    const targetArg = String(args.path ?? "").trim();
    if (!targetArg) {
      return createActionResult({
        success: false,
        observation: "edit_file rejected: path is required.",
        metadata: { tool_id: "edit_file" }
      });
    }
    try {
      const absTarget = await resolveEditableTargetForEdit(ctx, targetArg);
      const ext = path.extname(absTarget).toLowerCase();
      const kind = String(args.kind ?? artifactKindFromTarget(absTarget) ?? "").toLowerCase().trim();
      const reversibility = await prepareFileReversibilityCheckpoint(ctx, {
        toolId: "edit_file",
        targetPath: absTarget,
        operation: "edit_file"
      });
      if (OUTLINE_KINDS.has(kind)) {
        const outline = normalizeDocumentOutline(kind, args.outline ?? args.content ?? args.text ?? {});
        if (!outline || (typeof outline === "object" && Object.keys(outline).length === 0)) {
          return createActionResult({
            success: false,
            observation: `edit_file rejected: ${kind} edits require a full updated outline/content.`,
            metadata: { tool_id: "edit_file", path: absTarget, kind }
          });
        }
        if (kind === "html") {
          const htmlContent = buildPdfHtml(outline);
          await writeFile(absTarget, htmlContent, "utf8");
        } else if (kind === "pdf") {
          const htmlPath = absTarget.replace(/\.pdf$/i, ".html");
          const htmlContent = buildPdfHtml(outline);
          await writeFile(htmlPath, htmlContent, "utf8");
          await writePdfFromHtmlArtifact(htmlPath, absTarget);
        } else {
          await invokeDocumentRenderer({ kind, targetPath: absTarget, outline });
        }
        const previewPath = kind === "html"
          ? absTarget
          : await writeDocumentPreviewSidecar({ kind, targetPath: absTarget, outline });
        return createActionResult({
          success: true,
          observation: `edit_file updated ${path.basename(absTarget)} in place.`,
          metadata: {
            tool_id: "edit_file",
            path: absTarget,
            kind,
            mime_type: KIND_MIMES[kind] ?? null,
            preview_html_path: previewPath,
            reversibility
          },
          artifactPaths: [absTarget]
        });
      }

      const rawContent = typeof args.content === "string" ? args.content
        : typeof args.text === "string" ? args.text
          : "";
      if (!rawContent) {
        return createActionResult({
          success: false,
          observation: `edit_file rejected: ${ext || "text"} edits require replacement content in content/text.`,
          metadata: { tool_id: "edit_file", path: absTarget }
        });
      }
      const buffer = decodeWriteFileContent({
        content: rawContent,
        encoding: args.encoding
      });
      await writeFile(absTarget, buffer);
      return createActionResult({
        success: true,
        observation: `edit_file updated ${path.basename(absTarget)} in place.`,
        metadata: {
          tool_id: "edit_file",
          path: absTarget,
          bytes: buffer.length,
          kind: kind || artifactKindFromTarget(absTarget) || "text",
          reversibility
        },
        artifactPaths: [absTarget]
      });
    } catch (error) {
      return createActionResult({
        success: false,
        observation: `edit_file failed: ${error.message}`,
        metadata: { tool_id: "edit_file", attempted_path: targetArg }
      });
    }
  }
};

/* ------------------------------------------------------------------------ */
/* PDF HTML builder (with Mermaid support)                                   */
/* ------------------------------------------------------------------------ */

function escapeHtml(text) {
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
function buildPdfHtml(outline) {
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

/* ------------------------------------------------------------------------ */
/* RENDER_DIAGRAM_TOOL — Mermaid diagrams to standalone HTML                 */
/* ------------------------------------------------------------------------ */

export const RENDER_DIAGRAM_TOOL = {
  id: "render_diagram",
  name: "Render Diagram",
  description: `Render a Mermaid diagram to a standalone interactive HTML file.
Use for any chart or diagram in reports: flowchart, sequenceDiagram, pie, xychart-beta (bar/line), gantt, mindmap, timeline, etc.
The output HTML can be opened in any browser or embedded in a PDF via generate_document.

Example code:
  pie title Browser Share
    "Chrome" : 65
    "Firefox" : 20
    "Other" : 15`,
  parameters: ACTION_TOOL_SCHEMAS.render_diagram,
  risk_level: "low",
  required_capabilities: ["file_write"],
  requires_confirmation: false,
  async execute(args = {}, ctx = {}) {
    const code     = String(args.code ?? "").trim();
    const filename = typeof args.filename === "string" && args.filename.trim()
      ? args.filename.trim().replace(/\.(html|svg|png)$/i, "") + ".html"
      : "diagram.html";
    if (!code) {
      return createActionResult({
        success: false,
        observation: "render_diagram: no Mermaid code provided.",
        metadata: { tool_id: "render_diagram" }
      });
    }
    try {
      const outputDir = await ensureOutputDir(resolveOutputDirForTool(ctx));
      const htmlPath  = await resolveSandboxedTarget(outputDir, filename);
      const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Diagram</title>
${renderMermaidScriptTag()}
<style>
  body { margin: 0; padding: 24px; background: #fff; font-family: system-ui, sans-serif; }
  .mermaid { max-width: 100%; }
  pre.mermaid-fallback {
    background: #F1F5F9; border: 1px solid #E2E8F0;
    padding: 12px; border-radius: 4px; white-space: pre-wrap; color: #475569;
  }
</style>
</head>
<body>
<div class="mermaid">
${escapeHtml(code)}
</div>
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
      await writeFile(htmlPath, html, "utf8");
      return createActionResult({
        success: true,
        observation: `render_diagram produced ${path.relative(outputDir, htmlPath) || path.basename(htmlPath)}`,
        metadata: { tool_id: "render_diagram", path: htmlPath, mime_type: "text/html" },
        artifactPaths: [htmlPath]
      });
    } catch (error) {
      return createActionResult({
        success: false,
        observation: `render_diagram failed: ${error.message}`,
        metadata: { tool_id: "render_diagram" }
      });
    }
  }
};

/* ------------------------------------------------------------------------ */
/* RENDER_SVG_TOOL — sanitized standalone vector graphics                    */
/* ------------------------------------------------------------------------ */

export const RENDER_SVG_TOOL = {
  id: "render_svg",
  name: "Render SVG",
  description: "Write sanitized standalone SVG markup to a task artifact. Use for vector illustrations, icon-like diagrams, simple charts, layout mockups, or other scalable visual components.",
  parameters: ACTION_TOOL_SCHEMAS.render_svg,
  risk_level: "low",
  required_capabilities: ["file_write"],
  requires_confirmation: false,
  async execute(args = {}, ctx = {}) {
    const svg = sanitizeSvgMarkup(args.svg ?? args.markup ?? args.source ?? "");
    const filename = typeof args.filename === "string" && args.filename.trim()
      ? args.filename.trim().replace(/\.(html|svg|png)$/i, "") + ".svg"
      : "graphic.svg";
    if (!svg) {
      return createActionResult({
        success: false,
        observation: "render_svg: valid <svg> markup required.",
        metadata: { tool_id: "render_svg" }
      });
    }
    try {
      const outputDir = await ensureOutputDir(resolveOutputDirForTool(ctx));
      const svgPath = await resolveSandboxedTarget(outputDir, filename);
      await writeFile(svgPath, svg, "utf8");
      return createActionResult({
        success: true,
        observation: `render_svg produced ${path.relative(outputDir, svgPath) || path.basename(svgPath)}`,
        metadata: { tool_id: "render_svg", path: svgPath, mime_type: "image/svg+xml" },
        artifactPaths: [svgPath]
      });
    } catch (error) {
      return createActionResult({
        success: false,
        observation: `render_svg failed: ${error.message}`,
        metadata: { tool_id: "render_svg" }
      });
    }
  }
};

// UCA-077: draft-only capability interview tool. It only calls pure creator
// functions and returns interview state, an in-memory draft, or recovery.
function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function rehydrateInterviewState(rawState) {
  if (!isPlainObject(rawState)) return null;
  const kind = typeof rawState.kind === "string" ? rawState.kind : "";
  if (kind !== "skill" && kind !== "mcp") return null;
  let state = buildCapabilityInterviewState({ kind, name: rawState.name ?? "" });
  const collected = isPlainObject(rawState.collected) ? rawState.collected : {};
  if (typeof collected.purpose === "string") {
    state = applyCapabilityInterviewAnswer(state, { field: "purpose", value: collected.purpose });
  }
  if (collected.permissions !== undefined) {
    state = applyCapabilityInterviewAnswer(state, { field: "permissions", value: collected.permissions });
  }
  if (collected.config !== undefined) {
    state = applyCapabilityInterviewAnswer(state, { field: "config", value: collected.config });
  }
  if (collected.confirmed === true) {
    state = applyCapabilityInterviewAnswer(state, { field: "confirmation", value: true });
  }
  return state;
}

function buildOneShotInterviewState(args) {
  const kind = typeof args.kind === "string" ? args.kind : "";
  if (kind !== "skill" && kind !== "mcp") {
    return { error: "draft_capability requires kind=\"skill\" or kind=\"mcp\"." };
  }
  let state;
  try {
    state = buildCapabilityInterviewState({ kind, name: args.name ?? "" });
  } catch (error) {
    return { error: error.message };
  }
  if (typeof args.purpose === "string") {
    state = applyCapabilityInterviewAnswer(state, { field: "purpose", value: args.purpose });
  }
  if (args.permissions !== undefined) {
    state = applyCapabilityInterviewAnswer(state, { field: "permissions", value: args.permissions });
  }
  if (args.config !== undefined) {
    state = applyCapabilityInterviewAnswer(state, { field: "config", value: args.config });
  }
  if (args.confirmation === true) {
    state = applyCapabilityInterviewAnswer(state, { field: "confirmation", value: true });
  }
  return { state };
}

function summarizeDraftForObservation(draft) {
  const lines = [
    `Draft is ready to save (kind=${draft.kind}, id=${draft.id}, name="${draft.name}").`,
    `purpose: ${draft.purpose}`
  ];
  const permissions = draft.permissions ?? {};
  lines.push(
    `permissions: network=${permissions.network ? "true" : "false"}, filesystem=${permissions.filesystem ?? "none"}, secrets=${(permissions.secrets ?? []).length}`
  );
  if (draft.kind === "skill") {
    const instructions = draft.entry?.markdown?.split("\n").filter((l) => l.startsWith("- ")) ?? [];
    lines.push(`skill: ${instructions.length} instruction step(s); SKILL.md prepared in-memory only.`);
  } else if (draft.kind === "mcp") {
    const desc = draft.descriptor ?? {};
    if (desc.transport === "stdio") {
      lines.push(`mcp: transport=stdio command=${desc.command ?? ""}`);
    } else {
      lines.push(`mcp: transport=${desc.transport ?? "?"} url=${desc.url ?? ""}`);
    }
    lines.push(`mcp: enabled=false (draft only; not installed).`);
  }
  return lines.join("\n");
}

function summarizeInterviewForObservation(state) {
  const next = state.next_question;
  const lines = [
    `Capability interview is incomplete (kind=${state.kind}, missing: ${state.missing_fields.join(", ")}).`
  ];
  if (next) {
    lines.push(`Next question (${next.id}): ${next.prompt}`);
    if (next.hint) lines.push(`Hint: ${next.hint}`);
  }
  return lines.join("\n");
}

function summarizeRecoveryForObservation(proposal) {
  const lines = [proposal.question];
  if (Array.isArray(proposal.suggested_next_actions)) {
    for (const action of proposal.suggested_next_actions) {
      lines.push(`- ${action.field}: ${action.prompt}`);
    }
  }
  return lines.join("\n");
}

function summarizeDiscardForObservation(state) {
  const name = state?.name ? ` "${state.name}"` : "";
  return `Capability draft${name} was discarded. No files, MCP config, or secrets were changed.`;
}

export const DRAFT_CAPABILITY_TOOL = {
  id: "draft_capability",
  name: "Draft Capability",
  description: "Draft a skill or MCP capability through an interview. Read-only: never installs, writes files, edits runtime config, or stores secrets. Use {state, answer} to continue, {state, discard:true} to discard, or one-shot kind/name/purpose/permissions/config/confirmation. Secret values must be env or secret_ref references.",
  parameters: ACTION_TOOL_SCHEMAS.draft_capability,
  risk_level: "low",
  requires_confirmation: false,
  async execute(args = {}) {
    let state = null;

    if (isPlainObject(args.state)) {
      state = rehydrateInterviewState(args.state);
      if (!state) {
        return createActionResult({
          success: false,
          observation: "draft_capability could not rehydrate the provided state. Re-send {kind, name, purpose, permissions, config, confirmation} or call again with a valid state.",
          error: "capability_state_invalid",
          metadata: { tool_id: "draft_capability", status: "invalid_state" }
        });
      }
      if (args.discard === true || (isPlainObject(args.answer) && args.answer.field === "discard" && args.answer.value !== false)) {
        const discarded = discardCapabilityInterviewState(state);
        return createActionResult({
          success: true,
          observation: summarizeDiscardForObservation(discarded),
          metadata: {
            tool_id: "draft_capability",
            status: "discarded",
            state: discarded
          }
        });
      }
      if (isPlainObject(args.answer)) {
        try {
          state = applyCapabilityInterviewAnswer(state, args.answer);
        } catch (error) {
          const recovery = buildCapabilityRecoveryProposal(error);
          return createActionResult({
            success: false,
            observation: summarizeRecoveryForObservation(recovery),
            error: error.message,
            metadata: {
              tool_id: "draft_capability",
              status: "recovery_required",
              recovery
            }
          });
        }
      }
    } else {
      const built = buildOneShotInterviewState(args);
      if (built.error) {
        return createActionResult({
          success: false,
          observation: built.error,
          error: built.error,
          metadata: { tool_id: "draft_capability", status: "invalid_input" }
        });
      }
      state = built.state;
      if (isPlainObject(args.answer)) {
        try {
          state = applyCapabilityInterviewAnswer(state, args.answer);
        } catch (error) {
          const recovery = buildCapabilityRecoveryProposal(error);
          return createActionResult({
            success: false,
            observation: summarizeRecoveryForObservation(recovery),
            error: error.message,
            metadata: {
              tool_id: "draft_capability",
              status: "recovery_required",
              recovery
            }
          });
        }
      }
    }

    if (state.status !== "ready_to_save") {
      return createActionResult({
        success: true,
        observation: summarizeInterviewForObservation(state),
        metadata: {
          tool_id: "draft_capability",
          status: "interviewing",
          state,
          missing_fields: state.missing_fields,
          next_question: state.next_question
        }
      });
    }

    const draft = buildCapabilityDraft(state);
    const validation = validateCapabilityDraft(draft);
    if (!validation.ok) {
      const recovery = buildCapabilityRecoveryProposal(validation);
      return createActionResult({
        success: false,
        observation: summarizeRecoveryForObservation(recovery),
        error: "capability_draft_invalid",
        metadata: {
          tool_id: "draft_capability",
          status: "recovery_required",
          state,
          draft,
          validation,
          recovery
        }
      });
    }

    return createActionResult({
      success: true,
      observation: summarizeDraftForObservation(draft),
      metadata: {
        tool_id: "draft_capability",
        status: "ready_to_save",
        state,
        draft,
        validation
      }
    });
  }
};

// UCA-077: persist a capability draft. High-risk + confirmation-required.
// Skill drafts go through createEditableSkill (runtime-bound path safety);
// MCP drafts are written as a JSON file under a runtime-local drafts dir.
// The tool never installs an MCP server, never mutates runtime config, and
// never persists literal secret values; descriptor.enabled is always false
// and env values must already be ${env:NAME} / ${secret_ref:NAME} refs.

async function saveCapabilityDraftSkill(runtime, draft) {
  const created = await createEditableSkill(runtime, {
    id: draft.id,
    name: draft.name,
    description: draft.purpose,
    markdown: draft.entry?.markdown ?? ""
  });
  return {
    kind: "skill",
    id: created.id,
    path: created.entryPath,
    validation: created.validation
  };
}

async function saveCapabilityDraftMcp(runtime, draft) {
  const draftsDir = resolveMcpDraftsDir(runtime);
  await mkdir(draftsDir, { recursive: true });
  const safeId = slugifySkillId(draft.id || draft.name || "mcp-draft");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${safeId}-${stamp}.json`;
  const targetPath = path.join(draftsDir, filename);
  // Defensively force enabled=false; descriptor.env was already validated as
  // reference-only by validateCapabilityDraft.
  const descriptor = { ...(draft.descriptor ?? {}), enabled: false };
  const payload = {
    kind: "mcp",
    status: "draft",
    id: draft.id,
    name: draft.name,
    purpose: draft.purpose,
    permissions: draft.permissions,
    secrets: draft.secrets,
    descriptor,
    saved_at: new Date().toISOString()
  };
  await writeFile(targetPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return {
    kind: "mcp",
    id: draft.id,
    path: targetPath
  };
}

export const SAVE_CAPABILITY_DRAFT_TOOL = {
  id: "save_capability_draft",
  name: "Save Capability Draft",
  description: "Persist a capability draft from draft_capability. Skill drafts write SKILL.md under the runtime skills root. MCP drafts write a disabled JSON draft and never edit live runtime config. High-risk: requires user confirmation.",
  parameters: ACTION_TOOL_SCHEMAS.save_capability_draft,
  risk_level: "high",
  required_capabilities: ["file_write"],
  requires_confirmation: true,
  async execute(args = {}, ctx = {}) {
    const runtime = ctx?.runtime ?? null;
    if (!runtime || !isPlainObject(runtime?.paths)) {
      return createActionResult({
        success: false,
        observation: "save_capability_draft requires a runtime with configured paths.",
        error: "runtime_unavailable",
        metadata: { tool_id: "save_capability_draft", status: "runtime_unavailable" }
      });
    }

    let draft = isPlainObject(args.draft) ? args.draft : null;
    if (!draft && isPlainObject(args.state)) {
      try {
        draft = buildCapabilityDraft(args.state);
      } catch (error) {
        return createActionResult({
          success: false,
          observation: `save_capability_draft could not rebuild a draft from the provided state: ${error.message}`,
          error: error.message,
          metadata: { tool_id: "save_capability_draft", status: "invalid_state" }
        });
      }
    }
    if (!draft) {
      return createActionResult({
        success: false,
        observation: "save_capability_draft requires a draft (from draft_capability) or a completed interview state.",
        error: "draft_missing",
        metadata: { tool_id: "save_capability_draft", status: "draft_missing" }
      });
    }

    const validation = validateCapabilityDraft(draft);
    if (!validation.ok) {
      const recovery = buildCapabilityRecoveryProposal(validation);
      return createActionResult({
        success: false,
        observation: summarizeRecoveryForObservation(recovery),
        error: "capability_draft_invalid",
        metadata: {
          tool_id: "save_capability_draft",
          status: "recovery_required",
          validation,
          recovery
        }
      });
    }

    try {
      if (draft.kind === "skill" && typeof runtime.paths.skillsDir !== "string") {
        return createActionResult({
          success: false,
          observation: "save_capability_draft cannot save a skill because runtime.paths.skillsDir is not configured.",
          error: "skillsDir_not_configured",
          metadata: { tool_id: "save_capability_draft", status: "runtime_unavailable", kind: "skill" }
        });
      }
      if (draft.kind === "mcp" && !resolveMcpDraftsDir(runtime)) {
        return createActionResult({
          success: false,
          observation: "save_capability_draft cannot save an MCP draft because runtime.paths.baseDir or runtime.paths.mcpDraftsDir is not configured.",
          error: "mcp_drafts_dir_not_configured",
          metadata: { tool_id: "save_capability_draft", status: "runtime_unavailable", kind: "mcp" }
        });
      }
      const saved = draft.kind === "skill"
        ? await saveCapabilityDraftSkill(runtime, draft)
        : await saveCapabilityDraftMcp(runtime, draft);
      const observation = saved.kind === "skill"
        ? `Saved editable skill "${draft.name}" to ${saved.path}. Review or test it before relying on it.`
        : `Saved MCP draft "${draft.name}" to ${saved.path}. The server stays disabled and is not registered until reviewed.`;
      return createActionResult({
        success: true,
        observation,
        artifactPaths: [saved.path],
        metadata: {
          tool_id: "save_capability_draft",
          status: "saved",
          kind: saved.kind,
          id: saved.id,
          path: saved.path,
          enabled: saved.kind === "mcp" ? false : null,
          validation: saved.validation ?? null,
          review_required: true
        }
      });
    } catch (error) {
      return createActionResult({
        success: false,
        observation: `save_capability_draft failed to persist draft: ${error.message}`,
        error: error.message,
        metadata: { tool_id: "save_capability_draft", status: "save_failed" }
      });
    }
  }
};

export const BUILTIN_ACTION_TOOLS = Object.freeze([
  OPEN_URL_TOOL,
  WEB_SEARCH_TOOL,
  COMPOSE_EMAIL_TOOL,
  SEND_EMAIL_SMTP_TOOL,
  OPEN_FILE_TOOL,
  REVEAL_IN_EXPLORER_TOOL,
  LAUNCH_APP_TOOL,
  COPY_TO_CLIPBOARD_TOOL,
  NOTIFY_TOOL,
  FILE_OP_TOOL,
  TAKE_SCREENSHOT_TOOL,
  READ_CLIPBOARD_TOOL,
  CREATE_SCHEDULED_TASK_TOOL,
  LIST_SCHEDULED_TASKS_TOOL,
  DELETE_SCHEDULED_TASK_TOOL,
  PAUSE_SCHEDULED_TASK_TOOL,
  TRANSLATE_TEXT_TOOL,
  WEB_SEARCH_FETCH_TOOL,
  FETCH_URL_CONTENT_TOOL,
  WRITE_FILE_TOOL,
  EDIT_FILE_TOOL,
  RUN_SCRIPT_TOOL,
  GENERATE_DOCUMENT_TOOL,
  RENDER_DIAGRAM_TOOL,
  RENDER_SVG_TOOL,
  // UCA-053: File Discovery & Artifact Verification
  LIST_FILES_TOOL,
  GLOB_FILES_TOOL,
  FIND_RECENT_FILES_TOOL,
  GET_LATEST_ARTIFACT_TOOL,
  STAT_FILE_TOOL,
  READ_FILE_TEXT_TOOL,
  READ_FOLDER_TEXT_TOOL,
  SEARCH_FILE_CONTENT_TOOL,
  INDEX_FILE_CONTENT_TOOL,
  VERIFY_FILE_EXISTS_TOOL,
  REGISTER_ARTIFACT_TOOL,
  RESOLVE_OUTPUT_PATH_TOOL,
  // UCA-076: GUI Automation
  GUI_FIND_ELEMENT_TOOL,
  GUI_CLICK_TOOL,
  GUI_TYPE_TEXT_TOOL,
  // Tool-backed vision specialist. Lets tool_using handle "what's in
  // this image" without bouncing the task to the multi_modal executor.
  VISION_ANALYZE_TOOL,
  // UCA-182 Phase 21: memory introspection tools so the planner can
  // ask for prior-task context on its own, replacing the earlier
  // submit-time digest injection.
  ...MEMORY_TOOLS,
  // UCA-077: Capability creator (skill / MCP), draft-only and read-only.
  DRAFT_CAPABILITY_TOOL,
  // UCA-077: Save the capability draft. High-risk + confirmation-required;
  // never enables an MCP server or mutates runtime config.
  SAVE_CAPABILITY_DRAFT_TOOL,
  // C18 #2b: two-step LLM-callable skill install. Preview (low risk,
  // no confirmation) stages + returns SKILL.md preview + state token.
  // Install (high risk, requires_confirmation) consumes the token to
  // commit. Surface gating in tool-surface.mjs.shouldExposeSkillInstall
  // requires user_command to contain BOTH an install verb AND a
  // github.com URL in the same source.
  PREVIEW_SKILL_FROM_GITHUB_TOOL,
  INSTALL_SKILL_FROM_GITHUB_TOOL,
  // Connector catalog + provider account tools (single aggregation point)
  ...CONNECTOR_ACTION_TOOLS
]);
