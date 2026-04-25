// Phase 8 verifier (UCA-182) — notifications consolidated into popup-card.
//
// Three pre-Phase-8 systems (bottom-center result-toast, separate
// notification BrowserWindow, floating popup-card) are now one: every
// toast / notification / artifact surface routes through the top-right
// popup-card stack. This verifier proves the other two systems are
// actually retired, not just made dormant.

import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// --- 1. result-toast DOM + CSS gone in overlay.html ------------------
{
  const html = await readFile(path.join(ROOT, "src/desktop/renderer/overlay.html"), "utf8");
  assert.ok(!html.includes('id="resultToast"'),
    "result-toast <div> must be removed from overlay.html");
  assert.ok(!html.includes('id="toastTitle"'),
    "toastTitle element must be gone");
  assert.ok(!html.includes('id="toastOpenBtn"'),
    "toastOpenBtn element must be gone");
  // CSS class should not be defined any more (only comments allowed).
  const classDefs = html.match(/(?<!\/\*[^*]*?)\.result-toast\s*[{.,]/g) ?? [];
  assert.equal(classDefs.length, 0,
    ".result-toast CSS selectors must be removed");
}

// --- 2. overlay.js no longer queries the toast DOM -------------------
{
  const js = await readFile(path.join(ROOT, "src/desktop/renderer/overlay.js"), "utf8");
  assert.ok(!js.includes('document.querySelector("#resultToast")'),
    "overlay.js must not query #resultToast");
  assert.ok(!js.includes('document.querySelector("#toastTitle")'),
    "overlay.js must not query #toastTitle");
  assert.ok(!js.includes('document.querySelector("#toastOpenBtn")'),
    "overlay.js must not query #toastOpenBtn");
  assert.ok(js.includes("window.ucaShell?.showPopupCard"),
    "showToast() must delegate to showPopupCard");
  assert.ok(js.includes('"preview", "reveal", "copy", "continue", "open_overlay"'),
    "overlay.js must react to success-kind popup-card resolves (preview/reveal/copy/continue/open_overlay)");
  assert.ok(js.includes('action === "preview"'),
    "overlay.js must wire the preview action in the popup-card resolve listener");
}

// --- 3. popup-card.js supports artifact-aware success kind ----------
{
  const js = await readFile(path.join(ROOT, "src/desktop/renderer/popup-card.js"), "utf8");
  assert.ok(js.includes("payload?.artifactPath"),
    "popup-card.js success kind must read artifactPath");
  assert.ok(js.includes('resolveCard("preview"'),
    "popup-card.js must emit 预览 action");
  assert.ok(js.includes('resolveCard("reveal"'),
    "popup-card.js must emit 打开文件夹 action");
  assert.ok(js.includes('resolveCard("copy"'),
    "popup-card.js must emit 复制 action");
  assert.ok(js.includes('resolveCard("continue"'),
    "popup-card.js must emit 继续追问 action");
}

// --- 4. notification window retired in manifest + main --------------
{
  const manifest = await readFile(path.join(ROOT, "src/desktop/shared/manifest.mjs"), "utf8");
  assert.ok(!manifest.match(/id:\s*WINDOW_IDS\.notification,\s*title/),
    "manifest must not register the notification BrowserWindow");
  const main = await readFile(path.join(ROOT, "src/desktop/tray/electron-main.mjs"), "utf8");
  assert.ok(!main.includes('windowDef.id === "notification"'),
    "electron-main must not special-case the notification window id");
  assert.ok(main.includes("registeredPopupCardManager.showCard"),
    "showDesktopNotification must route through the popup-card manager");
  assert.ok(main.includes("meta: card.meta ?? null"),
    "popup-card resolve broadcast must forward meta to overlay");
}

// --- 5. renderer files deleted --------------------------------------
{
  let notifHtmlGone = false;
  let notifJsGone = false;
  try { await stat(path.join(ROOT, "src/desktop/renderer/notification.html")); } catch { notifHtmlGone = true; }
  try { await stat(path.join(ROOT, "src/desktop/renderer/notification.js")); } catch { notifJsGone = true; }
  assert.ok(notifHtmlGone, "notification.html must be deleted");
  assert.ok(notifJsGone, "notification.js must be deleted");
}

console.log("ok verify-notifications-unified");
