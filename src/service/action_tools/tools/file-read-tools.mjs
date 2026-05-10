import { stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ACTION_TOOL_SCHEMAS } from "../schemas/index.mjs";
import { createActionResult } from "../types.mjs";
import { FILE_EVIDENCE_COVERAGE } from "../../core/file-evidence-coverage.mjs";

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
