import test from "node:test";
import assert from "node:assert/strict";

import {
  hasStructuredChatBlocks,
  renderChatMessageBlocksHtml,
  sanitizeSvgMarkup
} from "../../src/desktop/renderer/chat-blocks.mjs";

test("chat blocks render GFM tables, code blocks, links, mermaid, and svg", () => {
  const html = renderChatMessageBlocksHtml([
    "# Report",
    "",
    "| Item | Score |",
    "| --- | ---: |",
    "| A | 10 |",
    "",
    "```js",
    "console.log('ok');",
    "```",
    "",
    "```mermaid",
    "graph TD; A-->B;",
    "```",
    "",
    "<svg viewBox=\"0 0 10 10\"><circle cx=\"5\" cy=\"5\" r=\"4\"/></svg>",
    "",
    "Source: https://example.com/report"
  ].join("\n"));

  assert.match(html, /class="md-h1"/);
  assert.match(html, /<table class="md-table">/);
  assert.match(html, /<th style="text-align:left;">Item<\/th>/);
  assert.match(html, /<td style="text-align:right;">10<\/td>/);
  assert.match(html, /class="md-code"/);
  assert.match(html, /data-lang="js"/);
  assert.match(html, /data-md-copy/);
  assert.match(html, /class="md-diagram md-diagram--mermaid"/);
  assert.match(html, /graph TD; A--&gt;B;/);
  assert.match(html, /class="md-svg-figure"/);
  assert.match(html, /<svg viewBox="0 0 10 10">/);
  assert.match(html, /data-open-url="https:\/\/example\.com\/report"/);
});

test("chat blocks sanitize unsafe inline svg", () => {
  const safe = sanitizeSvgMarkup(`
    <svg viewBox="0 0 10 10" onclick="alert(1)">
      <script>alert(1)</script>
      <a href="javascript:alert(1)"><circle cx="5" cy="5" r="4"/></a>
    </svg>
  `);
  assert.match(safe, /^<svg\b/);
  assert.doesNotMatch(safe, /script/i);
  assert.doesNotMatch(safe, /onclick/i);
  assert.doesNotMatch(safe, /javascript:/i);
  assert.match(safe, /href="#blocked"/);
});

test("chat blocks structured detector covers shared rich block vocabulary", () => {
  assert.equal(hasStructuredChatBlocks("plain short answer"), false);
  assert.equal(hasStructuredChatBlocks("| A | B |\n| --- | --- |\n| 1 | 2 |"), true);
  assert.equal(hasStructuredChatBlocks("```mermaid\ngraph TD; A-->B;\n```"), true);
  assert.equal(hasStructuredChatBlocks("<svg viewBox=\"0 0 1 1\"></svg>"), true);
});

test("chat blocks do not pass through raw html except sanitized svg", () => {
  const html = renderChatMessageBlocksHtml("Hello <img src=x onerror=alert(1)> <script>alert(1)</script>");
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<img/i);
  assert.match(html, /&lt;img/);
});
