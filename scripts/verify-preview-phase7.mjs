// Phase 7 verifier (UCA-182) — drop guard + artifact click → in-app preview.
//
// Static-only assertions (we don't drive the Electron UI from Node):
//   1. drop-guard.js exists and installs window-level handlers.
//   2. console.html and overlay.html load drop-guard.js BEFORE any other
//      preview / app script, so the guard wins event ordering.
//   3. live-preview.js exports openForFile on window.livePreview.
//   4. overlay.js's "打开文件" / "打开结果" buttons call livePreview.openForFile
//      before falling back to shell.openPath.
//   5. console.js's task-artifact-open handler does the same.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// --- 1. drop-guard exists and calls preventDefault -------------------
{
  const src = await readFile(path.join(ROOT, "src/desktop/renderer/drop-guard.js"), "utf8");
  assert.ok(src.includes("window.addEventListener(\"dragover\""),
    "drop-guard must bind window dragover");
  assert.ok(src.includes("window.addEventListener(\"drop\""),
    "drop-guard must bind window drop");
  assert.ok(/event\.preventDefault\(\)/.test(src),
    "drop-guard must preventDefault on file payloads");
}

// --- 2. Guard loaded first in both renderers -------------------------
for (const htmlPath of ["src/desktop/renderer/console.html", "src/desktop/renderer/overlay.html"]) {
  const html = await readFile(path.join(ROOT, htmlPath), "utf8");
  const guardIndex = html.indexOf('src="./drop-guard.js"');
  const registryIndex = html.indexOf('src="./preview/client-registry.js"');
  const livePreviewIndex = html.indexOf('src="./live-preview.js"');
  assert.ok(guardIndex > 0, `${htmlPath} must include drop-guard.js`);
  assert.ok(registryIndex > 0, `${htmlPath} must include client-registry.js`);
  assert.ok(livePreviewIndex > 0, `${htmlPath} must include live-preview.js`);
  assert.ok(guardIndex < registryIndex && guardIndex < livePreviewIndex,
    `${htmlPath}: drop-guard must load BEFORE preview scripts`);
}

// --- 3. live-preview.js exports openForFile --------------------------
{
  const src = await readFile(path.join(ROOT, "src/desktop/renderer/live-preview.js"), "utf8");
  assert.ok(src.includes("function openForFile"),
    "live-preview.js must define openForFile");
  assert.ok(src.match(/window\.livePreview\s*=\s*\{[\s\S]*openForFile[\s\S]*\}/),
    "live-preview.js must export openForFile on window.livePreview");
}

// --- 4. overlay.js uses openForFile for artifact buttons -------------
{
  const src = await readFile(path.join(ROOT, "src/desktop/renderer/overlay.js"), "utf8");
  const openForFileCalls = (src.match(/livePreview\?\.openForFile\?\.\(/g) ?? []).length;
  assert.ok(openForFileCalls >= 2,
    `overlay.js should call livePreview.openForFile in at least 2 places (toast + bubble); found ${openForFileCalls}`);
}

// --- 5. console.js uses openForFile for artifact open ---------------
{
  const src = await readFile(path.join(ROOT, "src/desktop/renderer/console.js"), "utf8");
  assert.ok(src.includes("livePreview?.openForFile"),
    "console.js task-artifact-open handler must prefer openForFile");
}

console.log("ok verify-preview-phase7");
