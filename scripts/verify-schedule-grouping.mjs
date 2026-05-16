#!/usr/bin/env node
/**
 * verify-schedule-grouping.mjs — UCA-125 Phase 7b
 *
 * Locks in the schedules UI improvements:
 *   - Search input (#scheduleSearchInput) exists and is wired.
 *   - renderSchedules() partitions schedules into three groups
 *     (active / paused / completed) with collapsible headers.
 *   - Completed rows render a "Re-run" label; paused rows use restrained status text.
 *   - Email schedules expose recipient slots as editable schedule fields.
 *   - Calendar entries carry data-schedule-ref, expand recurring cron
 *     schedules across the visible range, and click focuses the row.
 *   - shared.css covers .sched-group, .sched-group-head, chev rotation,
 *     .is-completed / .is-paused / .is-highlighted state styles,
 *     and .cal-entry hover affordance.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readCssWithImports } from "./lib/css-imports.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

const html = read("src/desktop/renderer/console.html");
const js = read("src/desktop/renderer/console.js");
const css = readCssWithImports(root, "src/desktop/renderer/shared.css");
const schedulesView = read("src/desktop/renderer/console-schedules-view.mjs");
const scheduleRoutes = read("src/service/core/http-routes/scheduler-template-routes.mjs");
const scheduleOccurrences = read("src/shared/schedule-occurrences.mjs");

// Search input exists in schedules toolbar.
assert.match(html, /<input id="scheduleSearchInput"/, "console.html missing #scheduleSearchInput");
assert.match(html, /<div class="sched-toolbar">/, "console.html missing .sched-toolbar wrapper");

// renderSchedules consumes the schedule view module instead of owning the pure helpers.
assert.match(js, /from\s+["']\.\/console-schedules-view\.mjs["']/, "console.js must import schedule view helpers");
assert.match(js, /from\s+["']\.\.\/\.\.\/shared\/schedule-occurrences\.mjs["']/, "console.js must import shared schedule occurrence helpers");
assert.match(schedulesView, /export function scheduleBucket\(/, "schedule view missing scheduleBucket()");
assert.match(schedulesView, /export function scheduleMatchesSearch\(/, "schedule view missing scheduleMatchesSearch()");
assert.match(schedulesView, /export function renderScheduleRow\(/, "schedule view missing renderScheduleRow()");
assert.match(scheduleOccurrences, /export function getScheduleOccurrences\(/, "shared schedule occurrence helper missing getScheduleOccurrences()");
assert.match(scheduleOccurrences, /export function getScheduleOccurrencesForRange\(/, "shared schedule occurrence helper missing range expander");

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
assert.match(schedulesView, /sched-status-text/, "paused schedule state must use restrained status text");
assert.doesNotMatch(schedulesView, /pill-neutral">paused</, "paused schedule state must not render an English pill");
assert.match(js, /sched-row-edit-recipients/, "schedule edit form must expose editable email recipients");
assert.match(js, /emailRecipients/, "schedule edit save must submit edited email recipients");
assert.match(scheduleRoutes, /function applyScheduleEmailRecipients/, "schedule route must update typed email recipient slots");
assert.match(scheduleRoutes, /side_effect_contract[\s\S]{0,400}email_send/, "schedule route must persist email recipients in side_effect_contract");

// Calendar entries carry ref + click handler.
assert.match(js, /data-schedule-ref="/, "console.js calendar missing data-schedule-ref");
assert.match(js, /getScheduleOccurrencesForRange\(schedules, rangeStart, rangeEnd\)/, "console.js calendar must expand recurring schedules for the visible range");
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
assert.match(css, /\.sched-status-text/, "shared.css missing restrained paused status text");
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
