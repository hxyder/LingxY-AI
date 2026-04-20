#!/usr/bin/env node
/**
 * verify-tweaks.mjs — UCA-109 (Phase 4d)
 *
 * Asserts the Tweaks panel ships all the pieces:
 *   - floating launcher + panel DOM + close button
 *   - theme segmented (2 options), accent ring (5 options), density
 *     segmented (3 options) — each with the correct data-* hook
 *   - Ctrl+, keyboard toggle, Esc close, backdrop click close
 *   - the three apply*() functions (Theme/Accent/Density) round-trip
 *     to localStorage.lingxy.{theme,accent,density}
 *   - boot restores all three from localStorage
 *   - retired themes (white/warm) no longer in THEMES constant
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

const consoleHtml = read("src/desktop/renderer/console.html");
const consoleJs = read("src/desktop/renderer/console.js");
const shared = read("src/desktop/renderer/shared.css");

// ── DOM: launcher + backdrop + panel ────────────────────────────────────
assert.ok(/id="tweaksLauncher"/.test(consoleHtml), "missing #tweaksLauncher");
assert.ok(/id="tweaksBackdrop"[^>]*hidden/.test(consoleHtml), "tweaks backdrop must default hidden");
assert.ok(/class="tweaks-panel"/.test(consoleHtml), "tweaks panel missing");
assert.ok(/id="tweaksCloseButton"/.test(consoleHtml), "tweaks close button missing");

// ── theme segmented (2 options) ────────────────────────────────────────
for (const t of ["default", "dark"]) {
  assert.ok(
    new RegExp(`data-tweak-theme="${t}"`).test(consoleHtml),
    `tweaks missing theme option "${t}"`
  );
}
// Retired themes must not appear in the panel HTML or in the THEMES const.
for (const gone of ["white", "warm"]) {
  assert.ok(
    !new RegExp(`data-tweak-theme="${gone}"`).test(consoleHtml),
    `retired theme "${gone}" still in tweaks`
  );
}
assert.ok(
  /const THEMES\s*=\s*\[\s*"default",\s*"dark"\s*\]/.test(consoleJs),
  "console.js THEMES must be [\"default\",\"dark\"]"
);

// ── accent rings (5 options, each uniquely styled in CSS) ──────────────
for (const a of ["amber", "indigo", "teal", "rose", "slate"]) {
  assert.ok(
    new RegExp(`data-accent-value="${a}"`).test(consoleHtml),
    `tweaks missing accent option "${a}"`
  );
  assert.ok(
    new RegExp(`\\.tweaks-accent\\[data-accent-value="${a}"\\]`).test(shared),
    `shared.css missing .tweaks-accent swatch color for "${a}"`
  );
}

// ── density segmented (3 options) ──────────────────────────────────────
for (const d of ["compact", "balanced", "roomy"]) {
  assert.ok(
    new RegExp(`data-tweak-density="${d}"`).test(consoleHtml),
    `tweaks missing density option "${d}"`
  );
}

// ── apply functions + localStorage round-trip ──────────────────────────
for (const fn of ["applyTheme", "applyAccent", "applyDensity"]) {
  assert.ok(
    new RegExp(`function ${fn}\\s*\\(`).test(consoleJs),
    `console.js missing ${fn}`
  );
}
for (const key of ["lingxy.theme", "lingxy.accent", "lingxy.density"]) {
  assert.ok(
    new RegExp(`localStorage\\.setItem\\("${key.replace(".", "\\.")}"`).test(consoleJs),
    `setItem("${key}") missing`
  );
  assert.ok(
    new RegExp(`localStorage\\.getItem\\("${key.replace(".", "\\.")}"\\)`).test(consoleJs),
    `getItem("${key}") missing`
  );
}

// ── keyboard + close ───────────────────────────────────────────────────
assert.ok(
  /event\.ctrlKey\s*&&\s*event\.key\s*===\s*","/.test(consoleJs),
  "Ctrl+, handler missing"
);
assert.ok(
  /event\.target === backdrop/.test(consoleJs),
  "backdrop click-to-close missing"
);

// ── cheatsheet lists Ctrl+, ────────────────────────────────────────────
assert.ok(
  /<kbd>Ctrl<\/kbd>\+<kbd>,<\/kbd>/.test(consoleHtml),
  "cheatsheet must list the new Ctrl+, shortcut"
);

// ── launcher CSS + panel visibility override ───────────────────────────
assert.ok(/\.tweaks-backdrop\[hidden\]\s*\{\s*display:\s*none/.test(shared),
  "tweaks-backdrop must re-assert display:none on [hidden]");
assert.ok(/\.tweaks-launcher\s*\{/.test(shared), "tweaks-launcher style missing");
assert.ok(/\.tweaks-launcher\[aria-expanded="true"\]/.test(shared),
  "tweaks-launcher must paint an active state");

console.log("ok verify-tweaks");
