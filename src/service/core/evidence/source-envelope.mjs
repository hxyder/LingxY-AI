import crypto from "node:crypto";
import path from "node:path";

import {
  FILE_EVIDENCE_COVERAGE,
  normalizeFileCoverageScope
} from "../file-evidence-coverage.mjs";

const MAX_EXCERPT_CHARS = 240;

function nonEmptyString(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function clippedExcerpt(value) {
  const text = nonEmptyString(value);
  if (!text) return null;
  return text.replace(/\s+/g, " ").slice(0, MAX_EXCERPT_CHARS);
}

function numberOrNull(value) {
  const n = Number(value);
  if (value === null || value === undefined || value === "") return null;
  return Number.isFinite(n) ? n : null;
}

function sourceId(kind, locator, range = null, scope = null) {
  const start = range && Number.isFinite(Number(range.char_start)) ? Number(range.char_start) : "";
  const end = range && Number.isFinite(Number(range.char_end)) ? Number(range.char_end) : "";
  const digest = crypto
    .createHash("sha1")
    .update(`${kind}|${locator}|${start}|${end}|${scope ?? ""}`)
    .digest("hex")
    .slice(0, 8);
  const prefix = kind === "web" ? "w"
    : kind === "chunk" ? "c"
      : kind === "image" ? "i"
        : "f";
  return `${prefix}_${digest}`;
}

function makeSource({
  kind,
  locator,
  title = null,
  excerpt = null,
  score = null,
  range = null,
  scope = null,
  truncated = false,
  fetched_at = null
}) {
  const cleanLocator = nonEmptyString(locator);
  if (!cleanLocator) return null;
  const cleanRange = range
    && Number.isFinite(Number(range.char_start))
    && Number.isFinite(Number(range.char_end))
    ? {
        char_start: Number(range.char_start),
        char_end: Number(range.char_end)
      }
    : null;
  const cleanScope = normalizeFileCoverageScope(scope);
  return {
    id: sourceId(kind, cleanLocator, cleanRange, cleanScope),
    kind,
    locator: cleanLocator,
    ...(nonEmptyString(title) ? { title: nonEmptyString(title) } : {}),
    ...(clippedExcerpt(excerpt) ? { excerpt: clippedExcerpt(excerpt) } : {}),
    ...(score !== null && score !== undefined && score !== "" && Number.isFinite(Number(score)) ? { score: Number(score) } : {}),
    ...(cleanRange ? { range: cleanRange } : {}),
    ...(cleanScope ? { scope: cleanScope } : {}),
    ...(truncated === true ? { truncated: true } : {}),
    ...(nonEmptyString(fetched_at) ? { fetched_at: nonEmptyString(fetched_at) } : {})
  };
}

function entryTimestamp(entry = {}) {
  return nonEmptyString(entry.ts) ?? nonEmptyString(entry.timestamp) ?? null;
}

function sourcesFromWebSearch(entry) {
  const results = Array.isArray(entry?.metadata?.results) ? entry.metadata.results : [];
  return results
    .map((result) => makeSource({
      kind: "web",
      locator: result?.url,
      title: result?.title,
      excerpt: result?.snippet ?? result?.description,
      score: numberOrNull(result?.score),
      fetched_at: entryTimestamp(entry)
    }))
    .filter(Boolean);
}

function sourcesFromFetchUrl(entry) {
  const url = entry?.metadata?.url ?? entry?.metadata?.requested_url;
  const source = makeSource({
    kind: "web",
    locator: url,
    title: entry?.metadata?.title ?? url,
    excerpt: entry?.observation,
    fetched_at: entryTimestamp(entry)
  });
  return source ? [source] : [];
}

function sourceFromFilePath(entry, {
  filePath,
  scope,
  contentExtracted,
  truncated,
  excerpt = null,
  kind = "file"
}) {
  return makeSource({
    kind,
    locator: filePath,
    title: filePath ? path.basename(String(filePath)) : null,
    excerpt,
    scope: scope ?? (contentExtracted === false
      ? FILE_EVIDENCE_COVERAGE.FILE_METADATA
      : FILE_EVIDENCE_COVERAGE.SINGLE_FILE_TEXT),
    truncated,
    fetched_at: entryTimestamp(entry)
  });
}

function sourcesFromFreshFileRead(entry) {
  const metadata = entry?.metadata ?? {};
  const files = Array.isArray(metadata.files) ? metadata.files : null;
  if (files) {
    const scope = metadata.coverage_scope ?? FILE_EVIDENCE_COVERAGE.FOLDER_RECURSIVE_TEXT;
    return files
      .filter((file) => file?.success !== false)
      .map((file) => sourceFromFilePath(entry, {
        filePath: file?.path,
        scope,
        contentExtracted: metadata.content_extracted !== false,
        truncated: file?.truncated === true
      }))
      .filter(Boolean);
  }
  const source = sourceFromFilePath(entry, {
    filePath: metadata.path,
    scope: metadata.coverage_scope ?? FILE_EVIDENCE_COVERAGE.SINGLE_FILE_TEXT,
    contentExtracted: metadata.content_extracted !== false,
    truncated: metadata.truncated === true,
    excerpt: entry?.observation
  });
  return source ? [source] : [];
}

function sourcesFromVision(entry) {
  const imagePaths = Array.isArray(entry?.metadata?.image_paths) ? entry.metadata.image_paths : [];
  return imagePaths
    .map((imagePath) => sourceFromFilePath(entry, {
      filePath: imagePath,
      scope: FILE_EVIDENCE_COVERAGE.SINGLE_FILE_TEXT,
      contentExtracted: true,
      truncated: false,
      kind: "image",
      excerpt: entry?.observation
    }))
    .filter(Boolean);
}

function sourcesFromIndexedFileSearch(entry) {
  const results = Array.isArray(entry?.metadata?.results) ? entry.metadata.results : [];
  return results
    .map((result) => makeSource({
      kind: "chunk",
      locator: result?.path ?? result?.metadata?.path ?? result?.id,
      title: result?.path ? path.basename(String(result.path)) : result?.id,
      excerpt: result?.text,
      score: numberOrNull(result?.score),
      range: {
        char_start: result?.char_start ?? result?.metadata?.char_start,
        char_end: result?.char_end ?? result?.metadata?.char_end
      },
      scope: result?.coverage_scope ?? result?.metadata?.coverage_scope ?? FILE_EVIDENCE_COVERAGE.SINGLE_FILE_TEXT,
      truncated: result?.truncated === true || result?.metadata?.truncated === true,
      fetched_at: entryTimestamp(entry)
    }))
    .filter(Boolean);
}

function sourcesFromFileEnumeration(entry) {
  const metadata = entry?.metadata ?? {};
  const files = Array.isArray(metadata.files) ? metadata.files : [];
  const scope = metadata.coverage_scope
    ?? (entry?.tool === "list_files"
      ? FILE_EVIDENCE_COVERAGE.DIRECTORY_LISTING_SHALLOW
      : FILE_EVIDENCE_COVERAGE.FILE_ENUMERATION_RECURSIVE);
  return files
    .map((file) => sourceFromFilePath(entry, {
      filePath: typeof file === "string" ? file : file?.path,
      scope,
      contentExtracted: false,
      truncated: false
    }))
    .filter(Boolean);
}

function dedupeSources(sources) {
  const byId = new Map();
  for (const source of sources) {
    if (!source?.id || byId.has(source.id)) continue;
    byId.set(source.id, source);
  }
  return [...byId.values()];
}

export function normalizeSources(entry = {}) {
  if (!entry || typeof entry !== "object") return [];
  if (entry.success === false) return [];
  const tool = entry.tool ?? entry.name ?? entry.tool_id ?? "";
  const sources = (() => {
    if (tool === "web_search_fetch") return sourcesFromWebSearch(entry);
    if (tool === "fetch_url_content") return sourcesFromFetchUrl(entry);
    if (tool === "read_file_text" || tool === "read_folder_text") return sourcesFromFreshFileRead(entry);
    if (tool === "vision_analyze") return sourcesFromVision(entry);
    if (tool === "search_file_content") return sourcesFromIndexedFileSearch(entry);
    if (tool === "list_files" || tool === "glob_files" || tool === "find_recent_files") return sourcesFromFileEnumeration(entry);
    if (tool === "stat_file") {
      const source = sourceFromFilePath(entry, {
        filePath: entry?.metadata?.path,
        scope: entry?.metadata?.coverage_scope ?? FILE_EVIDENCE_COVERAGE.FILE_METADATA,
        contentExtracted: false,
        truncated: false
      });
      return source ? [source] : [];
    }
    return [];
  })();
  return dedupeSources(sources);
}
