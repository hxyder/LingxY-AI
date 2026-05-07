#!/usr/bin/env node
/**
 * verify-external-surfaces.mjs — UCA-127 Phase 7e
 *
 * Locks the browser extension + Office add-in to the LingxY v3 palette.
 * Old teal/slate/orange identity colors must not leak back in.
 *
 * Forbidden hex colors (case-insensitive):
 *   #2f6f5e, #255b4d, #d68a2d, #f2d6a6    (old teal/orange)
 *   #0f766e, #163047                       (old teal/slate)
 *
 * Each target file must contain the new terracotta #b85c2a at least once.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

const forbidden = [
  "#2f6f5e", "#255b4d", "#d68a2d", "#f2d6a6",
  "#0f766e", "#163047",
  "rgba(47,111,94", "rgba(47, 111, 94",
  "rgba(15,118,110", "rgba(15, 118, 110",
  "rgba(13,148,136", "rgba(13, 148, 136",
  "rgba(21,94,117", "rgba(21, 94, 117"
];

// B5 cleanup: previously checked office_addin/shared/icon-{16,32,80}.svg
// for v3 terracotta accent, but those SVGs were never loaded at runtime
// (Office manifests point to icon-{16,32,80}.png) and the brand identity
// is now driven by assets/brand-source/lingxy-icon-source.png. Removed
// from the verifier; the PNGs themselves are validated structurally by
// verify-icons (existence) and verify-brand-assets (in-app SVG mark).
const targets = [
  "browser_ext/popup/styles.css",
  "browser_ext/shadow_ui/floating-chip.js",
  "browser_ext/content_script/selection-cache.js",
  "office_addin/shared/task_pane.html"
];

for (const rel of targets) {
  const body = read(rel).toLowerCase();
  for (const token of forbidden) {
    assert.ok(!body.includes(token.toLowerCase()),
      `${rel} still contains forbidden legacy color "${token}"`);
  }
  // Terracotta can appear as either the canonical hex #b85c2a or its
  // rgb form rgba(184, 92, 42, …) — both are the v3 accent.
  const hasTerracottaHex = body.includes("#b85c2a");
  const hasTerracottaRgb = /rgba?\(\s*184\s*,\s*92\s*,\s*42/.test(body);
  assert.ok(hasTerracottaHex || hasTerracottaRgb,
    `${rel} must contain the v3 terracotta accent (#b85c2a or rgba(184, 92, 42, …))`);
}

console.log("ok verify-external-surfaces");
