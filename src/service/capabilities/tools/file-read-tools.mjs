import { readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ACTION_TOOL_SCHEMAS } from "../schemas/index.mjs";
import { createActionResult } from "../registry/types.mjs";
import { FILE_EVIDENCE_COVERAGE } from "../../core/file-evidence-coverage.mjs";
import { resolveDefaultOutputDir, readManifest, globToRegex } from "./file-manifest-helpers.mjs";

const FILE_KIND_EXTS = {
  pptx: [".pptx"],
  docx: [".docx"],
  xlsx: [".xlsx"],
  pdf: [".pdf"],
  txt: [".txt"],
  md: [".md"],
  csv: [".csv"],
  html: [".html", ".htm"]
};

export const STAT_FILE_TOOL = {
  id: "stat_file",
  name: "Stat File",
  description: "Check a file's existence, size, and modification time.",
  parameters: ACTION_TOOL_SCHEMAS.stat_file,
  risk_level: "low",
  required_capabilities: ["file_read"],
  requires_confirmation: false,
  async execute(args = {}) {
    const filePath = args.path ? path.resolve(args.path.replace(/^~/, os.homedir())) : "";
    if (!filePath) return createActionResult({ success: false, observation: "path required" });
    try {
      const info = await stat(filePath);
      return createActionResult({
        success: true,
        observation: `File ${filePath}: size=${info.size}B, modified=${info.mtime.toISOString()}`,
        metadata: {
          tool_id: "stat_file",
          path: filePath,
          size: info.size,
          mtime: info.mtime.toISOString(),
          isFile: info.isFile(),
          coverage_scope: FILE_EVIDENCE_COVERAGE.FILE_METADATA,
          content_extracted: false,
          recursive: false
        }
      });
    } catch (error) {
      return createActionResult({
        success: false,
        observation: error.code === "ENOENT" ? `File not found: ${filePath}` : `stat_file failed: ${error.message}`,
        metadata: {
          tool_id: "stat_file",
          path: filePath,
          exists: false,
          coverage_scope: FILE_EVIDENCE_COVERAGE.FILE_METADATA,
          content_extracted: false,
          recursive: false
        }
      });
    }
  }
};

export const VERIFY_FILE_EXISTS_TOOL = {
  id: "verify_file_exists",
  name: "Verify File Exists",
  description: "Assert that a file exists and has non-zero size. Required before claiming a document was successfully generated.",
  parameters: ACTION_TOOL_SCHEMAS.verify_file_exists,
  risk_level: "low",
  required_capabilities: ["file_read"],
  requires_confirmation: false,
  async execute(args = {}) {
    const filePath = args.path ? path.resolve(args.path.replace(/^~/, os.homedir())) : "";
    if (!filePath) return createActionResult({ success: false, observation: "path required" });
    try {
      const info = await stat(filePath);
      const exists = info.isFile() && info.size > 0;
      return createActionResult({
        success: exists,
        observation: exists
          ? `File verified: ${filePath} exists (${info.size} bytes)`
          : `File is empty or not a regular file: ${filePath}`,
        metadata: { tool_id: "verify_file_exists", path: filePath, exists, size: info.size }
      });
    } catch {
      return createActionResult({
        success: false,
        observation: `File does not exist: ${filePath}`,
        metadata: { tool_id: "verify_file_exists", path: filePath, exists: false }
      });
    }
  }
};



export const LIST_FILES_TOOL = {
  id: "list_files",
  name: "List Files",
  description: "List files in a directory, optionally filtered by glob pattern (e.g. *.pptx).",
  parameters: ACTION_TOOL_SCHEMAS.list_files,
  risk_level: "low",
  required_capabilities: ["file_read"],
  requires_confirmation: false,
  async execute(args = {}, ctx = {}) {
    const dir = args.dir
      ? path.resolve(args.dir.replace(/^~/, os.homedir()))
      : resolveDefaultOutputDir(ctx);
    const limit = Math.max(1, Math.min(100, Number(args.limit) || 20));
    const patternRegex = args.pattern ? globToRegex(args.pattern) : null;
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      const files = entries
        .filter((e) => e.isFile())
        .filter((e) => !patternRegex || patternRegex.test(e.name))
        .slice(0, limit)
        .map((e) => path.join(dir, e.name));
      return createActionResult({
        success: true,
        observation: files.length > 0
          ? `Found ${files.length} file(s) in ${dir}:\n${files.join("\n")}`
          : `No files found in ${dir}${args.pattern ? ` matching "${args.pattern}"` : ""}`,
        metadata: {
          tool_id: "list_files",
          dir,
          files,
          coverage_scope: FILE_EVIDENCE_COVERAGE.DIRECTORY_LISTING_SHALLOW,
          content_extracted: false,
          recursive: false
        }
      });
    } catch (error) {
      return createActionResult({
        success: false,
        observation: `list_files failed: ${error.message}`,
        metadata: {
          tool_id: "list_files",
          dir,
          coverage_scope: FILE_EVIDENCE_COVERAGE.DIRECTORY_LISTING_SHALLOW,
          content_extracted: false,
          recursive: false
        }
      });
    }
  }
};


export const GLOB_FILES_TOOL = {
  id: "glob_files",
  name: "Glob Files",
  description: "Search for files matching a glob pattern (supports * and **). E.g. ~/Documents/**/*.pptx",
  parameters: ACTION_TOOL_SCHEMAS.glob_files,
  risk_level: "low",
  required_capabilities: ["file_read"],
  requires_confirmation: false,
  async execute(args = {}) {
    const pattern = String(args.pattern ?? "").replace(/^~/, os.homedir());
    if (!pattern) return createActionResult({ success: false, observation: "pattern required" });
    // Split into base dir and file pattern
    const parts = pattern.replace(/\\/g, "/").split("/");
    let baseIdx = parts.findIndex((p) => p.includes("*"));
    if (baseIdx < 0) baseIdx = parts.length - 1;
    const baseDir = path.resolve(parts.slice(0, baseIdx).join("/") || ".");
    const filePattern = parts.slice(baseIdx).join("/");
    const patternRegex = globToRegex(filePattern);

    async function walk(dir, depth = 0) {
      if (depth > 10) return [];
      const results = [];
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relPath = path.relative(baseDir, fullPath).replace(/\\/g, "/");
          if (entry.isFile() && patternRegex.test(relPath)) {
            results.push(fullPath);
          } else if (entry.isDirectory() && !entry.name.startsWith(".")) {
            results.push(...await walk(fullPath, depth + 1));
          }
        }
      } catch { /* skip inaccessible dirs */ }
      return results;
    }

    try {
      const files = (await walk(baseDir)).slice(0, 50);
      return createActionResult({
        success: true,
        observation: files.length > 0
          ? `Found ${files.length} file(s) matching "${args.pattern}":\n${files.join("\n")}`
          : `No files found matching "${args.pattern}"`,
        metadata: {
          tool_id: "glob_files",
          pattern,
          files,
          coverage_scope: FILE_EVIDENCE_COVERAGE.FILE_ENUMERATION_RECURSIVE,
          content_extracted: false,
          recursive: true
        }
      });
    } catch (error) {
      return createActionResult({
        success: false,
        observation: `glob_files failed: ${error.message}`
      });
    }
  }
};


export const FIND_RECENT_FILES_TOOL = {
  id: "find_recent_files",
  name: "Find Recent Files",
  description: "Find the most recently modified files of a given type (pptx, docx, xlsx, pdf, txt, md).",
  parameters: ACTION_TOOL_SCHEMAS.find_recent_files,
  risk_level: "low",
  required_capabilities: ["file_read"],
  requires_confirmation: false,
  async execute(args = {}, ctx = {}) {
    const kind = String(args.kind ?? "").toLowerCase();
    const limit = Math.max(1, Math.min(20, Number(args.limit) || 5));
    const sinceHours = Number(args.since_hours) || 24;
    const sinceMs = Date.now() - sinceHours * 3600 * 1000;
    const exts = FILE_KIND_EXTS[kind] ?? Object.values(FILE_KIND_EXTS).flat();
    const searchDir = resolveDefaultOutputDir(ctx);

    async function walk(dir, depth = 0) {
      if (depth > 6) return [];
      const results = [];
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isFile() && exts.includes(path.extname(entry.name).toLowerCase())) {
            try {
              const info = await stat(fullPath);
              if (info.mtimeMs >= sinceMs) {
                results.push({ path: fullPath, mtime: info.mtimeMs, size: info.size });
              }
            } catch { /* skip */ }
          } else if (entry.isDirectory() && !entry.name.startsWith(".")) {
            results.push(...await walk(fullPath, depth + 1));
          }
        }
      } catch { /* skip */ }
      return results;
    }

    try {
      const found = (await walk(searchDir))
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, limit);
      if (found.length === 0) {
        return createActionResult({
          success: true,
          observation: `No ${kind || "any"} files found in the last ${sinceHours}h under ${searchDir}`,
          metadata: {
            tool_id: "find_recent_files",
            files: [],
            coverage_scope: FILE_EVIDENCE_COVERAGE.FILE_ENUMERATION_RECURSIVE,
            content_extracted: false,
            recursive: true
          }
        });
      }
      const lines = found.map((f) => `${f.path} (${Math.round(f.size / 1024)}KB, ${new Date(f.mtime).toLocaleString()})`);
      return createActionResult({
        success: true,
        observation: `Found ${found.length} recent ${kind || "any"} file(s):\n${lines.join("\n")}`,
        metadata: {
          tool_id: "find_recent_files",
          files: found.map((f) => f.path),
          coverage_scope: FILE_EVIDENCE_COVERAGE.FILE_ENUMERATION_RECURSIVE,
          content_extracted: false,
          recursive: true
        }
      });
    } catch (error) {
      return createActionResult({
        success: false,
        observation: `find_recent_files failed: ${error.message}`
      });
    }
  }
};


export const GET_LATEST_ARTIFACT_TOOL = {
  id: "get_latest_artifact",
  name: "Get Latest Artifact",
  description: "Get the latest artifact of a given kind from the UCA artifact manifest.",
  parameters: ACTION_TOOL_SCHEMAS.get_latest_artifact,
  risk_level: "low",
  required_capabilities: ["file_read"],
  requires_confirmation: false,
  async execute(args = {}, ctx = {}) {
    const kind = String(args.kind ?? "").toLowerCase() || null;
    const outputDir = resolveDefaultOutputDir(ctx);
    try {
      const manifest = await readManifest(outputDir);
      let entries = manifest;
      if (kind && kind !== "any") {
        entries = manifest.filter((e) => e.kind === kind);
      }
      if (args.task_id) {
        entries = entries.filter((e) => e.task_id === args.task_id);
      }
      entries = entries.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
      const latest = entries[0];
      if (!latest) {
        return createActionResult({
          success: false,
          observation: `No ${kind ?? "any"} artifact found in manifest${args.task_id ? ` for task ${args.task_id}` : ""}`,
          metadata: { tool_id: "get_latest_artifact" }
        });
      }
      return createActionResult({
        success: true,
        observation: `Latest ${latest.kind} artifact: ${latest.path} (created ${latest.created_at})`,
        metadata: { tool_id: "get_latest_artifact", artifact: latest }
      });
    } catch (error) {
      return createActionResult({
        success: false,
        observation: `get_latest_artifact failed: ${error.message}`
      });
    }
  }
};
