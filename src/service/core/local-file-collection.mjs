import path from "node:path";
import { lstat, readdir } from "node:fs/promises";

import { extractFileContent } from "../extractors/file-ingest.mjs";

export const DEFAULT_FOLDER_EXCLUDES = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  ".venv",
  "venv",
  "dist",
  "build",
  "out"
]);

export function shouldSkipFolderEntry(entry) {
  if (!entry?.name) return true;
  if (entry.name.startsWith(".") && entry.name !== ".") return true;
  return DEFAULT_FOLDER_EXCLUDES.has(entry.name);
}

export async function collectReadableFiles(rootPath, {
  patternRegex = null,
  includeFile = null,
  maxDepth = 3,
  maxFiles = 20
} = {}) {
  const files = [];
  let fileLimitHit = false;
  let depthLimitHit = false;
  const include = typeof includeFile === "function" ? includeFile : null;

  async function walk(dir, depth = 0) {
    if (files.length >= maxFiles) {
      fileLimitHit = true;
      return;
    }
    if (depth > maxDepth) {
      depthLimitHit = true;
      return;
    }
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (files.length >= maxFiles) {
        fileLimitHit = true;
        return;
      }
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(rootPath, fullPath).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        if (!shouldSkipFolderEntry(entry)) {
          if (depth + 1 > maxDepth) {
            depthLimitHit = true;
            continue;
          }
          await walk(fullPath, depth + 1);
        }
        continue;
      }
      if (!entry.isFile()) continue;
      if (include && !include({ entry, fullPath, relPath, rootPath })) continue;
      if (!include && patternRegex && !patternRegex.test(relPath) && !patternRegex.test(entry.name)) continue;
      files.push(fullPath);
    }
  }

  await walk(rootPath, 0);
  return { files, fileLimitHit, depthLimitHit };
}

export async function collectPathReadableFiles(rootPath, options = {}) {
  const info = await lstat(rootPath);
  if (!info.isDirectory()) {
    return { files: [rootPath], fileLimitHit: false, depthLimitHit: false };
  }
  return collectReadableFiles(rootPath, options);
}

export async function extractReadableFileText(filePath, maxCharsPerFile) {
  try {
    const extracted = await extractFileContent(filePath);
    const text = String(extracted.text ?? "");
    const clipped = text.slice(0, maxCharsPerFile);
    return {
      path: filePath,
      success: true,
      mime: extracted.mime ?? null,
      extraction_mode: extracted.extraction_mode ?? null,
      text: clipped,
      chars_extracted: clipped.length,
      chars_total: text.length,
      truncated: text.length > clipped.length
    };
  } catch (error) {
    return {
      path: filePath,
      success: false,
      error: error.message
    };
  }
}
