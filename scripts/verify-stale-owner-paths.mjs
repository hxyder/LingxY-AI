#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

function fail(message) {
  console.error(`[stale-owner] ${message}`);
  process.exitCode = 1;
}

// AGENTS.md sweep rule: after every migration, prove no old-owner text
// assertions remain in active source, docs, scripts, or package config.

// Phase 2B: electron-main.mjs extracted helpers
const phase2bOldOwners = [
  { old: "tray/desktop-window-lifecycle.mjs", new: "shell/desktop-window-lifecycle.mjs" },
  { old: "tray/desktop-window-actions.mjs", new: "shell/desktop-window-actions.mjs" },
  { old: "tray/desktop-shortcut-router.mjs", new: "shell/desktop-shortcut-router.mjs" },
  { old: "tray/desktop-link-browser-window.mjs", new: "shell/desktop-link-browser-window.mjs" },
  { old: "tray/desktop-preview-window-manager.mjs", new: "shell/desktop-preview-window-manager.mjs" },
  { old: "tray/desktop-permission-handler.mjs", new: "shell/desktop-permission-handler.mjs" },
  { old: "tray/desktop-gui-smoke-runner.mjs", new: "smoke/desktop-gui-smoke-runner.mjs" },
];

// Phase REPO-1: moved IPC modules
const phaseRepo1OldOwners = [
  { old: "tray/ipc/", new: "main/ipc/" },
];

const allMoved = [...phase2bOldOwners, ...phaseRepo1OldOwners];

// Scan: walk all source files (not node_modules, not .git)
function walk(dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) walk(fp, files);
    else if (/\.(mjs|js|cjs|md|json|html|css)$/.test(e.name)) files.push(fp);
  }
  return files;
}

const allFiles = [...walk("src"), ...walk("scripts"), ...walk("docs"), ...walk("tests")];
allFiles.push("package.json", "index.cjs");

for (const file of allFiles) {
  const rel = path.relative(root, file).replace(/\\/g, "/");
  // Skip handoff history (audit trail, not active claims)
  if (rel.includes("handoff/current-status")) continue;
  // Skip the verifier itself (it checks for old paths)
  if (rel === "scripts/verify-stale-owner-paths.mjs") continue;
  // Skip the plan document (historical, not active)
  if (rel === "linxi_codebase_reorganization_execution_plan.md") continue;

  const content = readFileSync(file, "utf8");
  for (const { old: oldPath, new: newPath } of allMoved) {
    // The repo-directory verifier has intentional old-path checks; skip
    if (rel === "scripts/verify-repository-directory-architecture.mjs" && content.includes("should be")) continue;
    if (content.includes(oldPath)) {
      // Skip historical "moved from X → Y" documentation of the move itself
      const context = content.substring(content.indexOf(oldPath) - 30, content.indexOf(oldPath) + oldPath.length + 30);
      if (context.includes("moved from") || context.includes("←")) continue;
      fail(`${rel} still references ${oldPath} (should be ${newPath})`);
    }
  }
}

if (!process.exitCode) {
  console.log("[stale-owner] stale-owner path sweep clean");
}
