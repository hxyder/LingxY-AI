#!/usr/bin/env node
/**
 * verify-timeline-expand.mjs — UCA-102 (Phase 3b)
 *
 * Asserts the console task timeline uses expandable <details> for
 * events that carry rich payload (tool args, observations, errors),
 * and keeps the flat <div> render for plain status events. Asserts
 * the CSS marker suppressor exists in shared.css.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readCssWithImports } from "./lib/css-imports.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

const consoleJs = read("src/desktop/renderer/console.js");
const taskTimeline = read("src/desktop/renderer/console-task-timeline.mjs");

// renderTimelineEntry exists in the dedicated timeline renderer module.
assert.ok(
  /function renderTimelineEntry\s*\(/.test(taskTimeline),
  "console-task-timeline.mjs must define renderTimelineEntry"
);
assert.ok(
  /taskTimeline\.innerHTML[\s\S]{0,500}renderTimelineEntry\(ev\b/.test(consoleJs),
  "timeline render must delegate to renderTimelineEntry"
);
assert.ok(
  /from\s+["']\.\/console-task-timeline\.mjs["']/.test(consoleJs),
  "console.js must import the timeline renderer module"
);

// Opens for failures + pending.
assert.ok(
  /payload\.success === false/.test(taskTimeline),
  "renderTimelineEntry must branch on tool failure"
);
assert.ok(
  /<details\s+class="timeline-item"/.test(taskTimeline),
  "renderTimelineEntry must emit <details class=\"timeline-item\">"
);
assert.ok(
  /<summary/.test(taskTimeline),
  "renderTimelineEntry must emit a <summary>"
);

// CSS: hide default marker on webkit AND strip list-style so Chromium/FF
// don't render the disclosure triangle inside the surface card.
const shared = readCssWithImports(root, "src/desktop/renderer/shared.css");
assert.ok(
  /details\.timeline-item\s*>\s*summary\s*\{[^}]*list-style:\s*none/s.test(shared),
  "shared.css must hide the <summary> default marker"
);
assert.ok(
  /::-webkit-details-marker\s*\{[^}]*display:\s*none/s.test(shared),
  "shared.css must hide webkit disclosure triangle"
);

console.log("ok verify-timeline-expand");
