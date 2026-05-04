#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  renderChatMessageBlocksHtml
} from "../src/desktop/renderer/chat-blocks.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

const consoleJs = read("src/desktop/renderer/console.js");
const overlayJs = read("src/desktop/renderer/overlay.js");
const sharedCss = read("src/desktop/renderer/shared.css");
const chatBlocks = read("src/desktop/renderer/chat-blocks.mjs");

assert.match(consoleJs, /from\s+["']\.\/chat-blocks\.mjs["']/,
  "console must use the shared chat blocks renderer");
assert.match(overlayJs, /from\s+["']\.\/chat-blocks\.mjs["']/,
  "overlay must use the shared chat blocks renderer");
assert.match(sharedCss, /\.md-table\b[\s\S]*\.md-diagram\b[\s\S]*\.md-svg-figure\b/,
  "shared CSS must style table, diagram, and SVG blocks");
assert.doesNotMatch(chatBlocks, /岗位|招聘|简历|Raleigh|YouTube|Excel|Word/i,
  "chat blocks renderer must not contain task/topic-specific patches");

const html = renderChatMessageBlocksHtml([
  "## Inline Fixture",
  "",
  "| A | B |",
  "| --- | --- |",
  "| 1 | 2 |",
  "",
  "```mermaid",
  "graph TD; A-->B;",
  "```",
  "",
  "<svg viewBox=\"0 0 1 1\" onclick=\"x()\"><script>x()</script><path d=\"M0 0h1\"/></svg>"
].join("\n"));

assert.match(html, /class="md-h2"/);
assert.match(html, /class="md-table"/);
assert.match(html, /class="md-diagram md-diagram--mermaid"/);
assert.match(html, /class="md-svg-figure"/);
assert.doesNotMatch(html, /onclick|<script/i);

console.log("Chat blocks verification passed.");
