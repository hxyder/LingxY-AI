#!/usr/bin/env node
/**
 * verify-popup-card-fit.mjs — UCA-177
 *
 * Locks in the "top-right card buttons + content are sometimes clipped"
 * fix. The card now measures its own content after render and asks main
 * to resize the window; the actions row wraps so multi-button approval
 * cards never overflow.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

const manifest = read("src/desktop/shared/manifest.mjs");
const manager = read("src/desktop/tray/popup-card-manager.mjs");
const preload = read("src/desktop/renderer/preload.cjs");
const cardJs = read("src/desktop/renderer/popup-card.js");
const cardCss = read("src/desktop/renderer/popup-card.css");

// Manifest channel for resize round-trip.
assert.match(manifest, /popupCardResize:\s*"uca:popup-card-resize"/,
  "manifest.mjs missing popupCardResize channel");

// Main-process handler resizes + reflows, with clamp to [MIN, MAX].
assert.match(manager, /function resizeCard\(cardId, requestedHeight\)/,
  "popup-card-manager.mjs missing resizeCard() function");
assert.match(manager, /ipcMain\.handle\(IPC_CHANNELS\.popupCardResize/,
  "popup-card-manager.mjs must register the resize IPC handler");
assert.match(manager, /Math\.min\(\s*CARD_HEIGHT_MAX/,
  "resizeCard must clamp to CARD_HEIGHT_MAX");
assert.match(manager, /Math\.max\(\s*CARD_HEIGHT_MIN/,
  "resizeCard must clamp to CARD_HEIGHT_MIN");
assert.match(manager, /reflowStack\(\);/,
  "resizeCard must reflow the stack after a resize");

// Max height must stay at least 480 so longer approval bodies fit without
// forcing the body scrollbar.
{
  const maxMatch = manager.match(/CARD_HEIGHT_MAX\s*=\s*(\d+)/);
  assert.ok(maxMatch, "popup-card-manager.mjs missing CARD_HEIGHT_MAX constant");
  assert.ok(Number(maxMatch[1]) >= 480,
    "CARD_HEIGHT_MAX should be at least 480 to avoid clipping approval content");
}

// Preload exposes the resize bridge.
assert.match(preload, /resizePopupCard\(cardId, height\)/,
  "preload.cjs missing resizePopupCard bridge method");
assert.match(preload, /ipcRenderer\.invoke\("uca:popup-card-resize"/,
  "preload.cjs must forward resize to the main ipc channel");

// Renderer measures content and reports actual height.
assert.match(cardJs, /function measureAndResize\(\)/,
  "popup-card.js missing measureAndResize()");
assert.match(cardJs, /window\.ucaShell\?\.resizePopupCard\?\./,
  "popup-card.js must call resizePopupCard through the shell bridge");
assert.match(cardJs, /ResizeObserver/,
  "popup-card.js should use ResizeObserver to track dynamic content");

// Actions row wraps so 3-button approvals don't overflow at 380px.
assert.match(cardCss, /\.pc-actions\s*\{[\s\S]*flex-wrap:\s*wrap/,
  "popup-card.css .pc-actions must set flex-wrap: wrap");
assert.match(cardCss, /\.pc-btn\s*\{[\s\S]*text-overflow:\s*ellipsis/,
  "popup-card.css .pc-btn must ellipsize overly long labels");

console.log("ok verify-popup-card-fit");
