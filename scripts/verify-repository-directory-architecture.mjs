#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

function fail(message) {
  console.error(`[repo-arch] ${message}`);
  process.exitCode = 1;
}

// Phase REPO-0: repository directory architecture verifier

const docPath = "docs/architecture/repository-directory-architecture.md";
assert(existsSync(path.join(root, docPath)), "repo directory architecture doc missing");

const doc = read(docPath);
assert(doc.includes("Repository Directory Architecture"), "repo arch doc missing title");
assert(doc.includes("Current Layout"), "repo arch doc must have current layout");
assert(doc.includes("Target Architecture"), "repo arch doc must have target layout");
assert(doc.includes("Migration Rules"), "repo arch doc must have migration rules");
assert(doc.includes("Current Phase Status"), "repo arch doc must have phase status");

// Documented current roots must exist (match actual repo paths)
const currentRoots = [
  "src/desktop",
  "src/service",
  "scripts",
  "tests",
  "docs",
  "assets",
  "uca-native-host",
];
for (const rel of currentRoots) {
  assert(existsSync(path.join(root, rel)), `documented current root missing: ${rel}`);
}
// The doc must reference the actual native host path (not a fictional one)
assert(doc.includes("uca-native-host"), "repo arch doc must use real native host root: uca-native-host");
assert(!doc.includes("native-host/") || doc.includes("uca-native-host"),
  "repo arch doc must not name a fictional native-host/ without the real uca-native-host/ path");

// Target layout concepts are named in the doc
for (const term of ["apps/", "native-host", "packages/", "capabilities/"]) {
  assert(doc.includes(term), `repo arch doc must reference target concept: ${term}`);
}

// Runtime/user data roots must be outside src
const userDataPaths = ["src/user-data", "src/user-config", "src/user-plugins"];
for (const p of userDataPaths) {
  assert(!existsSync(path.join(root, p)),
    `user data path must not exist under src/: ${p}`);
}

// High-risk deferred items must be documented
assert(doc.includes("high-risk deferred") || doc.includes("deferred"),
  "repo arch doc must document high-risk deferred items");

// Phase REPO-1: desktop app contracts that must survive directory moves
const desktopContracts = [
  { path: "src/desktop/tray/electron-main.mjs", desc: "composition root" },
  { path: "src/desktop/renderer/preload.cjs", desc: "preload bridge" },
  { path: "src/desktop/shared/manifest.mjs", desc: "IPC channels + shell manifest" },
  { path: "src/desktop/main/ipc", desc: "IPC modules directory (REPO-1.2)" },
  { path: "src/desktop/smoke/desktop-gui-smoke-runner.mjs", desc: "smoke runner (REPO-1.1 target)" },
];
for (const { path: p, desc } of desktopContracts) {
  assert(existsSync(path.join(root, p)), `desktop contract missing: ${p} (${desc})`);
}

// REPO-1.1: no active inventory doc may claim the old smoke runner path
const inventoryDocs = [
  "docs/architecture/desktop-app-layout-inventory.md",
  "docs/architecture/codebase-file-inventory.md"
];
for (const docPath of inventoryDocs) {
  if (!existsSync(path.join(root, docPath))) continue;
  const content = read(docPath);
  // The old TRAY path for smoke runner must not appear in current-state sections
  if (content.includes("src/desktop/tray/desktop-gui-smoke-runner.mjs")) {
    fail(`${docPath} still references old smoke runner path (should be src/desktop/smoke/)`);
  }
}

// IPC module count must remain 21 (any move must preserve all modules)
const ipcDir = path.join(root, "src/desktop/main/ipc");
const ipcModules = readdirSync(ipcDir).filter(f => f.startsWith("register-") && f.endsWith(".mjs"));
assert(ipcModules.length === 21, `IPC module count must be 21, got ${ipcModules.length}`);

// Desktop app layout inventory doc must exist
const desktopInventoryPath = "docs/architecture/desktop-app-layout-inventory.md";
assert(existsSync(path.join(root, desktopInventoryPath)),
  "desktop app layout inventory doc missing");
const desktopDoc = read(desktopInventoryPath);
assert(desktopDoc.includes("Desktop App Layout Inventory"),
  "desktop layout inventory missing title");
assert(desktopDoc.includes("Current Layout") && desktopDoc.includes("Target Layout"),
  "desktop layout inventory must have current and target layouts");
assert(desktopDoc.includes("Contracts That Must Not Change"),
  "desktop layout inventory must document contracts that must not change");

if (!process.exitCode) {
  console.log("[repo-arch] repository directory architecture verified");
}
