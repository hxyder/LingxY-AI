import crypto from "node:crypto";

import { EMBEDDING_NAMESPACES } from "../embeddings/store.mjs";
import {
  FILE_EVIDENCE_COVERAGE,
  isFileTextCoverageScope
} from "./file-evidence-coverage.mjs";

const INDEXABLE_FILE_TOOLS = new Set(["read_file_text", "read_folder_text"]);
const MAX_INDEX_TEXT_CHARS = 60000;
const CHUNK_TARGET_CHARS = 1800;
const CHUNK_OVERLAP_CHARS = 200;
const MAX_INDEX_CHUNKS = 80;

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

function trimSegmentWithOffsets(text, start, end) {
  let left = start;
  let right = end;
  while (left < right && /\s/.test(text[left])) left += 1;
  while (right > left && /\s/.test(text[right - 1])) right -= 1;
  return {
    text: text.slice(left, right),
    start: left,
    end: right
  };
}

function splitParagraphsWithOffsets(text = "") {
  const paragraphs = [];
  const separator = /\n\s*\n/g;
  let start = 0;
  let match = separator.exec(text);
  while (match) {
    const segment = trimSegmentWithOffsets(text, start, match.index);
    if (segment.text) paragraphs.push(segment);
    start = separator.lastIndex;
    match = separator.exec(text);
  }
  const tail = trimSegmentWithOffsets(text, start, text.length);
  if (tail.text) paragraphs.push(tail);
  return paragraphs.length > 0 ? paragraphs : [trimSegmentWithOffsets(text, 0, text.length)].filter((item) => item.text);
}

function sliceLargeSegment(segment) {
  const chunks = [];
  let start = segment.start;
  while (start < segment.end && chunks.length < MAX_INDEX_CHUNKS) {
    const end = Math.min(segment.end, start + CHUNK_TARGET_CHARS);
    const chunk = trimSegmentWithOffsets(segment.text, start - segment.start, end - segment.start);
    if (chunk.text) {
      chunks.push({
        text: chunk.text,
        start: segment.start + chunk.start,
        end: segment.start + chunk.end
      });
    }
    if (end >= segment.end) break;
    start = Math.max(start + 1, end - CHUNK_OVERLAP_CHARS);
  }
  return chunks;
}

function buildTextChunks(text = "") {
  if (text.length <= CHUNK_TARGET_CHARS) {
    return [{ text, start: 0, end: text.length }];
  }
  const chunks = [];
  let currentText = "";
  let currentStart = null;
  let currentEnd = null;

  function flushCurrent() {
    if (!currentText.trim()) return;
    chunks.push({
      text: currentText.trim(),
      start: currentStart ?? 0,
      end: currentEnd ?? currentText.length
    });
    currentText = "";
    currentStart = null;
    currentEnd = null;
  }

  for (const paragraph of splitParagraphsWithOffsets(text)) {
    if (chunks.length >= MAX_INDEX_CHUNKS) break;
    if (paragraph.text.length > CHUNK_TARGET_CHARS) {
      flushCurrent();
      for (const sliced of sliceLargeSegment(paragraph)) {
        if (chunks.length >= MAX_INDEX_CHUNKS) break;
        chunks.push(sliced);
      }
      continue;
    }
    const nextText = currentText ? `${currentText}\n\n${paragraph.text}` : paragraph.text;
    if (currentText && nextText.length > CHUNK_TARGET_CHARS) {
      flushCurrent();
    }
    currentText = currentText ? `${currentText}\n\n${paragraph.text}` : paragraph.text;
    currentStart = currentStart ?? paragraph.start;
    currentEnd = paragraph.end;
  }
  flushCurrent();
  return chunks.length > 0 ? chunks : [{ text, start: 0, end: text.length }];
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
    task?.project_id,
    toolId,
    primaryPath,
    metadata.coverage_scope,
    metadata.chars_extracted,
    metadata.truncated,
    artifact?.artifact_id,
    artifact?.revision_of
  ].filter((value) => value != null && value !== "").join("\n");

  const chunks = buildTextChunks(text);
  const baseMetadata = {
    namespace: EMBEDDING_NAMESPACES.FILE_CONTENT,
    task_id: task?.task_id ?? null,
    conversation_id: task?.conversation_id ?? null,
    project_id: task?.project_id ?? metadata.project_id ?? null,
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
  };

  return chunks.map((chunk, index) => ({
    id: stableRecordId(chunks.length === 1
      ? (seed || text.slice(0, 200))
      : [seed || text.slice(0, 200), `chunk:${index}`, chunk.start, chunk.end].join("\n")),
    namespace: EMBEDDING_NAMESPACES.FILE_CONTENT,
    text: chunk.text,
    metadata: {
      ...baseMetadata,
      chunk_index: index,
      chunk_count: chunks.length,
      chunked: chunks.length > 1,
      char_start: chunk.start,
      char_end: chunk.end
    }
  }));
}

export { INDEXABLE_FILE_TOOLS };
