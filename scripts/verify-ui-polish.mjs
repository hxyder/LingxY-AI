#!/usr/bin/env node
/**
 * verify-ui-polish.mjs — UCA-104 (Phase 3d)
 *
 * Asserts the two polish features from Phase 3d are wired:
 *   - skeleton loader styles defined, task detail loader uses them
 *   - cheatsheet modal present with Ctrl+/ handler and proper a11y
 *     attributes (role=dialog, aria-modal, aria-labelledby)
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readCssWithImports } from "./lib/css-imports.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

function readSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing section start: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing section end after ${startMarker}: ${endMarker}`);
  return source.slice(start, end);
}

// ── skeleton loader CSS ────────────────────────────────────────────────
const shared = readCssWithImports(root, "src/desktop/renderer/shared.css");
assert.ok(/\.skeleton\s*\{/.test(shared), "shared.css must define .skeleton");
assert.ok(
  /@keyframes\s+skeleton-shimmer/.test(shared),
  "shared.css must define skeleton-shimmer keyframes"
);
assert.ok(
  /prefers-reduced-motion.*animation:\s*none/s.test(shared),
  "skeleton must honor prefers-reduced-motion"
);

const consoleJs = read("src/desktop/renderer/console.js");
const refreshTaskDetail = readSection(
  consoleJs,
  "async function refreshTaskDetail",
  "\nfunction renderApprovals"
);
assert.ok(
  /showLoading/.test(refreshTaskDetail) && /skeleton/.test(refreshTaskDetail),
  "refreshTaskDetail must render a skeleton loader while fetching"
);

// ── cheatsheet modal visibility guard (UCA-105 regression) ────────────
// The .cheatsheet-backdrop class originally forced display:grid which
// overrode the default [hidden]{display:none} user-agent rule, so the
// modal was visible from page load and couldn't be closed. Enforce the
// explicit override here.
assert.ok(
  /\.cheatsheet-backdrop\[hidden\]\s*\{[^}]*display:\s*none/s.test(shared),
  "shared.css must re-assert display:none on [hidden] cheatsheet backdrop"
);

// ── cheatsheet modal ───────────────────────────────────────────────────
const consoleHtml = read("src/desktop/renderer/console.html");
assert.ok(
  /id="cheatsheetBackdrop"[^>]*role="dialog"/.test(consoleHtml),
  "cheatsheet backdrop must have role=\"dialog\""
);
assert.ok(
  /aria-modal="true"/.test(consoleHtml) && /aria-labelledby="cheatsheetTitle"/.test(consoleHtml),
  "cheatsheet must be aria-modal and aria-labelledby its heading"
);
assert.ok(
  /id="cheatsheetButton"/.test(consoleHtml),
  "topbar must include a cheatsheet ? button"
);
// Must list at least the core hotkeys.
for (const hot of ["Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>U", "Ctrl</kbd>+<kbd>/", "Esc"]) {
  assert.ok(consoleHtml.includes(hot), `cheatsheet missing hotkey listing: ${hot}`);
}

// ── Ctrl+/ handler + toggle + Esc close ────────────────────────────────
assert.ok(
  /function toggleCheatsheet\s*\(/.test(consoleJs),
  "console.js must define toggleCheatsheet"
);
assert.ok(
  /event\.ctrlKey\s*&&\s*event\.key\s*===\s*["']\/["']/.test(consoleJs),
  "console.js must listen for Ctrl+/"
);
assert.ok(
  /event\.key\s*===\s*["']Escape["']/.test(consoleJs),
  "console.js must close the cheatsheet on Escape"
);

// Backdrop-click dismiss.
assert.ok(
  /event\.target === cheatsheetBackdrop/.test(consoleJs),
  "console.js must dismiss the cheatsheet when the user clicks the backdrop"
);

console.log("ok verify-ui-polish");
