#!/usr/bin/env node
/**
 * verify-brand-assets.mjs — UCA-099-pre
 *
 * Asserts the LingxY brand mark assets exist, use currentColor (so they
 * pick up the theme accent without hardcoded hex), and that the console
 * topbar actually references the mark rather than the old "U" placeholder
 * from the UCA era.
 */

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const MARK_PATH = path.join(root, "src/desktop/assets/logo/lingxy-mark.svg");
const WORDMARK_PATH = path.join(root, "src/desktop/assets/logo/lingxy-wordmark.svg");
const CONSOLE_PATH = path.join(root, "src/desktop/renderer/console.html");

// ── mark.svg exists and is clean ─────────────────────────────────────────
// 2026-05-07 brand identity update: replaced the old "一点通" two-dots
// + arc geometry with a right-pointing arrow that mirrors the new
// installer / .exe / Office add-in icon source
// (assets/brand-source/lingxy-icon-source.png). The wrapping CSS
// (rail-mark / rail-brand-mark / topbar-logo) paints the rounded
// black-square silhouette; the SVG only carries the foreground
// arrow in currentColor so theme switches still recolor it.
assert.ok(existsSync(MARK_PATH), `missing brand mark: ${MARK_PATH}`);
const mark = readFileSync(MARK_PATH, "utf8");
assert.ok(
  /<svg[^>]*viewBox="0 0 32 32"/.test(mark),
  "mark must use 32x32 viewBox so it tiles across 16/28/64/256 cleanly"
);
assert.ok(
  /currentColor/.test(mark),
  "mark must use currentColor so theme accent drives the fill"
);
// No hardcoded hex / rgb except the well-known none/transparent.
const hardcodedColors = mark.match(/#[0-9a-fA-F]{3,6}\b|rgb\(|rgba\(|hsl\(/g) ?? [];
assert.equal(
  hardcodedColors.length,
  0,
  `mark must not hardcode colors, got: ${hardcodedColors.join(", ")}`
);
// New identity: a single right-arrow path. The path must:
//   - exist and be filled with currentColor
//   - extend horizontally toward the right edge of the viewBox
//     (arrow tip x ≥ 24 in the 0–32 viewBox) so the silhouette
//     reads as a directional arrow at small sizes.
const filledPathMatch = mark.match(/<path[^>]*d="([^"]+)"[^>]*fill="currentColor"/);
assert.ok(filledPathMatch, "mark must have a <path> filled with currentColor");
const pathD = filledPathMatch[1];
const xCoords = Array.from(pathD.matchAll(/[ML]\s*(-?\d+(?:\.\d+)?)/g)).map((m) => Number(m[1]));
assert.ok(xCoords.length >= 4, "mark path must have at least four anchor points (arrow geometry)");
const maxX = Math.max(...xCoords);
assert.ok(maxX >= 24, `mark arrow tip must reach toward the right edge (got max x=${maxX})`);
const minX = Math.min(...xCoords);
assert.ok(minX <= 8, `mark arrow tail must start near the left edge (got min x=${minX})`);
// Regression guard: the old "一点通" geometry — two circles + one
// cubic-bezier arc — must NOT come back unless we deliberately undo
// this brand update.
assert.ok(!/<circle/.test(mark), "mark must not carry the legacy 一点通 dots");
assert.ok(!/[Cc]\s+\d.*\d.*,\s*\d/.test(pathD), "mark must not carry the legacy cubic-bezier arc");

// ── wordmark.svg exists, references same mark geometry ───────────────────
assert.ok(existsSync(WORDMARK_PATH), `missing wordmark: ${WORDMARK_PATH}`);
const wordmark = readFileSync(WORDMARK_PATH, "utf8");
assert.ok(/<text/.test(wordmark), "wordmark must include the LingxY text");
assert.ok(/LingxY/.test(wordmark), "wordmark text must say LingxY");
assert.ok(/currentColor/.test(wordmark), "wordmark must use currentColor");

// ── console.html uses the brand mark, not the old "U" ──────────────────
const consoleHtml = readFileSync(CONSOLE_PATH, "utf8");
assert.ok(
  !/<div class="topbar-logo">U<\/div>/.test(consoleHtml),
  "console still renders the old 'U' placeholder — should use the mark SVG"
);
// v3 moved the brand into the left rail's .rail-mark. Either the old
// topbar .topbar-logo or the v3 rail .rail-mark should embed the mark.
assert.ok(
  /(?:topbar-logo|rail-mark|rail-brand-mark)[\s\S]*?<svg[\s\S]*?viewBox="0 0 32 32"/.test(consoleHtml),
  "console must embed the 32×32 mark SVG (in topbar or rail)"
);
// "LingxY" must appear in the brand region (topbar or rail).
assert.ok(
  /(?:topbar-title|rail-brand-label|rail-brand-text[^>]*>[\s\S]*?<strong[^>]*>LingxY)/.test(consoleHtml),
  "console must carry the LingxY brand name"
);
// Regression: no "UCA Console" leftover.
assert.ok(
  !/UCA Console/.test(consoleHtml),
  "console must not carry the old 'UCA Console' string"
);

console.log("ok verify-brand-assets");
