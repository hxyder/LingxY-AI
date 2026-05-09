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
  assert.ok(src.match(/workArea\.x \+ Math\.max\(0, Math\.round\(\(workArea\.width - width\) \/ 2\)\)/),
    "electron-main must center the larger document preview window in the work area");
  assert.ok(src.includes("IPC_CHANNELS.previewWindowShow"),
    "electron-main must handle previewWindowShow");
  assert.ok(src.includes("IPC_CHANNELS.previewWindowAppendDelta"),
    "electron-main must handle previewWindowAppendDelta");
  assert.ok(src.includes("IPC_CHANNELS.previewWindowCommit"),
    "electron-main must handle previewWindowCommit");
}

// --- 6. terminal preview states never remain loading ------------------
{
  const previewSrc = await readFile(path.join(ROOT, "src/desktop/renderer/preview-window.js"), "utf8");
  assert.ok(previewSrc.includes("没有收到可预览的文件路径"),
    "preview-window must render a terminal empty state when commit succeeds without an artifact path");
  assert.ok(/const committedToolName = toolName \|\| state\.toolName/.test(previewSrc),
    "preview-window commits must be able to finalize artifact_created events without a toolName");
  assert.ok(previewSrc.includes("runGenerateDocumentDraftFamilyMatrix"),
    "preview-window smoke must cover generate_document draft previews across docx/pdf/html/xlsx/pptx");
  for (const marker of ["Word 草稿预览", "PDF 草稿预览", "HTML 草稿预览", "Excel 草稿预览", "PowerPoint 草稿预览"]) {
    assert.ok(previewSrc.includes(marker), `preview-window draft matrix must assert ${marker}`);
  }

  const overlaySrc = await readFile(path.join(ROOT, "src/desktop/renderer/overlay.js"), "utf8");
  const consoleSrc = await readFile(path.join(ROOT, "src/desktop/renderer/console.js"), "utf8");
  assert.ok(/frame\.event === "artifact_created"[\s\S]{0,260}livePreview\?\.commit/.test(overlaySrc),
    "overlay must allow artifact_created to finalize the live preview");
  assert.ok(/frame\.event === "artifact_created"[\s\S]{0,260}livePreview\?\.commit/.test(consoleSrc),
    "console must allow artifact_created to finalize the live preview");
}

console.log("ok verify-preview-window");
