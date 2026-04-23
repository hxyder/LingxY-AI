#!/usr/bin/env node
/**
 * verify-schedule-grouping.mjs — UCA-125 Phase 7b
 *
 * Locks in the schedules UI improvements:
 *   - Search input (#scheduleSearchInput) exists and is wired.
 *   - renderSchedules() partitions schedules into three groups
 *     (active / paused / completed) with collapsible headers.
 *   - Completed rows render a "Re-run" label; paused rows a "paused" pill.
 *   - Calendar entries carry data-schedule-ref and click focuses the row.
 *   - shared.css covers .sched-group, .sched-group-head, chev rotation,
 *     .is-completed / .is-paused / .is-highlighted state styles,
 *     and .cal-entry hover affordance.
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

// Search input exists in schedules toolbar.
assert.match(html, /<input id="scheduleSearchInput"/, "console.html missing #scheduleSearchInput");
assert.match(html, /<div class="sched-toolbar">/, "console.html missing .sched-toolbar wrapper");

// renderSchedules gains bucket + search helpers.
assert.match(js, /function scheduleBucket\(/, "console.js missing scheduleBucket()");
assert.match(js, /function scheduleMatchesSearch\(/, "console.js missing scheduleMatchesSearch()");
assert.match(js, /function renderScheduleRow\(/, "console.js missing renderScheduleRow()");

// Three group keys appear in the spec block.
for (const key of ["active", "paused", "completed"]) {
  assert.ok(
    new RegExp(`key:\\s*"${key}"`).test(js),
    `console.js renderSchedules missing group "${key}"`
  );
}

// Row state class + re-run label.
assert.match(js, /is-completed/, "console.js missing .is-completed class in row");
assert.match(js, /is-paused/, "console.js missing .is-paused class in row");
assert.match(js, /"Re-run"/, "console.js missing Re-run label for completed schedules");

// Calendar entries carry ref + click handler.
assert.match(js, /data-schedule-ref="/, "console.js calendar missing data-schedule-ref");
assert.match(js, /function focusScheduleInList\(/, "console.js missing focusScheduleInList()");
assert.match(js, /is-highlighted/, "console.js missing highlight behavior");

// Group collapse is persisted.
assert.match(js, /lingxy\.schedules\.collapsed/, "console.js must persist group collapse state");

// Search input is wired to re-render.
assert.match(js, /scheduleSearchInput.addEventListener\("input"/, "console.js must wire scheduleSearchInput");

// CSS covers group + state + highlight.
assert.match(css, /\.sched-group\s*\{/, "shared.css missing .sched-group");
assert.match(css, /\.sched-group-head\s*\{/, "shared.css missing .sched-group-head");
assert.match(css, /\.sched-group\[data-collapsed="true"\]/, "shared.css missing collapsed selector");
assert.match(css, /\.sched-row\.is-completed/, "shared.css missing .sched-row.is-completed");
assert.match(css, /\.sched-row\.is-paused/, "shared.css missing .sched-row.is-paused");
assert.match(css, /\.sched-row\.is-highlighted/, "shared.css missing .sched-row.is-highlighted");
assert.match(css, /@keyframes schedHighlight/, "shared.css missing schedHighlight keyframes");
assert.match(css, /\.cal-entry:hover/, "shared.css must style .cal-entry hover (click affordance)");

// Exercise helpers via isolated eval.
const helperSource = js.slice(
  js.indexOf("function scheduleBucket("),
  js.indexOf("function renderSchedules(")
);
const exec = new Function(`${helperSource}; return { scheduleBucket, scheduleMatchesSearch };`);
const { scheduleBucket, scheduleMatchesSearch } = exec();

assert.equal(scheduleBucket({ enabled: true }), "active");
assert.equal(scheduleBucket({ enabled: false }), "paused");
assert.equal(scheduleBucket({ enabled: true, completed_at: "2026-04-20T00:00:00Z" }), "completed");
assert.equal(scheduleBucket({ enabled: false, completed_at: "2026-04-20T00:00:00Z" }), "completed");

assert.equal(scheduleMatchesSearch({ name: "Morning digest" }, ""), true);
assert.equal(scheduleMatchesSearch({ name: "Morning digest" }, "morning"), true);
assert.equal(scheduleMatchesSearch({ name: "Morning digest", trigger_type: "cron" }, "cron"), true);
assert.equal(scheduleMatchesSearch({ name: "Morning digest" }, "zzz"), false);

console.log("ok verify-schedule-grouping");
