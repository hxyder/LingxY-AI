#!/usr/bin/env node
/**
 * verify-timeline-card.mjs — UCA-177
 *
 * Locks in the modernized tool-call timeline card in the console chat.
 * The previous single-row mono card felt flat; the new two-row layout
 * carries a state rail, status pill, tabular timestamp, and monospace
 * args block, and reflects running / ok / err state visually.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readCssWithImports } from "./lib/css-imports.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

const css = readCssWithImports(root, "src/desktop/renderer/shared.css");
const js = read("src/desktop/renderer/console.js");

// CSS: new structural classes + state modifiers.
assert.match(css, /\.chat-tool-card\s*\{/, "shared.css missing .chat-tool-card");
assert.match(css, /\.chat-tool-card\.is-running/, "missing .chat-tool-card.is-running state");
assert.match(css, /\.chat-tool-card\.is-ok/, "missing .chat-tool-card.is-ok state");
assert.match(css, /\.chat-tool-card\.is-err/, "missing .chat-tool-card.is-err state");
assert.match(css, /\.chat-tool-card::before/, "missing left rail (::before) on timeline card");
assert.match(css, /@keyframes\s+ttcPulse/, "missing ttcPulse animation for running state");
assert.match(css, /\.chat-tool-card\s+\.ttc-head/, "missing .ttc-head row");
assert.match(css, /\.chat-tool-card\s+\.ttc-status/, "missing .ttc-status pill");
assert.match(css, /\.chat-tool-card\s+\.ttc-time/, "missing .ttc-time timestamp");
assert.match(css, /\.chat-tool-card\s+\.ttc-args/, "missing .ttc-args code block");
assert.match(css, /\.chat-tool-card\s+\.ttc-outcome/, "missing .ttc-outcome row");

// JS: the renderer emits the new structure with state class + pill label +
// timestamp, and preserves legacy tool-name / tool-args hooks for older
// callers.
assert.match(js, /function appendConsoleChatToolCall\(/,
  "console.js missing appendConsoleChatToolCall");
assert.match(js, /card\.className\s*=\s*`chat-tool-card is-\$\{inferredState\}`/,
  "appendConsoleChatToolCall must apply an is-<state> class to the card");
assert.match(js, /ttc-head/,
  "appendConsoleChatToolCall must render a .ttc-head row");
assert.match(js, /ttc-status/,
  "appendConsoleChatToolCall must render the status pill");
assert.match(js, /ttc-time/,
  "appendConsoleChatToolCall must render a timestamp");
assert.match(js, /ttc-args/,
  "appendConsoleChatToolCall must render an args block");

console.log("ok verify-timeline-card");
