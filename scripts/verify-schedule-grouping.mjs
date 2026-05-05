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
function readCssWithImports(relativePath, seen = new Set()) {
  const absolutePath = path.join(root, relativePath);
  if (seen.has(absolutePath)) return "";
  seen.add(absolutePath);
  const css = readFileSync(absolutePath, "utf8");
  const dir = path.dirname(relativePath);
  return css.replace(/@import\s+url\(["']?([^"')]+)["']?\);\s*/g, (_match, target) => {
    const child = path.join(dir, target).replace(/\\/g, "/");
    return readCssWithImports(child, seen);
  });
}

const html = read("src/desktop/renderer/console.html");
const js = read("src/desktop/renderer/console.js");
const css = readCssWithImports("src/desktop/renderer/shared.css");
const schedulesView = read("src/desktop/renderer/console-schedules-view.mjs");

// Search input exists in schedules toolbar.
assert.match(html, /<input id="scheduleSearchInput"/, "console.html missing #scheduleSearchInput");
assert.match(html, /<div class="sched-toolbar">/, "console.html missing .sched-toolbar wrapper");

// renderSchedules consumes the schedule view module instead of owning the pure helpers.
assert.match(js, /from\s+["']\.\/console-schedules-view\.mjs["']/, "console.js must import schedule view helpers");
assert.match(schedulesView, /export function scheduleBucket\(/, "schedule view missing scheduleBucket()");
assert.match(schedulesView, /export function scheduleMatchesSearch\(/, "schedule view missing scheduleMatchesSearch()");
assert.match(schedulesView, /export function renderScheduleRow\(/, "schedule view missing renderScheduleRow()");

// Three group keys appear in the spec block.
for (const key of ["active", "paused", "completed"]) {
  assert.ok(
    new RegExp(`key:\\s*"${key}"`).test(js),
    `console.js renderSchedules missing group "${key}"`
  );
}

// Row state class + re-run label.
assert.match(schedulesView, /is-completed/, "schedule view missing .is-completed class in row");
assert.match(schedulesView, /is-paused/, "schedule view missing .is-paused class in row");
assert.match(schedulesView, /"Re-run"/, "schedule view missing Re-run label for completed schedules");

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

// Exercise helpers through the real module API.
const { scheduleBucket, scheduleMatchesSearch } = await import("../src/desktop/renderer/console-schedules-view.mjs");

assert.equal(scheduleBucket({ enabled: true, next_run_at: "2026-04-20T09:00:00Z" }), "active");
assert.equal(scheduleBucket({ enabled: false }), "paused");
assert.equal(scheduleBucket({ enabled: true, completed_at: "2026-04-20T00:00:00Z" }), "completed");
assert.equal(scheduleBucket({ enabled: false, completed_at: "2026-04-20T00:00:00Z" }), "completed");
assert.equal(
  scheduleBucket({
    enabled: true,
    trigger_type: "at",
    next_run_at: null,
    last_run_at: "2026-04-20T09:00:00Z"
  }),
  "completed"
);
assert.equal(
  scheduleBucket({
    enabled: true,
    trigger_type: "interval",
    metadata: { one_shot: true },
    next_run_at: null,
    run_count: 1
  }),
  "completed"
);

assert.equal(scheduleMatchesSearch({ name: "Morning digest" }, ""), true);
assert.equal(scheduleMatchesSearch({ name: "Morning digest" }, "morning"), true);
assert.equal(scheduleMatchesSearch({ name: "Morning digest", trigger_type: "cron" }, "cron"), true);
assert.equal(scheduleMatchesSearch({ name: "Morning digest" }, "zzz"), false);

console.log("ok verify-schedule-grouping");
