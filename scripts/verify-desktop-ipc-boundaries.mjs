#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { IPC_CHANNELS } from "../src/desktop/shared/manifest.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const electronMainPath = path.join(repoRoot, "src", "desktop", "tray", "electron-main.mjs");
const ipcRoot = path.join(repoRoot, "src", "desktop", "main", "ipc");
const checkManifestPath = path.join(repoRoot, "scripts", "check-manifest.mjs");
const roadmapPath = path.join(repoRoot, "docs", "architecture", "post-runtime-upgrade-roadmap.md");

const MAX_HANDLER_LINES = 70;

function read(relOrAbs) {
  const target = path.isAbsolute(relOrAbs) ? relOrAbs : path.join(repoRoot, relOrAbs);
  return readFileSync(target, "utf8");
}

function relative(filePath) {
  return path.relative(repoRoot, filePath).replaceAll("\\", "/");
}

function walkJsFiles(dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkJsFiles(fullPath, files);
    } else if (/\.(?:mjs|js|cjs)$/.test(entry.name) && statSync(fullPath).isFile()) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function lineForOffset(source, offset) {
  return source.slice(0, offset).split(/\r?\n/).length;
}

function matchingParenOffset(source, openOffset) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = openOffset; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === "\"" || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(") depth += 1;
    if (ch === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function collectRegistrations(source, filePath) {
  const registrations = [];
  const pattern = /ipcMain\.(handle|on)\s*\(/g;
  let match;
  while ((match = pattern.exec(source))) {
    const open = source.indexOf("(", match.index);
    const close = matchingParenOffset(source, open);
    assert.notEqual(close, -1, `${relative(filePath)} has an unterminated ipcMain.${match[1]} call`);
    const body = source.slice(open + 1, close);
    const firstArg = body.split(",", 1)[0]?.trim() ?? "";
    const startLine = lineForOffset(source, match.index);
    const endLine = lineForOffset(source, close);
    registrations.push({
      kind: match[1],
      firstArg,
      key: normalizeChannelKey(firstArg),
      filePath,
      line: startLine,
      lineCount: endLine - startLine + 1
    });
    pattern.lastIndex = close + 1;
  }
  return registrations;
}

function normalizeChannelKey(firstArg) {
  const literal = firstArg.match(/^["']([^"']+)["']$/u);
  if (literal) return `literal:${literal[1]}`;
  const channelKey = firstArg.match(/^IPC_CHANNELS\.([A-Za-z0-9_]+)$/u);
  if (channelKey) {
    const value = IPC_CHANNELS[channelKey[1]];
    assert.ok(value, `Unknown IPC_CHANNELS key registered: ${firstArg}`);
    return `manifest:${channelKey[1]}:${value}`;
  }
  return `expr:${firstArg}`;
}

const electronMain = read(electronMainPath);
assert.doesNotMatch(
  electronMain,
  /ipcMain\.(?:handle|on)\s*\(/u,
  "electron-main.mjs must compose IPC modules, not register ipcMain handlers inline"
);
assert.match(
  electronMain,
  /registerShellWindowIpc\(/u,
  "electron-main.mjs must still compose extracted IPC registration modules"
);

const ipcFiles = walkJsFiles(ipcRoot);
assert.ok(ipcFiles.length >= 20, "desktop IPC modules must remain under src/desktop/main/ipc");

const registrations = [];
for (const filePath of ipcFiles) {
  const source = read(filePath);
  const rel = relative(filePath);
  const expectedExport = rel
    .split("/")
    .at(-1)
    .replace(/\.mjs$/u, "")
    .replace(/-([a-z])/gu, (_match, ch) => ch.toUpperCase());
  assert.match(
    source,
    new RegExp(`export function ${expectedExport}\\(`, "u"),
    `${rel} must export ${expectedExport}(...)`
  );
  assert.doesNotMatch(
    source,
    /(?:from\s+|import\(\s*)["'](?:\.\.\/)+service\//u,
    `${rel} must not import service modules directly; inject desktop service-client helpers`
  );
  assert.doesNotMatch(
    source,
    /["']src\/service\//u,
    `${rel} must not import service modules by absolute source path`
  );
  const fileRegistrations = collectRegistrations(source, filePath);
  assert.ok(fileRegistrations.length > 0, `${rel} must own at least one IPC registration`);
  for (const registration of fileRegistrations) {
    assert.ok(
      registration.lineCount <= MAX_HANDLER_LINES,
      `${rel}:${registration.line} IPC handler spans ${registration.lineCount} lines; extract normalization/service work`
    );
  }
  registrations.push(...fileRegistrations);
}

assert.equal(registrations.length, 112, "desktop IPC registration count changed; update IPC inventory intentionally");

const byChannel = new Map();
for (const registration of registrations) {
  const existing = byChannel.get(registration.key) ?? [];
  existing.push(registration);
  byChannel.set(registration.key, existing);
}
const duplicates = [...byChannel.entries()]
  .filter(([, items]) => items.length > 1)
  .flatMap(([key, items]) => items.map((item) => `${key} at ${relative(item.filePath)}:${item.line}`));
assert.equal(duplicates.length, 0, `duplicate IPC registrations found:\n${duplicates.join("\n")}`);

const hardcoded = registrations.filter((registration) => registration.key.startsWith("literal:"));
const expectedHardcoded = [
  "literal:uca:capture-active-window-context",
  "literal:uca:echo-bubble-show",
  "literal:uca:echo-wake",
  "literal:uca:get-desktop-audio-source",
  "literal:uca:get-note-recording-state",
  "literal:uca:get-pdf-worker-url",
  "literal:uca:get-settings",
  "literal:uca:note-recording-state",
  "literal:uca:preview-window-pin",
  "literal:uca:register-ctrl-enter",
  "literal:uca:set-echo-mode",
  "literal:uca:show-dock-menu",
  "literal:uca:unregister-ctrl-enter"
].sort();
assert.deepEqual(
  hardcoded.map((registration) => registration.key).sort(),
  expectedHardcoded,
  "hardcoded desktop IPC channel snapshot changed; move new channels into manifest or update inventory intentionally"
);

const checkManifest = read(checkManifestPath);
assert.match(
  checkManifest,
  /node scripts\/verify-desktop-ipc-boundaries\.mjs/u,
  "check manifest must include desktop IPC boundary verifier"
);
const roadmap = read(roadmapPath);
assert.match(roadmap, /DX-002: Electron Main IPC Boundary Split/u, "roadmap must track DX-002");
assert.match(roadmap, /verify-desktop-ipc-boundaries/u, "roadmap must reference desktop IPC boundary verifier");

console.log("[verify-desktop-ipc-boundaries] desktop IPC boundary contract OK");
