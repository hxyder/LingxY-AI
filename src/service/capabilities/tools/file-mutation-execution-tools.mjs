import { access, lstat, mkdir, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { ACTION_TOOL_SCHEMAS } from "../schemas/index.mjs";
import { createActionResult } from "../registry/types.mjs";
import { configuredWritableArtifactRoots, ensureOutputDir, resolveOutputDirForTool, resolveSandboxedTarget } from "../../core/artifact-path-helper.mjs";
import { prepareFileReversibilityCheckpoint } from "./file-reversibility.mjs";
import {
  OUTLINE_KINDS,
  KIND_MIMES,
  artifactKindFromTarget,
  buildPdfHtml,
  invokeDocumentRenderer,
  normalizeDocumentOutline,
  writeDocumentPreviewSidecar,
  writePdfFromHtmlArtifact
} from "./document-artifact-helpers.mjs";

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

