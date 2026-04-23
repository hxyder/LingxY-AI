#!/usr/bin/env node
/**
 * verify-foldable-sections.mjs — UCA-125 Phase 7c
 *
 *   - .panel-section[data-foldable="true"] and .settings-group[data-foldable="true"]
 *     have matching CSS fold rules (chevron + collapse hides body).
 *   - console.js wires both via initFoldablePanelSections() using wireFoldable().
 *   - Projects panel uses .projects-layout with .projects-col wrappers,
 *     .projects-col-head (sticky), and .projects-col-body (scrollable).
 *   - Key connector + settings sections declare data-foldable="true".
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

const html = read("src/desktop/renderer/console.html");
const js = read("src/desktop/renderer/console.js");
const css = read("src/desktop/renderer/shared.css");

// Fold CSS for panel-section.
assert.match(css, /\.panel-section\[data-foldable="true"\]/, "shared.css missing .panel-section[data-foldable]");
assert.match(css, /\.panel-section\[data-foldable="true"\]\[data-collapsed="true"\]\s*>\s*\.panel-section-body\s*\{[^}]*display:\s*none/,
  "shared.css must hide .panel-section-body when collapsed");

// Fold CSS for settings-group.
assert.match(css, /\.settings-group\[data-foldable="true"\]/, "shared.css missing .settings-group[data-foldable]");
assert.match(css, /\.settings-group\[data-foldable="true"\]\[data-collapsed="true"\]\s*>\s*\*:not\(\.settings-group-head\)\s*\{[^}]*display:\s*none/,
  "shared.css must hide settings-group body when collapsed");

// Chevron rotates.
assert.ok(
  /data-collapsed="true"\]\s*>\s*\.(?:panel-section-header|settings-group-head)::after\s*\{[^}]*transform:\s*rotate\(-90deg\)/.test(css),
  "shared.css must rotate chevron when collapsed (both patterns)"
);

// JS wires both shapes via one shared wireFoldable helper.
assert.match(js, /function wireFoldable\(/, "console.js missing wireFoldable()");
assert.match(js, /function initFoldablePanelSections\(/, "console.js missing initFoldablePanelSections()");
assert.match(js, /'\.panel-section\[data-foldable="true"\]'/, "console.js must query .panel-section[data-foldable]");
assert.match(js, /'\.settings-group\[data-foldable="true"\]'/, "console.js must query .settings-group[data-foldable]");
assert.match(js, /lingxy\.panel-section\.collapsed/, "console.js must persist fold state");

// At least one panel-section + three settings-groups declare data-foldable in HTML.
const panelSectionFoldMatches = html.match(/<section class="panel-section"[^>]*data-foldable="true"/g) || [];
assert.ok(panelSectionFoldMatches.length >= 3,
  `expected ≥3 foldable panel-sections (connectors), got ${panelSectionFoldMatches.length}`);

const settingsGroupFoldMatches = html.match(/<div id="[^"]*"[^>]*class="settings-group"[^>]*data-foldable="true"/g) || [];
assert.ok(settingsGroupFoldMatches.length >= 4,
  `expected ≥4 foldable settings-groups, got ${settingsGroupFoldMatches.length}`);

// Projects: layout + sticky head + scroll body.
assert.match(css, /\.projects-layout\s*\{[^}]*display:\s*grid/, "shared.css must define .projects-layout grid");
assert.match(css, /\.projects-col\s*\{/, "shared.css must define .projects-col");
assert.match(css, /\.projects-col-head\s*\{[^}]*position:\s*sticky/, "shared.css must make .projects-col-head sticky");
assert.match(css, /\.projects-col-body\s*\{[^}]*overflow-y:\s*auto/, "shared.css must make .projects-col-body scrollable");

// Projects panel markup uses projects-col wrappers.
assert.ok(html.includes(`class="projects-col panel"`), "console.html must wrap projects columns in .projects-col.panel");
assert.ok((html.match(/class="projects-col panel"/g) || []).length >= 3,
  "expected 3 .projects-col.panel wrappers in console.html");

// Settings-group heads are present (not just plain .row) on foldable groups.
assert.ok(
  /<div id="providerSettingsPanel"[^>]*data-foldable[\s\S]*?<div class="settings-group-head">/.test(html),
  "providerSettingsPanel must have .settings-group-head wrapper"
);

console.log("ok verify-foldable-sections");
