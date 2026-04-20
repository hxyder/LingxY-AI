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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

// ── focus-visible rule exists in shared.css ─────────────────────────────
const shared = read("src/desktop/renderer/shared.css");
assert.ok(
  /:focus-visible\s*\{[^}]*outline:\s*2px\s+solid\s+var\(--accent\)/s.test(shared),
  "shared.css must define a :focus-visible rule with outline:2px solid var(--accent)"
);

// ── console tab bar has tablist/tab/aria-selected ───────────────────────
const consoleHtml = read("src/desktop/renderer/console.html");
assert.ok(
  /<nav class="tab-bar"[^>]*role="tablist"/.test(consoleHtml),
  "console tab bar must have role=\"tablist\""
);
const tabButtons = [...consoleHtml.matchAll(/<button class="tab-btn[^"]*"[^>]*>/g)];
assert.ok(tabButtons.length >= 9, `expected 9+ tab buttons, found ${tabButtons.length}`);
for (const [match] of tabButtons) {
  assert.ok(
    /role="tab"/.test(match),
    `tab button missing role="tab": ${match}`
  );
  assert.ok(
    /aria-selected="(true|false)"/.test(match),
    `tab button missing aria-selected: ${match}`
  );
}
// Exactly one tab is selected.
const selectedTabs = (consoleHtml.match(/<button class="tab-btn active"[^>]*aria-selected="true"/g) ?? []).length;
assert.equal(selectedTabs, 1, `expected exactly 1 active/selected tab, found ${selectedTabs}`);

// ── switchTab keeps aria-selected in sync ───────────────────────────────
const consoleJs = read("src/desktop/renderer/console.js");
assert.ok(
  /switchTab\b[\s\S]{0,300}setAttribute\(\s*["']aria-selected["']/.test(consoleJs),
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
