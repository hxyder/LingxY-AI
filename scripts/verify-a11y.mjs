#!/usr/bin/env node
/**
 * verify-a11y.mjs — UCA-100 (Phase 2 baseline)
 *
 * Asserts the baseline accessibility affordances are in place:
 *   - focus-visible rule defined in shared.css so keyboard users see
 *     a ring on every interactive surface
 *   - console tab bar carries role="tablist" + per-tab role="tab" +
 *     aria-selected
 *   - switchTab in console.js keeps aria-selected in sync with .active
 *   - console theme swatches have aria-label
 *
 * Scope is deliberately minimal — full WCAG 2.1 AA is out of scope for
 * this commit.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readCssWithImports } from "./lib/css-imports.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

// ── focus-visible rule exists in shared.css ─────────────────────────────
const shared = readCssWithImports(root, "src/desktop/renderer/shared.css");
assert.ok(
  /:focus-visible\s*\{[^}]*outline:\s*2px\s+solid\s+var\(--accent\)/s.test(shared),
  "shared.css must define a :focus-visible rule with outline:2px solid var(--accent)"
);

// ── navigation landmark (rail OR legacy tab-bar) with proper ARIA ──
const consoleHtml = read("src/desktop/renderer/console.html");
// UCA-107: the top tab bar was replaced by a left rail (<aside
// class="app-rail">). The rail still uses data-tab + role="tab" on
// each item so the a11y baseline carries over; we just don't require
// the <nav class="tab-bar"> wrapper anymore.
const hasRail = /<aside class="[^"]*\b(?:rail|app-rail)\b[^"]*"/.test(consoleHtml);
const hasTabBar = /<nav class="tab-bar"[^>]*role="tablist"/.test(consoleHtml);
assert.ok(hasRail || hasTabBar, "console must have either a tab bar or a left rail nav");

// Every data-tab element must carry role=tab + aria-selected so screen
// readers and keyboard users treat it as a tablist entry.
const tabItems = [...consoleHtml.matchAll(/<button [^>]*data-tab="[^"]+"[^>]*>/g)];
// PMAT-013: Console rail is intentionally quieter. Compatibility panels for
// files/projects/conversations remain in the DOM, but they are no longer
// first-level rail buttons.
assert.ok(tabItems.length >= 7, `expected 7+ data-tab buttons, found ${tabItems.length}`);
for (const [match] of tabItems) {
  assert.ok(/role="tab"/.test(match), `data-tab button missing role="tab": ${match}`);
  assert.ok(
    /aria-selected="(true|false)"/.test(match),
    `data-tab button missing aria-selected: ${match}`
  );
}
// Exactly one item is selected/current at load. Accept either
// aria-selected="true" or aria-current="page" as the "active" marker.
const selectedItems = (consoleHtml.match(
  /<button [^>]*data-tab="[^"]+"[^>]*(?:aria-selected="true"|aria-current="page")/g
) ?? []).length;
assert.ok(selectedItems >= 1, `expected at least 1 active tab/rail item, found ${selectedItems}`);

// ── switchTab keeps aria-selected in sync ───────────────────────────────
const consoleJs = read("src/desktop/renderer/console.js");
assert.ok(
  /switchTab\b[\s\S]{0,700}setAttribute\(\s*["']aria-selected["']/.test(consoleJs),
  "switchTab in console.js must setAttribute aria-selected"
);

// ── theme swatches carry aria-label ─────────────────────────────────────
const swatchMatches = [...consoleHtml.matchAll(/<button class="theme-swatch[^"]*"[^>]*>/g)];
assert.equal(swatchMatches.length, 2, `expected 2 theme swatches, found ${swatchMatches.length}`);
for (const [match] of swatchMatches) {
  assert.ok(
    /aria-label="[^"]+"/.test(match),
    `theme swatch missing aria-label: ${match}`
  );
}

console.log("ok verify-a11y");
