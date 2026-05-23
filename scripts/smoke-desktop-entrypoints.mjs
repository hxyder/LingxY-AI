#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const requiredFiles = [
  "index.cjs",
  "scripts/start-desktop.mjs",
  "src/desktop/tray/electron-main.mjs",
  "src/desktop/renderer/console.html",
  "src/desktop/renderer/overlay.html",
  "src/desktop/shared/manifest.mjs"
];

for (const file of requiredFiles) {
  assert.equal(existsSync(file), true, `missing desktop entry file: ${file}`);
}

const index = readFileSync("index.cjs", "utf8");
assert.match(index, /src[\\/]desktop[\\/]tray[\\/]electron-main\.mjs|electron-main\.mjs/);

const manifest = await import("../src/desktop/shared/manifest.mjs");
assert.equal(typeof manifest.WINDOW_IDS?.console, "string");
assert.equal(typeof manifest.IPC_CHANNELS?.shellReady, "string");

console.log("desktop entrypoint smoke ok");
