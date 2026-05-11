#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

// REPO-1.3: no active inventory doc may claim old tray/ paths for moved shell helpers
const movedToShell = [
  "desktop-window-lifecycle.mjs",
  "desktop-window-actions.mjs",
  "desktop-shortcut-router.mjs",
  "desktop-link-browser-window.mjs",
  "desktop-preview-window-manager.mjs",
  "desktop-permission-handler.mjs"
];
for (const name of movedToShell) {
  const oldPath = `src/desktop/tray/${name}`;
  const newPath = `src/desktop/shell/${name}`;
  for (const docPath of ["docs/architecture/codebase-file-inventory.md", "docs/architecture/desktop-app-layout-inventory.md"]) {
    if (!existsSync(path.join(root, docPath))) continue;
    const content = read(docPath);
    if (content.includes(oldPath)) {
      fail(`${docPath} still references old shell helper path: ${oldPath} (should be ${newPath})`);
    }
  }
}

// REPO-1.4: renderer shared clients must exist at documented paths
const sharedClients = [
  { path: "src/desktop/renderer/shared/runtime-http-client.mjs", desc: "runtime HTTP client" },
  { path: "src/desktop/renderer/shared/runtime-task-client.mjs", desc: "runtime task client" },
  { path: "src/desktop/renderer/shared/shell-client.mjs", desc: "shell preload bridge client" },
  { path: "src/desktop/renderer/shared/echo-runtime-client.mjs", desc: "echo runtime client" },
];
for (const { path: p, desc } of sharedClients) {
  assert(existsSync(path.join(root, p)), `renderer shared client missing: ${p} (${desc})`);
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

// REPO-1.2 guard: every IPC module must be dynamically importable so
// broken relative imports fail here instead of at Electron GUI startup.
for (const name of ipcModules) {
  try {
    await import(pathToFileURL(path.join(ipcDir, name)).href);
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") {
      fail(`IPC module import broken: ${name} — ${error.message}`);
    }
    // Runtime errors from module evaluation (missing electron APIs etc.)
    // are expected; only ERR_MODULE_NOT_FOUND means a broken path.
  }
}

// REPO-1.5a preflight: migration-mode checks
const consoleDir = path.join(root, "src/desktop/renderer/console");
const rendererDir = path.join(root, "src/desktop/renderer");
const preExistingClients = new Set([
  "console-connectors-client.mjs",
  "console-notes-runtime-client.mjs",
  "console-skills-client.mjs"
]);

const consoleFiles = existsSync(consoleDir)
  ? readdirSync(consoleDir).filter(f => f.endsWith(".mjs") || f.endsWith(".js"))
  : [];
const migratedFiles = consoleFiles.filter(f => !preExistingClients.has(f));

function repo15aOldFlatName(movedName) {
  if (movedName === "console.js") return "console.js";
  return `console-${movedName}`;
}

function repo15aAssertReExportOnly(oldName, movedName, barrelContent) {
  const activeLines = barrelContent
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith("//"));
  const escapedMovedName = movedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const exportAll = new RegExp(`^export\\s+\\*\\s+from\\s+['"]\\./console/${escapedMovedName}['"];?$`);
  const exportNamed = new RegExp(`^export\\s+\\{[^}]+\\}\\s+from\\s+['"]\\./console/${escapedMovedName}['"];?$`);
  if (activeLines.length === 0 || !activeLines.every(line => exportAll.test(line) || exportNamed.test(line))) {
    fail(`REPO-1.5a flat path is not a re-export-only barrel: ${oldName}`);
  }
}

if (migratedFiles.length > 0) {
  const anyOldFlatExists = migratedFiles.some(f => {
    const oldName = repo15aOldFlatName(f);
    return existsSync(path.join(rendererDir, oldName));
  });

  if (anyOldFlatExists) {
    // BARREL WINDOW: old flat files still exist; must be re-export-only barrels
    for (const f of migratedFiles) {
      const oldName = repo15aOldFlatName(f);
      const oldPath = path.join(rendererDir, oldName);
      if (!existsSync(oldPath)) {
        fail(`REPO-1.5a barrel missing: ${oldName}`);
      }
      const barrelContent = readFileSync(oldPath, "utf8");
      repo15aAssertReExportOnly(oldName, f, barrelContent);
    }
  }

  // No old-name cross-references in moved files (applies in both modes)
  for (const f of migratedFiles) {
    const content = readFileSync(path.join(consoleDir, f), "utf8");
    const oldRefs = content.match(/from ['\"]\.\.?\/console-[a-z-]+\.mjs['\"]/g) ?? [];
    for (const ref of oldRefs) {
      fail(`REPO-1.5a cross-ref in ${f}: ${ref}`);
    }
  }
} else {
  // PRE-MIGRATION: verify known cross-references exist (prove baseline unchanged)
  for (const { file, pattern } of [
    { file: "console-inbox-view.mjs", pattern: "./console-account-connectors-view.mjs" },
    { file: "console-task-list.mjs", pattern: "./console-task-detail.mjs" }
  ]) {
    const flatPath = path.join(rendererDir, file);
    if (existsSync(flatPath)) {
      const content = readFileSync(flatPath, "utf8");
      if (!content.includes(pattern)) {
        fail(`REPO-1.5a pre-move: ${file} no longer imports ${pattern}`);
      }
    }
  }
  // No stale barrels from previous incomplete migration
  for (const f of readdirSync(rendererDir).filter(f => f.startsWith("console-") && f.endsWith(".mjs"))) {
    if (preExistingClients.has(f)) continue;
    const content = readFileSync(path.join(rendererDir, f), "utf8");
    if (content.includes("Compatibility barrel") || content.includes("export * from")) {
      fail(`REPO-1.5a stale barrel: ${f}`);
    }
  }
}

if (!process.exitCode) {
  console.log("[repo-arch] repository directory architecture verified");
}
