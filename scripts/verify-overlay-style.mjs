#!/usr/bin/env node
/**
 * verify-overlay-style.mjs — UCA-119 (Phase 6a)
 *
 * Asserts that floating-layer UI (overlay / palette / cheatsheet)
 * uses glass tokens and stays visually distinct from Console's
 * terracotta accent. This is the "high-end smooth glass" language
 * the user explicitly wants to preserve across every hotkey-
 * triggered / floating-button-triggered popup.
 *
 * Rules:
 *   1. tokens.css must declare the six --glass-* tokens in :root
 *      and re-tune them under [data-theme="dark"].
 *   2. overlay.html must not contain terracotta rgbas
 *      (rgba(184, 92, 42, ...)) — those were mistakenly applied
 *      in UCA-118 and are reverted here.
 *   3. shared.css palette + cheatsheet rules must use glass tokens
 *      (--glass-surface / --glass-border / --glass-shadow) instead
 *      of --panel / --line / --shadow-lg.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readCssWithImports } from "./lib/css-imports.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

const tokens = read("src/desktop/renderer/tokens.css");
const shared = readCssWithImports(root, "src/desktop/renderer/shared.css");
const overlay = read("src/desktop/renderer/overlay.html");

// ── 1. Glass tokens exist in :root ────────────────────────────────────
const GLASS_TOKENS = [
  "--glass-surface",
  "--glass-border",
  "--glass-shadow",
  "--glass-backdrop",
  "--glass-ink",
  "--glass-muted",
  "--glass-line",
  "--glass-accent",
  "--glass-accent-soft"
];
for (const name of GLASS_TOKENS) {
  assert.ok(
    tokens.includes(name + ":"),
    `tokens.css missing glass token ${name}`
  );
}

// Dark overrides present (look at body of dark block).
const darkBlockMatch = tokens.match(/:is\(html, body\)\[data-theme="dark"\]\s*\{[\s\S]*?\n\}/);
assert.ok(darkBlockMatch, "tokens.css missing :is(html,body)[data-theme=\"dark\"] block");
const darkBlock = darkBlockMatch[0];
for (const name of ["--glass-surface", "--glass-ink", "--glass-accent"]) {
  assert.ok(
    darkBlock.includes(name + ":"),
    `tokens.css dark block missing override for ${name}`
  );
}

// ── 2. Overlay free of terracotta ──────────────────────────────────────
const terraHits = (overlay.match(/rgba\(184,\s*92,\s*42/g) ?? []).length;
assert.equal(
  terraHits,
  0,
  `overlay.html still has ${terraHits} terracotta rgbas — must use --glass-* or cool gray rgba(91, 107, 122, …)`
);

// ── 3. Palette + cheatsheet use glass tokens ─────────────────────────
// Pull the block from ".pal-back, .palette-backdrop {" through
// a reasonable distance and check it references glass tokens.
const palSliceStart = shared.indexOf(".pal-back, .palette-backdrop");
const palSliceEnd = shared.indexOf(".cheatsheet-backdrop");
assert.ok(palSliceStart > 0 && palSliceEnd > palSliceStart, "palette CSS slice not found");
const palSlice = shared.slice(palSliceStart, palSliceEnd);
for (const name of ["--glass-surface", "--glass-border", "--glass-shadow", "--glass-ink", "--glass-accent-soft"]) {
  assert.ok(
    palSlice.includes(name),
    `palette block in shared.css must reference ${name}`
  );
}
// Palette block must NOT reference var(--accent) directly (that
// would tint it terracotta when Console accent changes).
assert.ok(
  !/var\(--accent\)/.test(palSlice),
  "palette block must not reference var(--accent) — use var(--glass-accent) instead"
);

const cheatStart = shared.indexOf(".cheatsheet-backdrop");
const cheatEnd = shared.indexOf("/* ====", cheatStart + 1);
const cheatSlice = cheatEnd > 0 ? shared.slice(cheatStart, cheatEnd) : shared.slice(cheatStart, cheatStart + 2000);
for (const name of ["--glass-surface", "--glass-border", "--glass-shadow", "--glass-ink"]) {
  assert.ok(
    cheatSlice.includes(name),
    `cheatsheet block in shared.css must reference ${name}`
  );
}

console.log("ok verify-overlay-style");
