import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { ACTION_TOOL_SCHEMAS } from "../schemas/index.mjs";
import { createActionResult } from "../types.mjs";
import { openWithDefaultHandler } from "./open-with-default-handler.mjs";

const execFileAsync = promisify(execFile);

export const OPEN_FILE_TOOL = {
  id: "open_file",
  name: "Open File",
  description: "Open a local file with the associated application.",
  parameters: ACTION_TOOL_SCHEMAS.open_file,
  risk_level: "medium",
  required_capabilities: ["file_read", "launch_app"],
  requires_confirmation: false,
  formatObservation(args) {
    return `Opened file ${args.path}`;
  },
  async execute(args = {}) {
    const target = args.path;
    if (!target) return createActionResult({ success: false, observation: "path required" });
    try {
      await openWithDefaultHandler(target);
      return createActionResult({ success: true, observation: `Opened ${target}` });
    } catch (error) {
      return createActionResult({ success: false, observation: `Failed to open file: ${error.message}` });
    }
  }
};

export const REVEAL_IN_EXPLORER_TOOL = {
  id: "reveal_in_explorer",
  name: "Reveal In Explorer",
  description: "Reveal a local file in Explorer.",
  parameters: ACTION_TOOL_SCHEMAS.reveal_in_explorer,
  risk_level: "low",
  required_capabilities: ["file_read"],
  requires_confirmation: false,
  formatObservation(args) {
    return `Revealed ${args.path} in Explorer`;
  },
  async execute(args = {}) {
    if (!args.path) return createActionResult({ success: false, observation: "path required" });
    try {
      if (process.platform === "win32") {
        await execFileAsync("explorer.exe", ["/select,", args.path]);
      } else {
        return OPEN_FILE_TOOL.execute({ path: path.dirname(args.path) });
      }
      return createActionResult({ success: true, observation: `Revealed ${args.path}` });
    } catch (error) {
      return createActionResult({ success: false, observation: `Failed to reveal: ${error.message}` });
    }
  }
};

export const FILE_OP_TOOL = {
  id: "file_op",
  name: "File Operation",
  description: "Perform a constrained file operation in the allowed workspace.",
  parameters: ACTION_TOOL_SCHEMAS.file_op,
  risk_level: "medium",
  required_capabilities: ["file_write"],
  requires_confirmation: false,
  async execute(args) {
    return createActionResult({
      success: true,
      observation: `Prepared file operation ${args.operation} for ${args.path}`,
      metadata: {
        operation: args.operation,
        targetPath: args.targetPath ?? null
      }
    });
  }
};
