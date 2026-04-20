#!/usr/bin/env node
/**
 * verify-tasks-page.mjs — UCA-108 (Phase 4c)
 *
 * Asserts the Tasks page's v2 upgrades land correctly:
 *   - stat strip (4 cards) with a "Today" sparkline
 *   - search input + 5 filter chips above the task list
 *   - filter/search state on the store, wired into renderTasks
 *   - chip counts update from the unfiltered list (so counts are
 *     stable across selections)
 *   - handlers are attached for chip click + search input
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

// ── stat strip DOM ──────────────────────────────────────────────────────
assert.ok(
  /id="summaryGrid" class="stat-strip"/.test(consoleHtml),
  "summaryGrid must carry the new .stat-strip class"
);
// No leftover `.summary-row` class.
assert.ok(
  !/id="summaryGrid"[^>]*class="summary-row/.test(consoleHtml),
  "summaryGrid still tagged with legacy summary-row class"
);

// ── renderSummary emits .stat-card cards + sparkline on Today ──────────
assert.ok(
  /function renderSummary\s*\([^)]*\)\s*\{[\s\S]{0,1500}stat-card-label/.test(consoleJs),
  "renderSummary must emit .stat-card-label"
);
assert.ok(
  /function buildTodaySparkline\s*\(/.test(consoleJs),
  "buildTodaySparkline helper must exist"
);
assert.ok(
  /class="stat-spark"\s+viewBox="0 0 \$\{W\} \$\{H\}"/.test(consoleJs)
    || /class="stat-spark"\s+viewBox="0 0 100 28"/.test(consoleJs),
  "sparkline must render into a 100×28 SVG"
);
assert.ok(
  /stat-spark-line/.test(consoleJs) && /stat-spark-fill/.test(consoleJs),
  "sparkline must render both fill and line paths"
);

// ── filter chips DOM ────────────────────────────────────────────────────
for (const filter of ["all", "running", "queued", "success", "errors"]) {
  assert.ok(
    new RegExp(`<button[^>]*class="filter-chip"[^>]*data-filter="${filter}"`).test(consoleHtml),
    `filter chip missing data-filter="${filter}"`
  );
  assert.ok(
    new RegExp(`data-count-for="${filter}"`).test(consoleHtml),
    `filter chip missing count slot for "${filter}"`
  );
}
// Exactly one chip is pressed at load.
const pressed = (consoleHtml.match(/filter-chip"[^>]*aria-pressed="true"/g) ?? []).length;
assert.equal(pressed, 1, `expected 1 aria-pressed filter chip, found ${pressed}`);

// ── search input ────────────────────────────────────────────────────────
assert.ok(/id="taskSearchInput"/.test(consoleHtml), "missing #taskSearchInput");
assert.ok(
  /<label class="search-input"/.test(consoleHtml),
  "search input must use the .search-input wrapper"
);

// ── state carries filter + search ───────────────────────────────────────
assert.ok(
  /taskFilter:\s*"all"/.test(consoleJs),
  "state.taskFilter default must be \"all\""
);
assert.ok(/taskSearch:\s*""/.test(consoleJs), "state.taskSearch default must be empty");

// ── renderTasks applies filter + search + updates chip counts ──────────
assert.ok(
  /function taskMatchesFilter\s*\(/.test(consoleJs),
  "taskMatchesFilter helper must exist"
);
assert.ok(
  /function countTasksByFilter\s*\(/.test(consoleJs),
  "countTasksByFilter helper must exist"
);
assert.ok(
  /state\.taskFilter[\s\S]{0,400}state\.taskSearch/.test(consoleJs),
  "renderTasks must consume both state.taskFilter and state.taskSearch"
);
assert.ok(
  /querySelectorAll\("\[data-count-for\]"\)/.test(consoleJs),
  "renderTasks must update chip count slots via [data-count-for]"
);

// ── handlers wired ──────────────────────────────────────────────────────
assert.ok(
  /#taskFilterChips[\s\S]{0,400}aria-pressed/.test(consoleJs),
  "filter chip click handler must toggle aria-pressed"
);
assert.ok(
  /#taskSearchInput[\s\S]{0,200}addEventListener\("input"/.test(consoleJs),
  "search input must listen for \"input\" events"
);

console.log("ok verify-tasks-page");
