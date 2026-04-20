#!/usr/bin/env node
/**
 * verify-icons.mjs — UCA-101 (Phase 3a)
 *
 * Asserts the icon module is in place and that the Console HTML has
 * purged the emoji glyphs that rendered inconsistently across Windows
 * versions.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { icon, LOGO_MARK, listIconNames } from "../src/desktop/renderer/icons.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

// ── icons.mjs smoke-test ────────────────────────────────────────────────
const names = listIconNames();
assert.ok(names.length >= 20, `expected 20+ icon names, got ${names.length}`);
for (const expected of ["mic", "mail", "calendar", "settings", "search", "check", "x", "alert-triangle", "send"]) {
  assert.ok(names.includes(expected), `icons.mjs missing "${expected}"`);
}

const mic14 = icon("mic", 14);
assert.ok(mic14.startsWith("<svg"), "icon() must return SVG markup");
assert.ok(mic14.includes('width="14"'), "icon() must honor size arg");
assert.ok(mic14.includes('stroke="currentColor"'), "icons must use currentColor");
assert.ok(mic14.includes('aria-hidden="true"'), "icons must be aria-hidden");
assert.equal(icon("does-not-exist"), "", "unknown icon returns empty string");

assert.ok(LOGO_MARK.startsWith("<svg"), "LOGO_MARK must be SVG markup");
assert.ok(LOGO_MARK.includes('viewBox="0 0 32 32"'), "LOGO_MARK uses 32×32 viewBox");

// ── console.html is emoji-free ──────────────────────────────────────────
const consoleHtml = read("src/desktop/renderer/console.html");
const emojis = consoleHtml.match(/[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]|[\u{2300}-\u{23FF}]/gu) ?? [];
assert.equal(
  emojis.length,
  0,
  `console.html still contains emoji glyphs (${emojis.length}): ${emojis.join(" ")}`
);

// ── connector picker buttons use SVGs instead of text icons ─────────────
const connectorIconMatches = (consoleHtml.match(/<span class="conn-provider-icon">\s*<svg/g) ?? []).length;
assert.ok(
  connectorIconMatches >= 5,
  `expected 5 connector provider icons as SVG, found ${connectorIconMatches}`
);

console.log("ok verify-icons");
