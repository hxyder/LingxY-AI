#!/usr/bin/env node
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { CHECK_COMMANDS, FAST_CHECK_COMMANDS } from "./check-manifest.mjs";

const checkpointModule = readFileSync("src/service/capabilities/tools/file-reversibility.mjs", "utf8");
const tools = [
  readFileSync("src/service/action_tools/tools/index.mjs", "utf8"),
  readFileSync("src/service/capabilities/tools/file-mutation-execution-tools.mjs", "utf8"),
  readFileSync("src/service/capabilities/tools/document-artifact-helpers.mjs", "utf8")
].join("\n");
const taskRoutes = readFileSync("src/service/core/http-routes/task-routes.mjs", "utf8");
const manifest = readFileSync("src/desktop/shared/manifest.mjs", "utf8");
const preload = readFileSync("src/desktop/renderer/preload.cjs", "utf8");
const main = readFileSync("src/desktop/tray/electron-main.mjs", "utf8");
const ipcModules = readdirSync("src/desktop/main/ipc", { withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.mjs$/u.test(entry.name))
  .map((entry) => readFileSync(path.join("src/desktop/main/ipc", entry.name), "utf8"))
  .join("\n");
const mainProcessIpc = `${main}\n${ipcModules}`;
const renderer = readFileSync("src/desktop/renderer/console-task-detail.mjs", "utf8");
const consoleJs = readFileSync("src/desktop/renderer/console.js", "utf8");
const behavior = readFileSync("tests/behavior/file-reversibility-checkpoint.test.mjs", "utf8");

assert.match(checkpointModule, /prepareFileReversibilityCheckpoint/u, "checkpoint helper must exist");
assert.match(checkpointModule, /copyFile\(absTarget,\s*backupPath\)/u, "existing files must be copied before mutation");
assert.match(checkpointModule, /reverse_operation:\s*"restore_file"/u, "existing-file mutations must expose restore operation");
assert.match(checkpointModule, /reverse_operation:\s*"delete_created_file"/u, "new-file mutations must expose delete-created operation");
assert.match(checkpointModule, /applyFileReversibilityCheckpoint/u, "checkpoint helper must apply one-click recovery");
assert.match(checkpointModule, /collectFileReversibilityCheckpoints/u, "checkpoint helper must collect recoverable task-event checkpoints");
assert.match(checkpointModule, /reversibility_sidecars/u, "checkpoint collector must include generated artifact sidecar checkpoints");

assert.match(tools, /prepareFileReversibilityCheckpoint\(ctx,[\s\S]*toolId:\s*"write_file"/u, "write_file must checkpoint before write");
assert.match(tools, /prepareFileReversibilityCheckpoint\(ctx,[\s\S]*toolId:\s*"edit_file"/u, "edit_file must checkpoint before edit");
assert.match(tools, /prepareGeneratedDocumentCheckpoint/u, "generate_document must use the shared checkpoint helper");
assert.match(tools, /prepareGeneratedDocumentCheckpoint\(\s*ctx,\s*absTarget,\s*`generate_document_\$\{kind\}`/u, "generate_document must checkpoint the primary artifact before rendering");
assert.match(tools, /generate_document_preview_sidecar/u, "generate_document must checkpoint preview sidecars before overwrite");
assert.match(tools, /reversibility_sidecars/u, "generate_document metadata must expose sidecar checkpoints");
assert.match(tools, /metadata:\s*\{[\s\S]*reversibility/u, "tool metadata must expose reversibility details");
assert.match(taskRoutes, /fileRecoveryMatch/u, "task routes must expose checkpoint recovery endpoint");
assert.match(taskRoutes, /file-recovery/u, "task routes must expose checkpoint recovery endpoint path");
assert.match(taskRoutes, /requireDesktopActor/u, "checkpoint recovery endpoint must require a desktop actor");
assert.match(taskRoutes, /collectFileReversibilityCheckpoints\(events\)/u, "checkpoint recovery endpoint must verify checkpoint id against task events");
assert.match(manifest, /taskFileRecoveryRestore/u, "desktop manifest must include file recovery IPC channel");
assert.match(preload, /restoreFileCheckpoint\(taskId,\s*checkpointId\)/u, "preload must expose file checkpoint restore bridge");
assert.match(mainProcessIpc, /taskFileRecoveryRestore/u, "main process must handle file checkpoint restore IPC");
assert.match(renderer, /renderFileReversibilityPanel/u, "task detail should render file recovery checkpoints");
assert.match(renderer, /data-file-reversibility-copy="1"/u, "file recovery panel should expose copy/export");
assert.match(renderer, /data-file-reversibility-restore/u, "file recovery panel should expose one-click restore");
assert.match(consoleJs, /renderFileReversibilityPanel\(detail\.events \?\? \[\]\)/u, "console task detail should include file recovery panel");
assert.match(consoleJs, /writeClipboardText\(reversibilityJson\)/u, "console should wire recovery export to clipboard");
assert.match(consoleJs, /restoreFileCheckpointViaShell/u, "console should restore checkpoints through the desktop shell bridge");
assert.match(consoleJs, /consoleShellClient\.restoreFileCheckpoint/u, "console restore must use preload bridge through the shell client");

assert.match(behavior, /delete_created_file/u, "behavior test must cover new-file reverse metadata");
assert.match(behavior, /restore_file/u, "behavior test must cover restore checkpoint metadata");
assert.match(behavior, /backup_path/u, "behavior test must verify backup contents");
assert.match(behavior, /generate_document records restore checkpoints for artifact and preview sidecar/u, "behavior test must cover generated-document sidecar checkpoints");
assert.match(behavior, /reversibility_sidecars/u, "behavior test must cover sidecar checkpoint metadata");
assert.match(behavior, /data-file-reversibility-copy="1"/u, "behavior test must cover visible recovery export");
assert.match(behavior, /applyFileReversibilityCheckpoint/u, "behavior test must cover applying recovery");
assert.match(behavior, /data-file-reversibility-restore="fw018_demo"/u, "behavior test must cover visible one-click restore button");
assert.match(behavior, /data-file-reversibility-restore="fw018_preview"/u, "behavior test must cover sidecar restore button rendering");

const command = "node scripts/verify-file-reversibility-checkpoint.mjs";
assert.ok(CHECK_COMMANDS.includes(command), "check manifest must include file reversibility verifier");
assert.ok(FAST_CHECK_COMMANDS.includes(command), "fast check manifest must include file reversibility verifier");

console.log("[verify-file-reversibility-checkpoint] FW-018 file checkpoint contract OK");
