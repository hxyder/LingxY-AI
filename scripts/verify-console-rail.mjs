#!/usr/bin/env node
/**
 * verify-console-rail.mjs — UCA-107 (Phase 4b)
 *
 * Asserts the Console IA migrated cleanly from a horizontal tab bar
 * to a left rail, without losing any navigation targets and without
 * breaking the panel wire-up that renderers already depend on.
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

// ── the left rail exists ────────────────────────────────────────────────
assert.ok(
  /<aside class="[^"]*\b(?:rail|app-rail)\b/.test(consoleHtml),
  "console.html must host an <aside> with class .rail or .app-rail"
);
// Old tab-bar <nav> is gone.
assert.ok(
  !/<nav class="tab-bar"/.test(consoleHtml),
  "console.html still carries the legacy <nav class=\"tab-bar\"> — should be retired"
);

// ── all 9 view targets present as rail items ────────────────────────────
const expectedViews = [
  "tasks", "chat", "files", "schedules",
  "history", "projects",
  "connectors", "settings", "advanced"
];
for (const view of expectedViews) {
  const re = new RegExp(`<button class="rail-item[^"]*"[^>]*data-tab="${view}"`);
  assert.ok(re.test(consoleHtml), `rail missing item for "${view}"`);
}

// ── rail has the three groups (Workspace / Context / System) ────────────
for (const label of ["Workspace", "Context", "System"]) {
  assert.ok(
    new RegExp(`rail-group-label[^>]*>${label}`).test(consoleHtml),
    `rail missing group "${label}"`
  );
}
// Bilingual zh suffix in group labels.
for (const zh of ["工作", "情境", "系统"]) {
  assert.ok(
    new RegExp(`class="zh">${zh}`).test(consoleHtml),
    `rail group missing Chinese suffix "${zh}"`
  );
}

// ── rail collapse toggle ────────────────────────────────────────────────
assert.ok(/id="railToggle"/.test(consoleHtml), "rail toggle button missing");
assert.ok(
  /function applyRailState\(/.test(consoleJs),
  "console.js must define applyRailState"
);
assert.ok(
  /localStorage\.getItem\("lingxy\.rail"\)/.test(consoleJs),
  "rail state must be restored from localStorage.lingxy.rail"
);
assert.ok(
  /localStorage\.setItem\("lingxy\.rail"/.test(consoleJs),
  "rail state must be persisted to localStorage.lingxy.rail"
);

// ── view persistence ────────────────────────────────────────────────────
assert.ok(
  /localStorage\.setItem\("lingxy\.view"/.test(consoleJs),
  "switchTab must persist the current view"
);
assert.ok(
  /localStorage\.getItem\("lingxy\.view"\)/.test(consoleJs),
  "boot must restore the last viewed tab"
);

// ── switchTab syncs both aria-selected and aria-current="page" ──────────
assert.ok(
  /setAttribute\("aria-current",\s*"page"\)/.test(consoleJs),
  "switchTab must set aria-current=\"page\" on the active item"
);
assert.ok(
  /removeAttribute\("aria-current"\)/.test(consoleJs),
  "switchTab must clear aria-current on inactive items"
);

// ── tabButtons query now covers both rail items and legacy tab-btn ─────
assert.ok(
  /document\.querySelectorAll\("\[data-tab\]"\)/.test(consoleJs),
  "tabButtons query must use [data-tab] so rail items are included"
);

// ── brand block + bilingual Chinese on Tasks rail item ─────────────────
assert.ok(/rail-brand-mark/.test(consoleHtml), "rail must include a brand mark");
assert.ok(/<span class="zh">任务/.test(consoleHtml), "Tasks rail item must carry Chinese suffix");

// ── panel DOM preserved (zero regression in existing renderers) ─────────
for (const id of expectedViews) {
  assert.ok(
    new RegExp(`id="panel-${id}"`).test(consoleHtml),
    `panel #panel-${id} removed? renderers depend on it`
  );
}

console.log("ok verify-console-rail");
