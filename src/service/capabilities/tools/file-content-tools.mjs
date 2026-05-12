import { mkdir, lstat, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ACTION_TOOL_SCHEMAS } from "../schemas/index.mjs";
import { createActionResult } from "../registry/types.mjs";
import { extractFileContent } from "../../extractors/file-ingest.mjs";
import { FILE_EVIDENCE_COVERAGE } from "../../core/file-evidence-coverage.mjs";
import { resolveFileReadBudgetFromTask } from "../../core/file-read-budget.mjs";
import { buildFileContentIndexRecords } from "../../core/file-content-index-records.mjs";
import {
  collectPathReadableFiles,
  extractReadableFileText
} from "../../core/local-file-collection.mjs";
import { EMBEDDING_NAMESPACES } from "../../embeddings/store.mjs";
import {
  globToRegex,
  readManifest,
  resolveDefaultOutputDir,
  writeManifest
} from "./file-manifest-helpers.mjs";

export const READ_FILE_TEXT_TOOL = {
  id: "read_file_text",
  name: "Read File Text",
  description: "Extract readable text from a local path. Supports text files, PDFs, Office Open XML files, images with OCR, and delegates directories to recursive folder extraction. Use this before summarizing or analyzing an attached/local file.",
  parameters: ACTION_TOOL_SCHEMAS.read_file_text,
  risk_level: "low",
  required_capabilities: ["file_read"],
  requires_confirmation: false,
  async execute(args = {}, ctx = {}) {
    const filePath = args.path ? path.resolve(String(args.path).replace(/^~/, os.homedir())) : "";
    if (!filePath) return createActionResult({ success: false, observation: "path required" });
    const fileReadBudget = resolveFileReadBudgetFromTask(ctx?.task);
    const maxChars = clampNumber(args.max_chars, { min: 500, max: 20000, fallback: fileReadBudget.max_chars });
    try {
      const info = await lstat(filePath);
      if (info.isDirectory()) {
        return READ_FOLDER_TEXT_TOOL.execute({
          path: filePath,
          pattern: args.pattern ?? "*.{md,markdown,txt,pdf,docx,doc,pptx,xlsx,csv,json,html,htm}",
          max_depth: args.max_depth ?? fileReadBudget.max_depth,
          max_files: args.max_files ?? fileReadBudget.max_files,
          max_total_chars: args.max_total_chars ?? Math.max(maxChars, fileReadBudget.max_total_chars),
          max_chars_per_file: args.max_chars_per_file ?? fileReadBudget.max_chars_per_file
        }, ctx);
      }
      const startedAt = Date.now();
      emitFileReadEvent(ctx, "file_read_started", {
        tool_id: "read_file_text",
        path: filePath,
        recursive: false,
        max_chars: maxChars
      });
      const extracted = await extractFileContent(filePath);
      const text = String(extracted.text ?? "");
      const clipped = text.slice(0, maxChars);
      const truncated = text.length > clipped.length;
      const durationMs = Date.now() - startedAt;
      emitFileReadEvent(ctx, "file_read_finished", {
        tool_id: "read_file_text",
        path: filePath,
        recursive: false,
        success: true,
        chars_extracted: clipped.length,
        chars_total: text.length,
        truncated,
        duration_ms: durationMs
      });
      emitToolFileReadTiming(ctx, {
        tool_id: "read_file_text",
        path: filePath,
        recursive: false,
        failed: false,
        duration_ms: durationMs
      });
      return createActionResult({
        success: true,
        observation: [
          `Extracted ${clipped.length}${truncated ? `/${text.length}` : ""} chars from ${filePath}`,
          `mime=${extracted.mime ?? "unknown"} mode=${extracted.extraction_mode ?? "unknown"}`,
          "",
          clipped || "[No extractable text]"
        ].join("\n"),
        metadata: {
          tool_id: "read_file_text",
          path: filePath,
          mime: extracted.mime ?? null,
          extraction_mode: extracted.extraction_mode ?? null,
          chars_extracted: clipped.length,
          chars_total: text.length,
          truncated,
          file_read_depth: fileReadBudget.depth,
          coverage_scope: FILE_EVIDENCE_COVERAGE.SINGLE_FILE_TEXT,
          content_extracted: true,
          recursive: false
        }
      });
    } catch (error) {
      emitFileReadEvent(ctx, "file_read_finished", {
        tool_id: "read_file_text",
        path: filePath,
        recursive: false,
        success: false,
        error: error.message
      });
      emitToolFileReadTiming(ctx, {
        tool_id: "read_file_text",
        path: filePath,
        recursive: false,
        failed: true,
        error: error.message
      });
      return createActionResult({
        success: false,
        observation: `read_file_text failed: ${error.message}`,
        metadata: { tool_id: "read_file_text", path: filePath }
      });
    }
  }
};

function clampNumber(value, { min, max, fallback }) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function emitFileReadEvent(ctx, eventType, payload = {}) {
  try {
    ctx?.runtime?.emitTaskEvent?.(eventType, payload);
  } catch { /* optional progress hook */ }
}

function emitToolFileReadTiming(ctx, payload = {}) {
  emitFileReadEvent(ctx, "phase_timing", {
    phase: "tool_file_read",
    ...payload
  });
}

export const READ_FOLDER_TEXT_TOOL = {
  id: "read_folder_text",
  name: "Read Folder Text",
  description: "Recursively extract readable text from files under a local folder. Use this when a folder or project directory must be analyzed beyond a shallow listing.",
  parameters: ACTION_TOOL_SCHEMAS.read_folder_text,
  risk_level: "low",
  required_capabilities: ["file_read"],
  requires_confirmation: false,
  async execute(args = {}, ctx = {}) {
    const rootPath = args.path ? path.resolve(String(args.path).replace(/^~/, os.homedir())) : "";
    if (!rootPath) return createActionResult({ success: false, observation: "path required" });
    const fileReadBudget = resolveFileReadBudgetFromTask(ctx?.task);
    const maxDepth = clampNumber(args.max_depth, { min: 0, max: 8, fallback: fileReadBudget.max_depth });
    const maxFiles = clampNumber(args.max_files, { min: 1, max: 80, fallback: fileReadBudget.max_files });
    const maxCharsPerFile = clampNumber(args.max_chars_per_file, { min: 500, max: 20000, fallback: fileReadBudget.max_chars_per_file });
    const maxTotalChars = clampNumber(args.max_total_chars, { min: 1000, max: 100000, fallback: fileReadBudget.max_total_chars });
    const patternRegex = args.pattern ? globToRegex(String(args.pattern)) : null;

    const startedAt = Date.now();
    emitFileReadEvent(ctx, "file_read_started", {
      tool_id: "read_folder_text",
      path: rootPath,
      recursive: true,
      pattern: args.pattern ?? null,
      max_depth: maxDepth,
      max_files: maxFiles,
      max_total_chars: maxTotalChars,
      max_chars_per_file: maxCharsPerFile
    });

    try {
      const collection = await collectPathReadableFiles(rootPath, { patternRegex, maxDepth, maxFiles });
      const candidateFiles = collection.files;
      const chunks = [];
      const records = [];
      let totalChars = 0;
      let stoppedByBudget = false;

      for (const filePath of candidateFiles) {
        if (totalChars >= maxTotalChars) {
          stoppedByBudget = true;
          break;
        }
        const remaining = maxTotalChars - totalChars;
        const fileStartedAt = Date.now();
        const extracted = await extractReadableFileText(filePath, Math.min(maxCharsPerFile, remaining));
        records.push(extracted);
        emitFileReadEvent(ctx, "file_read_progress", {
          tool_id: "read_folder_text",
          path: rootPath,
          file_path: filePath,
          recursive: true,
          completed: records.length,
          total: candidateFiles.length,
          success: extracted.success === true,
          chars_extracted: extracted.chars_extracted ?? 0,
          truncated: extracted.truncated === true,
          duration_ms: Date.now() - fileStartedAt
        });
        if (!extracted.success) continue;
        totalChars += extracted.chars_extracted;
        chunks.push([
          `--- ${path.relative(rootPath, filePath).replace(/\\/g, "/") || path.basename(filePath)} ---`,
          `path=${filePath}`,
          `mime=${extracted.mime ?? "unknown"} mode=${extracted.extraction_mode ?? "unknown"}`,
          "",
          extracted.text || "[No extractable text]"
        ].join("\n"));
      }

      const successful = records.filter((record) => record.success);
      const truncated = stoppedByBudget || records.some((record) => record.truncated);
      const durationMs = Date.now() - startedAt;
      emitFileReadEvent(ctx, "file_read_finished", {
        tool_id: "read_folder_text",
        path: rootPath,
        recursive: true,
        success: true,
        files_seen: candidateFiles.length,
        files_read: successful.length,
        chars_extracted: totalChars,
        truncated,
        duration_ms: durationMs
      });
      emitToolFileReadTiming(ctx, {
        tool_id: "read_folder_text",
        path: rootPath,
        recursive: true,
        failed: false,
        files_seen: candidateFiles.length,
        files_read: successful.length,
        duration_ms: durationMs
      });
      return createActionResult({
        success: true,
        observation: successful.length > 0
          ? [
            `Extracted text from ${successful.length}/${candidateFiles.length} file(s) under ${rootPath}`,
            stoppedByBudget ? `Stopped at max_total_chars=${maxTotalChars}` : "",
            "",
            chunks.join("\n\n")
          ].filter(Boolean).join("\n")
          : `No extractable text found under ${rootPath}`,
        metadata: {
          tool_id: "read_folder_text",
          path: rootPath,
          pattern: args.pattern ?? null,
          max_depth: maxDepth,
          max_files: maxFiles,
          file_read_depth: fileReadBudget.depth,
          files_seen: candidateFiles.length,
          files_read: successful.length,
          chars_extracted: totalChars,
          truncated,
          file_limit_hit: collection.fileLimitHit === true,
          depth_limit_hit: collection.depthLimitHit === true,
          coverage_complete: successful.length > 0
            && !truncated
            && collection.fileLimitHit !== true
            && collection.depthLimitHit !== true,
          coverage_scope: FILE_EVIDENCE_COVERAGE.FOLDER_RECURSIVE_TEXT,
          content_extracted: true,
          recursive: true,
          files: records.map((record) => ({
            path: record.path,
            success: record.success,
            chars_extracted: record.chars_extracted ?? 0,
            truncated: record.truncated ?? false,
            error: record.error ?? null
          }))
        }
      });
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      emitFileReadEvent(ctx, "file_read_finished", {
        tool_id: "read_folder_text",
        path: rootPath,
        recursive: true,
        success: false,
        error: error.message,
        duration_ms: durationMs
      });
      emitToolFileReadTiming(ctx, {
        tool_id: "read_folder_text",
        path: rootPath,
        recursive: true,
        failed: true,
        error: error.message,
        duration_ms: durationMs
      });
      return createActionResult({
        success: false,
        observation: `read_folder_text failed: ${error.message}`,
        metadata: { tool_id: "read_folder_text", path: rootPath }
      });
    }
  }
};

export const SEARCH_FILE_CONTENT_TOOL = {
  id: "search_file_content",
  name: "Search File Content",
  description: "Search the file-content RAG namespace for previously indexed local file text. This does not read disk; use read_file_text/read_folder_text for fresh extraction.",
  parameters: ACTION_TOOL_SCHEMAS.search_file_content,
  risk_level: "low",
  required_capabilities: ["file_read"],
  requires_confirmation: false,
  async execute(args = {}, ctx = {}) {
    const query = String(args.query ?? "").trim();
    if (!query) return createActionResult({ success: false, observation: "query required" });
    const store = ctx?.runtime?.platform?.embeddingStore ?? ctx?.embeddingStore ?? null;
    if (!store || typeof store.search !== "function") {
      return createActionResult({
        success: false,
        observation: "file content index is not available",
        metadata: {
          tool_id: "search_file_content",
          namespace: EMBEDDING_NAMESPACES.FILE_CONTENT,
          unavailable: true
        }
      });
    }
    const limit = clampNumber(args.limit, { min: 1, max: 20, fallback: 5 });
    const projectId = typeof ctx?.task?.project_id === "string" && ctx.task.project_id.trim()
      ? ctx.task.project_id.trim()
      : null;
    const matches = await store.search(query, limit, {
      namespace: EMBEDDING_NAMESPACES.FILE_CONTENT,
      projectId
    });
    const results = (Array.isArray(matches) ? matches : []).map((match) => ({
      id: match.id,
      score: Number.isFinite(Number(match.score)) ? Number(match.score) : 0,
      project_id: match.metadata?.project_id ?? null,
      chunk_index: Number.isFinite(Number(match.metadata?.chunk_index)) ? Number(match.metadata.chunk_index) : null,
      chunk_count: Number.isFinite(Number(match.metadata?.chunk_count)) ? Number(match.metadata.chunk_count) : null,
      char_start: Number.isFinite(Number(match.metadata?.char_start)) ? Number(match.metadata.char_start) : null,
      char_end: Number.isFinite(Number(match.metadata?.char_end)) ? Number(match.metadata.char_end) : null,
      path: match.metadata?.path ?? null,
      coverage_scope: match.metadata?.coverage_scope ?? null,
      artifact_id: match.metadata?.artifact_id ?? null,
      revision_of: match.metadata?.revision_of ?? null,
      truncated: match.metadata?.truncated === true,
      text: String(match.text ?? "").slice(0, 1200)
    }));
    const observation = results.length > 0
      ? [
        `Found ${results.length} file-content match(es) for query: ${query}`,
        ...results.map((result, index) => [
          `${index + 1}. ${result.path ?? result.id} score=${result.score.toFixed(3)}`,
          `coverage=${result.coverage_scope ?? "unknown"} artifact=${result.artifact_id ?? "none"} chunk=${result.chunk_index != null && result.chunk_count != null ? `${result.chunk_index + 1}/${result.chunk_count}` : "n/a"}`,
          result.text
        ].join("\n"))
      ].join("\n\n")
      : `No indexed file-content matches for query: ${query}`;
    return createActionResult({
      success: true,
      observation,
      metadata: {
        tool_id: "search_file_content",
        namespace: EMBEDDING_NAMESPACES.FILE_CONTENT,
        project_id: projectId,
        query,
        result_count: results.length,
        results
      }
    });
  }
};

function fileReadResultFromTranscriptEntry(entry = {}) {
  const toolId = entry?.type === "tool_result"
    ? entry.tool
    : entry?.role === "tool"
      ? entry.name
      : null;
  if (!["read_file_text", "read_folder_text"].includes(toolId)) return null;
  return {
    toolId,
    result: {
      success: entry.success === true,
      observation: entry.observation ?? "",
      metadata: entry.metadata ?? {}
    }
  };
}

export const INDEX_FILE_CONTENT_TOOL = {
  id: "index_file_content",
  name: "Index File Content",
  description: "Persist file text already read in this task into the file-content RAG namespace for future retrieval. This never reads disk; read_file_text/read_folder_text must run first. Requires user confirmation because it stores local file text.",
  parameters: ACTION_TOOL_SCHEMAS.index_file_content,
  risk_level: "high",
  required_capabilities: ["file_read"],
  requires_confirmation: true,
  async execute(args = {}, ctx = {}) {
    const store = ctx?.runtime?.platform?.embeddingStore ?? ctx?.embeddingStore ?? null;
    if (!store || typeof store.add !== "function") {
      return createActionResult({
        success: false,
        observation: "file content index is not available",
        metadata: {
          tool_id: "index_file_content",
          namespace: EMBEDDING_NAMESPACES.FILE_CONTENT,
          unavailable: true
        }
      });
    }

    const maxRecords = clampNumber(args.max_records, { min: 1, max: 50, fallback: 20 });
    const createdAt = new Date().toISOString();
    const seen = new Set();
    const records = [];
    for (const entry of Array.isArray(ctx.transcript) ? ctx.transcript : []) {
      const fileRead = fileReadResultFromTranscriptEntry(entry);
      if (!fileRead) continue;
      for (const record of buildFileContentIndexRecords({
        task: ctx.task,
        toolId: fileRead.toolId,
        result: fileRead.result,
        createdAt
      })) {
        if (seen.has(record.id)) continue;
        seen.add(record.id);
        records.push(record);
        if (records.length >= maxRecords) break;
      }
      if (records.length >= maxRecords) break;
    }

    if (records.length === 0) {
      return createActionResult({
        success: false,
        observation: "No successful file text reads are available to index. Run read_file_text or read_folder_text first.",
        metadata: {
          tool_id: "index_file_content",
          namespace: EMBEDDING_NAMESPACES.FILE_CONTENT,
          indexed_count: 0
        }
      });
    }

    for (const record of records) {
      store.add(record);
    }
    const paths = records.map((record) => record.metadata?.path).filter(Boolean);
    return createActionResult({
      success: true,
      observation: [
        `Indexed ${records.length} file-content record(s) for future retrieval.`,
        ...paths.slice(0, 8).map((filePath) => `- ${filePath}`)
      ].join("\n"),
      metadata: {
        tool_id: "index_file_content",
        namespace: EMBEDDING_NAMESPACES.FILE_CONTENT,
        indexed_count: records.length,
        record_ids: records.map((record) => record.id),
        paths
      }
    });
  }
};

export const REGISTER_ARTIFACT_TOOL = {
  id: "register_artifact",
  name: "Register Artifact",
  description: "Register a generated file into the UCA artifact manifest so it can be found later.",
  parameters: ACTION_TOOL_SCHEMAS.register_artifact,
  risk_level: "low",
  required_capabilities: ["file_write"],
  requires_confirmation: false,
  async execute(args = {}, ctx = {}) {
    const filePath = args.path ? path.resolve(args.path.replace(/^~/, os.homedir())) : "";
    if (!filePath) return createActionResult({ success: false, observation: "path required" });
    const kind = String(args.kind ?? path.extname(filePath).slice(1) ?? "unknown");
    const outputDir = resolveDefaultOutputDir(ctx);
    try {
      const info = await stat(filePath);
      const manifest = await readManifest(outputDir);
      const alreadyRegistered = manifest.some((e) => e.path === filePath);
      if (!alreadyRegistered) {
        manifest.push({
          path: filePath,
          kind,
          task_id: args.task_id ?? ctx?.task?.task_id ?? null,
          size: info.size,
          created_at: new Date().toISOString()
        });
        await writeManifest(outputDir, manifest);
      }
      return createActionResult({
        success: true,
        observation: `Registered ${kind} artifact: ${filePath}${alreadyRegistered ? " (already registered)" : ""}`,
        artifactPaths: [filePath],
        metadata: { tool_id: "register_artifact", path: filePath, kind }
      });
    } catch (error) {
      return createActionResult({
        success: false,
        observation: `register_artifact failed: ${error.message}`,
        metadata: { tool_id: "register_artifact", path: filePath }
      });
    }
  }
};

export const RESOLVE_OUTPUT_PATH_TOOL = {
  id: "resolve_output_path",
  name: "Resolve Output Path",
  description: "Resolve a filename to the full path in the UCA default output directory (from Settings).",
  parameters: ACTION_TOOL_SCHEMAS.resolve_output_path,
  risk_level: "low",
  required_capabilities: [],
  requires_confirmation: false,
  async execute(args = {}, ctx = {}) {
    const filename = String(args.filename ?? "").trim();
    if (!filename) return createActionResult({ success: false, observation: "filename required" });
    const outputDir = resolveDefaultOutputDir(ctx);
    const resolved = path.join(outputDir, filename);
    await mkdir(outputDir, { recursive: true });
    return createActionResult({
      success: true,
      observation: `Resolved output path: ${resolved}`,
      metadata: { tool_id: "resolve_output_path", path: resolved, outputDir }
    });
  }
};
