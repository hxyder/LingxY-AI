import { execFile, spawn } from "node:child_process";
import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
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

export const COPY_TO_CLIPBOARD_TOOL = {
  id: "copy_to_clipboard",
  name: "Copy To Clipboard",
  description: "Write text to the system clipboard.",
  parameters: ACTION_TOOL_SCHEMAS.copy_to_clipboard,
  risk_level: "low",
  required_capabilities: ["clipboard_write"],
  requires_confirmation: false,
  formatObservation(args) {
    return `Copied ${String(args.content).length} characters to the clipboard`;
  },
  async execute(args = {}) {
    const content = args.content ?? args.text ?? args.value ?? "";
    if (!content) return createActionResult({ success: false, observation: "content required" });
    const text = typeof content === "string" ? content : JSON.stringify(content);
    try {
      if (process.platform === "win32") {
        await execFileAsync("powershell.exe", [
          "-NoProfile", "-Command",
          `Set-Clipboard -Value ${JSON.stringify(text)}`
        ], { windowsHide: true });
      } else if (process.platform === "darwin") {
        const child = spawn("pbcopy");
        child.stdin.write(text);
        child.stdin.end();
        await new Promise((resolve) => child.on("close", resolve));
      } else {
        const child = spawn("xclip", ["-selection", "clipboard"]);
        child.stdin.write(text);
        child.stdin.end();
        await new Promise((resolve) => child.on("close", resolve));
      }
      const preview = text.slice(0, 60);
      return createActionResult({
        success: true,
        observation: `Copied ${text.length} chars to clipboard${text.length > 60 ? `: "${preview}…"` : `: "${preview}"`}`
      });
    } catch (error) {
      return createActionResult({ success: false, observation: `Failed to copy: ${error.message}` });
    }
  }
};

export const NOTIFY_TOOL = {
  id: "notify",
  name: "Notify",
  description: "Display a notification with configurable auto-dismiss.",
  parameters: ACTION_TOOL_SCHEMAS.notify,
  risk_level: "low",
  required_capabilities: ["notification"],
  requires_confirmation: false,
  formatObservation(args) {
    return `Notified ${args.title ?? ""}`;
  },
  async execute(args = {}, ctx = {}) {
    const baseDir = ctx.runtime?.paths?.baseDir
      ?? path.join(os.tmpdir(), "uca-test-runtime");
    const notificationDir = args.notificationDir
      ?? path.join(baseDir, "notifications");
    await mkdir(notificationDir, { recursive: true });
    const notificationPath = path.join(notificationDir, `notification-${Date.now()}-${crypto.randomUUID()}.json`);
    const payload = {
      kind: args.kind ?? undefined,
      title: args.title ?? "UCA 提醒",
      body: args.body ?? args.message ?? "时间到了",
      created_at: new Date().toISOString(),
      handoff: args.handoff ?? null,
      navigate: args.navigate ?? null,
      taskId: args.taskId ?? ctx.task?.task_id ?? null,
      artifactPath: args.artifactPath ?? null,
      mime: args.mime ?? null,
      inlinePreview: args.inlinePreview ?? null,
      openWindow: args.openWindow ?? null,
      allowContinue: args.allowContinue ?? undefined,
      allowLongBody: args.allowLongBody ?? undefined,
      autoHideMs: args.autoHideMs ?? undefined,
      dedupeKey: args.dedupeKey ?? undefined,
      skipBatch: args.skipBatch ?? undefined,
      forcePopup: args.forcePopup ?? undefined
    };
    await writeFile(notificationPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return createActionResult({
      success: true,
      observation: `Displayed notification "${payload.title}"`,
      metadata: {
        tool_id: "notify",
        notification_path: notificationPath
      }
    });
  }
};

export const COMPOSE_EMAIL_TOOL = {
  id: "compose_email",
  name: "Compose Email",
  description: "Open a mail draft with prefilled recipients, subject, and body.",
  parameters: ACTION_TOOL_SCHEMAS.compose_email,
  risk_level: "low",
  required_capabilities: ["launch_app"],
  requires_confirmation: false,
  formatObservation(args) {
    return `Prepared a draft email to ${(args.to ?? []).join(", ")}`;
  },
  async execute(args = {}) {
    let toList = [];
    if (Array.isArray(args.to)) toList = args.to;
    else if (typeof args.to === "string" && args.to.trim()) toList = [args.to.trim()];

    let ccList = [];
    if (Array.isArray(args.cc)) ccList = args.cc;
    else if (typeof args.cc === "string" && args.cc.trim()) ccList = [args.cc.trim()];

    const subject = args.subject ?? "";
    const body = args.body ?? "";

    const params = [];
    if (subject) params.push(`subject=${encodeURIComponent(subject)}`);
    if (body) params.push(`body=${encodeURIComponent(body)}`);
    if (ccList.length > 0) params.push(`cc=${encodeURIComponent(ccList.join(","))}`);
    const mailto = `mailto:${toList.join(",")}${params.length > 0 ? "?" + params.join("&") : ""}`;

    try {
      await openWithDefaultHandler(mailto);
      const recipients = toList.length > 0 ? toList.join(", ") : "(no recipient)";
      return createActionResult({
        success: true,
        observation: `Opened email draft to ${recipients}${subject ? ` with subject "${subject}"` : ""}.`
      });
    } catch (error) {
      return createActionResult({ success: false, observation: `Failed to open email draft: ${error.message}` });
    }
  }
};
