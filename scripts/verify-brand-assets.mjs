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
assert.ok(existsSync(MARK_PATH), `missing brand mark: ${MARK_PATH}`);
const mark = readFileSync(MARK_PATH, "utf8");
assert.ok(
  /<svg[^>]*viewBox="0 0 32 32"/.test(mark),
  "mark must use 32x32 viewBox so it tiles across 16/28/64/256 cleanly"
);
assert.ok(
  /currentColor/.test(mark),
  "mark must use currentColor so theme accent drives the stroke/fill"
);
// No hardcoded hex / rgb except the well-known none/transparent.
const hardcodedColors = mark.match(/#[0-9a-fA-F]{3,6}\b|rgb\(|rgba\(|hsl\(/g) ?? [];
assert.equal(
  hardcodedColors.length,
  0,
  `mark must not hardcode colors, got: ${hardcodedColors.join(", ")}`
);
// Two endpoints + one arc = the "一点通" concept.
assert.ok(/<circle[\s\S]*<circle/.test(mark), "mark must have two dots");
assert.ok(/<path[\s\S]*C /.test(mark), "mark must have a cubic-bezier arc between them");

// ── wordmark.svg exists, references same mark geometry ───────────────────
assert.ok(existsSync(WORDMARK_PATH), `missing wordmark: ${WORDMARK_PATH}`);
const wordmark = readFileSync(WORDMARK_PATH, "utf8");
assert.ok(/<text/.test(wordmark), "wordmark must include the LingxY text");
assert.ok(/LingxY/.test(wordmark), "wordmark text must say LingxY");
assert.ok(/currentColor/.test(wordmark), "wordmark must use currentColor");

// ── console.html uses the mark, not the old "U" ──────────────────────────
const consoleHtml = readFileSync(CONSOLE_PATH, "utf8");
assert.ok(
  !/<div class="topbar-logo">U<\/div>/.test(consoleHtml),
  "console topbar still renders the old 'U' placeholder — should use the mark SVG"
);
assert.ok(
  /topbar-logo[\s\S]*?<svg[\s\S]*?viewBox="0 0 32 32"/.test(consoleHtml),
  "console topbar must embed the mark SVG"
);
assert.ok(
  /LingxY Console/.test(consoleHtml),
  "console title must say 'LingxY Console' (not UCA Console)"
);

console.log("ok verify-brand-assets");
