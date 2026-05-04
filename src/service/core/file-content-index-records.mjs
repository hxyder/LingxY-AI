import crypto from "node:crypto";

import { EMBEDDING_NAMESPACES } from "../embeddings/store.mjs";
import {
  FILE_EVIDENCE_COVERAGE,
  isFileTextCoverageScope
} from "./file-evidence-coverage.mjs";

const INDEXABLE_FILE_TOOLS = new Set(["read_file_text", "read_folder_text"]);
const MAX_INDEX_TEXT_CHARS = 60000;

function stableRecordId(seed = "") {
  return `file_content_${crypto.createHash("sha256").update(seed).digest("hex").slice(0, 24)}`;
}

function normalizePathList(files = []) {
  const list = Array.isArray(files) ? files : [];
  return list
    .map((file) => ({
      path: typeof file?.path === "string" ? file.path : null,
      success: file?.success === true,
      chars_extracted: Number.isFinite(Number(file?.chars_extracted))
        ? Number(file.chars_extracted)
        : 0,
      truncated: file?.truncated === true,
      error: typeof file?.error === "string" ? file.error : null
    }))
    .filter((file) => file.path);
}

function resultMetadata(result = {}) {
  return result?.metadata && typeof result.metadata === "object"
    ? result.metadata
    : {};
}

function resultText(result = {}) {
  return String(result?.observation ?? "").slice(0, MAX_INDEX_TEXT_CHARS);
}

function isIndexableFileResult(toolId, result = {}) {
  if (!INDEXABLE_FILE_TOOLS.has(toolId)) return false;
  if (result?.success !== true) return false;
  const metadata = resultMetadata(result);
  const scope = metadata.coverage_scope
    ?? (toolId === "read_folder_text"
      ? FILE_EVIDENCE_COVERAGE.FOLDER_RECURSIVE_TEXT
      : FILE_EVIDENCE_COVERAGE.SINGLE_FILE_TEXT);
  return isFileTextCoverageScope(scope) && metadata.content_extracted !== false;
}

/**
 * Build file-content embedding records from a successful file-read tool result.
 * This is intentionally pure: callers decide when/if to persist records.
 */
export function buildFileContentIndexRecords({
  task = null,
  toolId = "",
  result = null,
  artifact = null,
  createdAt = new Date().toISOString()
} = {}) {
  if (!isIndexableFileResult(toolId, result)) return [];
  const metadata = resultMetadata(result);
  const text = resultText(result);
  if (!text.trim()) return [];

  const files = normalizePathList(metadata.files);
  const primaryPath = typeof metadata.path === "string" ? metadata.path : files[0]?.path ?? null;
  const seed = [
    task?.task_id,
    task?.conversation_id,
    toolId,
    primaryPath,
    metadata.coverage_scope,
    metadata.chars_extracted,
    metadata.truncated,
    artifact?.artifact_id,
    artifact?.revision_of
  ].filter((value) => value != null && value !== "").join("\n");

  return [{
    id: stableRecordId(seed || text.slice(0, 200)),
    namespace: EMBEDDING_NAMESPACES.FILE_CONTENT,
    text,
    metadata: {
      namespace: EMBEDDING_NAMESPACES.FILE_CONTENT,
      task_id: task?.task_id ?? null,
      conversation_id: task?.conversation_id ?? null,
      tool_id: toolId,
      path: primaryPath,
      coverage_scope: metadata.coverage_scope ?? (
        toolId === "read_folder_text"
          ? FILE_EVIDENCE_COVERAGE.FOLDER_RECURSIVE_TEXT
          : FILE_EVIDENCE_COVERAGE.SINGLE_FILE_TEXT
      ),
      content_extracted: true,
      recursive: metadata.recursive === true || toolId === "read_folder_text",
      files,
      file_count: files.length || (primaryPath ? 1 : 0),
      chars_extracted: Number.isFinite(Number(metadata.chars_extracted))
        ? Number(metadata.chars_extracted)
        : text.length,
      truncated: metadata.truncated === true,
      artifact_id: artifact?.artifact_id ?? metadata.artifact_id ?? null,
      revision_of: artifact?.revision_of ?? metadata.revision_of ?? null,
      parent_artifact_id: artifact?.parent_artifact_id ?? metadata.parent_artifact_id ?? null,
      created_at: createdAt
    }
  }];
}

export { INDEXABLE_FILE_TOOLS };
