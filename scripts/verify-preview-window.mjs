// Phase 14 verifier (UCA-182) — dedicated preview BrowserWindow on
// the right edge of the primary display. Asserts that the old in-
// overlay panel is gone and all preview actions now go through IPC.

import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// --- 1. preview-window files exist ----------------------------------
{
  await stat(path.join(ROOT, "src/desktop/renderer/preview-window.html"));
  await stat(path.join(ROOT, "src/desktop/renderer/preview-window.js"));
}

// --- 2. live-preview.js is a thin IPC proxy (no DOM injection) ------
{
  const src = await readFile(path.join(ROOT, "src/desktop/renderer/live-preview.js"), "utf8");
  // Must no longer inject a #livePreview root into the host page.
  assert.ok(!/createElement\("div"\)[\s\S]{0,200}id\s*=\s*"livePreview"/.test(src),
    "live-preview.js must not inject a #livePreview DOM root into overlay/console");
  // Must delegate through ucaShell IPC helpers.
  assert.ok(src.includes("shell.showPreviewWindow"),
    "live-preview.js must forward openForTool / openForFile through showPreviewWindow");
  assert.ok(src.includes("shell.appendPreviewDelta"),
    "live-preview.js must forward appendDelta through appendPreviewDelta");
  assert.ok(src.includes("shell.commitPreviewWindow"),
    "live-preview.js must forward commit through commitPreviewWindow");
  assert.ok(src.includes("shell.closePreviewWindow"),
    "live-preview.js must forward close through closePreviewWindow");
}

// --- 3. preload exposes the new IPC surface -------------------------
{
  const src = await readFile(path.join(ROOT, "src/desktop/renderer/preload.cjs"), "utf8");
  for (const fn of [
    "showPreviewWindow",
    "appendPreviewDelta",
    "commitPreviewWindow",
    "closePreviewWindow",
    "setPreviewWindowAlwaysOnTop",
    "onPreviewWindowInit",
    "onPreviewWindowDelta",
    "onPreviewWindowCommitted"
  ]) {
    assert.ok(src.includes(fn), `preload.cjs must expose ucaShell.${fn}`);
  }
}

// --- 4. manifest registers IPC channels + window id -----------------
{
  const src = await readFile(path.join(ROOT, "src/desktop/shared/manifest.mjs"), "utf8");
  for (const key of [
    "previewWindowShow",
    "previewWindowAppendDelta",
    "previewWindowCommit",
    "previewWindowClose",
    "previewWindowInit",
    "previewWindowDelta",
    "previewWindowCommitted"
  ]) {
    assert.ok(src.includes(key), `manifest.mjs IPC_CHANNELS must declare ${key}`);
  }
  assert.ok(src.match(/preview:\s*"preview"/),
    "manifest.mjs WINDOW_IDS must register `preview`");
}

// --- 5. electron-main wires the window + IPC handlers ---------------
{
  const src = await readFile(path.join(ROOT, "src/desktop/tray/electron-main.mjs"), "utf8");
  assert.ok(src.includes("function computePreviewBounds"),
    "electron-main must compute the right-edge bounds for the preview window");
  assert.ok(src.includes("function ensurePreviewWindow"),
    "electron-main must lazily create the preview BrowserWindow");
  assert.ok(src.match(/workArea\.x \+ workArea\.width - width/),
    "electron-main must anchor the preview window to the right edge of workArea");
  assert.ok(src.includes("IPC_CHANNELS.previewWindowShow"),
    "electron-main must handle previewWindowShow");
  assert.ok(src.includes("IPC_CHANNELS.previewWindowAppendDelta"),
    "electron-main must handle previewWindowAppendDelta");
  assert.ok(src.includes("IPC_CHANNELS.previewWindowCommit"),
    "electron-main must handle previewWindowCommit");
}

console.log("ok verify-preview-window");
