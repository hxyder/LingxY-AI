#!/usr/bin/env node
/**
 * verify-tasks-filters.mjs — UCA-121 (Phase 6c)
 *
 * After retiring the Memory tab, the Tasks page now carries two
 * additional filter rows: date (All / Today / 7d / 30d) and source
 * (All + dynamic chips built from the current task set). This verify
 * checks the DOM is in place, the state store has the new keys, and
 * the matching helpers return the right answers for representative
 * inputs.
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

// ── DOM: date + source chip rows exist ──────────────────────────────
assert.ok(
  /id="taskDateFilterChips"[\s\S]{0,600}data-date="today"/.test(consoleHtml),
  "#taskDateFilterChips must exist with a data-date=\"today\" chip"
);
for (const d of ["all", "today", "7d", "30d"]) {
  assert.ok(
    new RegExp(`data-date="${d}"`).test(consoleHtml),
    `missing date filter chip data-date="${d}"`
  );
}
assert.ok(
  /id="taskSourceFilterChips"[\s\S]{0,400}data-source="all"/.test(consoleHtml),
  "#taskSourceFilterChips must exist with a data-source=\"all\" chip"
);

// ── state keys present ──────────────────────────────────────────────
assert.ok(/taskDateFilter:\s*"all"/.test(consoleJs), "state.taskDateFilter default must be \"all\"");
assert.ok(/taskSourceFilter:\s*"all"/.test(consoleJs), "state.taskSourceFilter default must be \"all\"");

// ── helpers present ─────────────────────────────────────────────────
for (const fn of ["taskMatchesDate", "taskMatchesSource", "taskSourceCandidates"]) {
  assert.ok(
    new RegExp(`function ${fn}\\s*\\(`).test(consoleJs),
    `console.js missing helper ${fn}`
  );
}

// ── Memory retirement sanity ────────────────────────────────────────
assert.ok(
  !/id="panel-history"/.test(consoleHtml),
  "#panel-history must be retired (Memory tab dropped in UCA-121)"
);
assert.ok(
  !/data-tab="history"/.test(consoleHtml),
  "rail item data-tab=\"history\" must be retired"
);
assert.ok(
  !/fetchJson\("\/history\/search"/.test(consoleJs),
  "console.js must not call /history/search (retired with Memory tab)"
);

// ── Morning digest moved from Connectors to Schedules ──────────────
const schedStart = consoleHtml.indexOf('id="panel-schedules"');
const schedEnd = consoleHtml.indexOf('id="panel-advanced"');
assert.ok(schedStart > 0 && schedEnd > schedStart, "schedule panel slice not found");
const schedSlice = consoleHtml.slice(schedStart, schedEnd);
assert.ok(
  schedSlice.includes("connDigestEnabled"),
  "Morning digest (connDigestEnabled) must live in the Schedules panel now"
);
assert.ok(
  schedSlice.includes("Morning digest"),
  "Schedules panel must carry the 'Morning digest' title"
);

const connStart = consoleHtml.indexOf('id="panel-connectors"');
const connEnd = consoleHtml.indexOf('id="panel-settings"');
const connSlice = consoleHtml.slice(connStart, connEnd);
assert.ok(
  !connSlice.includes("connDigestEnabled"),
  "Morning digest must NO LONGER appear in Connectors"
);

// ── functional spot-check: matcher helpers ──────────────────────────
// Extract the three helpers into a scoped sandbox and run them.
const slices = {};
for (const fn of ["taskMatchesDate", "taskMatchesSource", "taskSourceCandidates"]) {
  const m = consoleJs.match(new RegExp(`function ${fn}\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}`));
  assert.ok(m, `unable to extract ${fn}`);
  slices[fn] = m[0];
}
// eslint-disable-next-line no-new-func
const helpers = new Function(
  `${slices.taskMatchesDate}\n${slices.taskMatchesSource}\n${slices.taskSourceCandidates}\nreturn { taskMatchesDate, taskMatchesSource, taskSourceCandidates };`
)();

// "all" passes everything, even invalid timestamps.
assert.equal(helpers.taskMatchesDate({ created_at: null }, "all"), true);
// "today" must accept a task from a minute ago.
const nowIso = new Date().toISOString();
assert.equal(helpers.taskMatchesDate({ created_at: nowIso }, "today"), true);
// "7d" rejects 10-day-old tasks.
const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
assert.equal(helpers.taskMatchesDate({ created_at: tenDaysAgo }, "7d"), false);
// Source match: "all" passes, specific source works.
assert.equal(helpers.taskMatchesSource({ source_type: "overlay" }, "all"), true);
assert.equal(helpers.taskMatchesSource({ source_type: "overlay" }, "overlay"), true);
assert.equal(helpers.taskMatchesSource({ source_type: "chat" }, "overlay"), false);
// Candidates: dedupes + sorts with preferred order.
const cands = helpers.taskSourceCandidates([
  { source_type: "overlay" }, { source_type: "chat" },
  { source_type: "overlay" }, { executor: "mcp" }
]);
assert.ok(cands.includes("overlay"), "candidates should include overlay");
assert.ok(cands.includes("chat"), "candidates should include chat");
assert.ok(cands.includes("mcp"), "candidates should include mcp (via executor fallback)");

console.log("ok verify-tasks-filters");
