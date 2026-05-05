#!/usr/bin/env node
/**
 * verify-palette.mjs — UCA-110 (Phase 4e)
 *
 * Asserts the Console-internal command palette is wired end-to-end:
 *   - DOM: backdrop + panel + greeting + search input + 5 quick
 *     chips + recent list + hints bar + model pill
 *   - CSS: [hidden]{display:none} override, focus ring on search,
 *     list item hover + active variants
 *   - JS: Ctrl+K toggle, Escape close, ↑↓ navigation, ↵ submit,
 *     quick-chip prefill, backdrop click-dismiss
 *   - cheatsheet documents Ctrl+K
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readCssWithImports } from "./lib/css-imports.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

const consoleHtml = read("src/desktop/renderer/console.html");
const consoleJs = read("src/desktop/renderer/console.js");
const shared = readCssWithImports(root, "src/desktop/renderer/shared.css");

// ── DOM structure ──────────────────────────────────────────────────────
assert.ok(
  /id="paletteBackdrop"[^>]*role="dialog"[^>]*aria-modal="true"/.test(consoleHtml),
  "palette backdrop must be role=dialog + aria-modal=true"
);
assert.ok(/id="paletteBackdrop"[^>]*hidden/.test(consoleHtml), "palette must default hidden");
assert.ok(/class="palette-panel"/.test(consoleHtml), "palette panel missing");
assert.ok(/id="paletteGreeting"/.test(consoleHtml), "palette greeting missing");
assert.ok(/id="paletteSearchInput"/.test(consoleHtml), "palette search input missing");
assert.ok(/id="paletteRecent"/.test(consoleHtml), "palette recent list missing");
assert.ok(/id="paletteModelPill"/.test(consoleHtml), "palette model pill missing");
// 5 quick chips.
for (const q of ["new-chat", "translate", "summarize", "explain", "schedule"]) {
  assert.ok(
    new RegExp(`data-quick="${q}"`).test(consoleHtml),
    `palette missing quick chip "${q}"`
  );
}
// Hints bar shows the three basic keys.
assert.ok(/↑↓[\s\S]*↵[\s\S]*esc/.test(consoleHtml), "palette hints must list ↑↓ ↵ esc");

// ── CSS ────────────────────────────────────────────────────────────────
assert.ok(
  /\.palette-backdrop\[hidden\]\s*\{\s*display:\s*none/.test(shared),
  "palette-backdrop must re-assert display:none on [hidden] (UCA-105 pattern)"
);
assert.ok(
  /\.palette-item--active/.test(shared),
  "palette-item active variant must be styled"
);
assert.ok(
  /\.palette-search:focus-within/.test(shared),
  "palette-search must paint a focus ring"
);

// ── JS wire-up ─────────────────────────────────────────────────────────
assert.ok(
  /event\.ctrlKey\s*&&\s*\(event\.key\s*===\s*"k"\s*\|\|\s*event\.key\s*===\s*"K"\)/.test(consoleJs),
  "Ctrl+K handler missing"
);
// ArrowDown / ArrowUp / Enter / Escape handlers inside the palette.
for (const key of ["ArrowDown", "ArrowUp", "Enter", "Escape"]) {
  assert.ok(
    new RegExp(`event\\.key\\s*===\\s*"${key}"`).test(consoleJs),
    `palette must handle ${key}`
  );
}
// Backdrop click-to-dismiss.
assert.ok(
  /event\.target === backdrop[\s\S]{0,60}setOpen\(false\)/.test(consoleJs),
  "palette must dismiss on backdrop click"
);

// Quick-action template map. new-chat is quoted (hyphen forces
// quoting); the others may be bare identifiers.
assert.ok(
  /"new-chat"\s*:/.test(consoleJs),
  'QUICK_TEMPLATES missing entry for "new-chat"'
);
for (const q of ["translate", "summarize", "explain", "schedule"]) {
  assert.ok(
    new RegExp(`(?:^|\\s)${q}\\s*:`, "m").test(consoleJs),
    `QUICK_TEMPLATES missing entry for "${q}"`
  );
}

// Submits via /task endpoint (reuse existing flow). Body uses camelCase
// (userCommand / sourceApp) — UCA-110 follow-up replaced the legacy
// snake_case payload, so the assertion must match the current shape.
assert.ok(
  /fetchJson\("\/task"/.test(consoleJs) && /sourceApp:\s*"console\.palette"/.test(consoleJs),
  "palette must submit via POST /task tagged with sourceApp=console.palette"
);

// ── cheatsheet documents Ctrl+K ────────────────────────────────────────
assert.ok(
  /<kbd>Ctrl<\/kbd>\+<kbd>K<\/kbd>[\s\S]{0,60}Quick input palette/.test(consoleHtml),
  "cheatsheet must list Ctrl+K"
);

console.log("ok verify-palette");
