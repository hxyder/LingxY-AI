import crypto from "node:crypto";
import path from "node:path";
import { lstat } from "node:fs/promises";

import { EMBEDDING_NAMESPACES } from "../embeddings/store.mjs";
import { FILE_EVIDENCE_COVERAGE } from "./file-evidence-coverage.mjs";
import { buildFileContentIndexRecords } from "./file-content-index-records.mjs";
import {
  collectPathReadableFiles,
  extractReadableFileText
} from "./local-file-collection.mjs";
import {
  normalizeProjectStore,
  setProjectAttachedFilePath
} from "../../shared/project-store.mjs";

const PROJECT_FILE_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".pdf",
  ".docx",
  ".doc",
  ".pptx",
  ".xlsx",
  ".csv",
  ".tsv",
  ".json",
  ".yaml",
  ".yml",
  ".xml",
  ".html",
  ".htm"
]);

const DEFAULT_ATTACH_BUDGET = Object.freeze({
  maxDepth: 3,
  maxFiles: 80,
  maxCharsPerFile: 20000,
  maxTotalChars: 100000
});

function normalizePathList(paths = []) {
  const list = Array.isArray(paths) ? paths : [];
  const seen = new Set();
  const normalized = [];
  for (const value of list) {
    if (typeof value !== "string") continue;
    const filePath = path.resolve(value.trim());
    if (!filePath || seen.has(filePath)) continue;
    seen.add(filePath);
    normalized.push(filePath);
  }
  return normalized;
}

function shouldIncludeProjectFile({ fullPath }) {
  return PROJECT_FILE_EXTENSIONS.has(path.extname(fullPath).toLowerCase());
}

function stableAttachTaskId(projectId, filePath) {
  const hash = crypto
    .createHash("sha256")
    .update([projectId, filePath].join("\n"))
    .digest("hex")
    .slice(0, 24);
  return `project_file_attach_${hash}`;
}

function removeExistingProjectPathRecords(store, { projectId, targetPath }) {
  if (typeof store?.list !== "function" || typeof store?.remove !== "function") return 0;
  const records = store.list({
    namespace: EMBEDDING_NAMESPACES.FILE_CONTENT,
    projectId
  });
  let removed = 0;
  for (const record of records) {
    if (record?.metadata?.path !== targetPath) continue;
    const deleted = store.remove(record.id, { namespace: EMBEDDING_NAMESPACES.FILE_CONTENT });
    if (deleted) removed += 1;
  }
  return removed;
}

async function buildProjectFileReadResult(inputPath, {
  maxDepth,
  maxFiles,
  maxCharsPerFile,
  maxTotalChars
}) {
  const info = await lstat(inputPath);
  const collection = await collectPathReadableFiles(inputPath, {
    includeFile: shouldIncludeProjectFile,
    maxDepth,
    maxFiles
  });
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
    const extracted = await extractReadableFileText(filePath, Math.min(maxCharsPerFile, remaining));
    records.push(extracted);
    if (!extracted.success) continue;
    totalChars += extracted.chars_extracted;
    chunks.push([
      `--- ${path.relative(inputPath, filePath).replace(/\\/g, "/") || path.basename(filePath)} ---`,
      `path=${filePath}`,
      `mime=${extracted.mime ?? "unknown"} mode=${extracted.extraction_mode ?? "unknown"}`,
      "",
      extracted.text || "[No extractable text]"
    ].join("\n"));
  }

  const successful = records.filter((record) => record.success);
  const truncated = stoppedByBudget || records.some((record) => record.truncated);
  return {
    success: true,
    observation: successful.length > 0
      ? [
        `Extracted text from ${successful.length}/${candidateFiles.length} project file(s) under ${inputPath}`,
        stoppedByBudget ? `Stopped at max_total_chars=${maxTotalChars}` : "",
        "",
        chunks.join("\n\n")
      ].filter(Boolean).join("\n")
      : `No extractable text found under ${inputPath}`,
    metadata: {
      tool_id: info.isDirectory() ? "read_folder_text" : "read_file_text",
      path: inputPath,
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
      coverage_scope: info.isDirectory()
        ? FILE_EVIDENCE_COVERAGE.FOLDER_RECURSIVE_TEXT
        : FILE_EVIDENCE_COVERAGE.SINGLE_FILE_TEXT,
      content_extracted: true,
      recursive: info.isDirectory(),
      files: records.map((record) => ({
        path: record.path,
        success: record.success,
        chars_extracted: record.chars_extracted ?? 0,
        truncated: record.truncated ?? false,
        error: record.error ?? null
      }))
    }
  };
}

export async function attachProjectFiles({
  runtime,
  saveRuntimeConfig,
  projectId,
  paths,
  budget = {},
  createdAt = new Date().toISOString()
} = {}) {
  const id = typeof projectId === "string" ? projectId.trim() : "";
  if (!id) return { ok: false, error: "project_id_required" };
  const normalizedPaths = normalizePathList(paths);
  if (normalizedPaths.length === 0) return { ok: false, error: "paths_required" };
  const embeddingStore = runtime?.platform?.embeddingStore ?? null;
  if (typeof embeddingStore?.add !== "function") return { ok: false, error: "embedding_store_unavailable" };
  if (typeof saveRuntimeConfig !== "function") return { ok: false, error: "config_store_unavailable" };
  let store = normalizeProjectStore(runtime?.configStore?.load?.()?.ui?.projectStore, { withUpdatedAt: false });
  if (!store.projects.some((project) => project.id === id)) {
    return { ok: false, error: "project_not_found" };
  }

  const effectiveBudget = {
    maxDepth: Number.isFinite(Number(budget.maxDepth)) ? Math.max(0, Math.min(Number(budget.maxDepth), 8)) : DEFAULT_ATTACH_BUDGET.maxDepth,
    maxFiles: Number.isFinite(Number(budget.maxFiles)) ? Math.max(1, Math.min(Number(budget.maxFiles), 200)) : DEFAULT_ATTACH_BUDGET.maxFiles,
    maxCharsPerFile: Number.isFinite(Number(budget.maxCharsPerFile)) ? Math.max(500, Math.min(Number(budget.maxCharsPerFile), 50000)) : DEFAULT_ATTACH_BUDGET.maxCharsPerFile,
    maxTotalChars: Number.isFinite(Number(budget.maxTotalChars)) ? Math.max(1000, Math.min(Number(budget.maxTotalChars), 250000)) : DEFAULT_ATTACH_BUDGET.maxTotalChars
  };

  const attachedPaths = [];
  const indexedRecords = [];
  const failures = [];
  let removedRecords = 0;

  for (const inputPath of normalizedPaths) {
    try {
      const result = await buildProjectFileReadResult(inputPath, effectiveBudget);
      const toolId = result.metadata.tool_id;
      const task = {
        task_id: stableAttachTaskId(id, inputPath),
        conversation_id: null,
        project_id: id
      };
      const records = buildFileContentIndexRecords({
        task,
        toolId,
        result,
        createdAt
      });
      removedRecords += removeExistingProjectPathRecords(embeddingStore, { projectId: id, targetPath: inputPath });
      for (const record of records) {
        embeddingStore.add(record);
        indexedRecords.push(record);
      }
      attachedPaths.push(inputPath);
    } catch (error) {
      failures.push({
        path: inputPath,
        error: error?.message ?? String(error)
      });
    }
  }

  for (const filePath of attachedPaths) {
    store = setProjectAttachedFilePath(store, id, filePath, true, { withUpdatedAt: false });
  }
  if (attachedPaths.length > 0) {
    store = saveRuntimeConfig(runtime, (currentConfig) => ({
      ...currentConfig,
      ui: {
        ...(currentConfig.ui ?? {}),
        projectStore: store
      }
    }))?.ui?.projectStore ?? store;
  }

  return {
    ok: true,
    project_id: id,
    attached_paths: attachedPaths,
    indexed_count: indexedRecords.length,
    removed_count: removedRecords,
    failed_paths: failures,
    store: normalizeProjectStore(store, { withUpdatedAt: false })
  };
}
