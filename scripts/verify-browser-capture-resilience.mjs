#!/usr/bin/env node
/**
 * Browser-capture independence guard.
 *
 * After P6-F1 the frontend no longer ships rolling conversation history
 * with browser captures (backend conversation_messages is the source of
 * truth). This verifier locks the resulting boundary:
 *
 *   1. buildBrowserContextPacket produces a valid packet for any sparse
 *      capture shape (missing url / text / image / history).
 *   2. selection_metadata never carries `conversation_turns` —
 *      that field was removed in F1 and must not creep back.
 *   3. browser-submission must not pull in semantic-memory primitives
 *      (seedSemanticMemories / seedConversationMemoryContext) or reach
 *      into runtime.platform.embeddingStore. Any future RAG hook must
 *      degrade cleanly when the store is absent.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildBrowserContextPacket } from "../src/service/core/browser-submission.mjs";

let pass = 0;
let fail = 0;
function it(label, fn) {
  try {
    fn();
    process.stdout.write(`PASS  ${label}\n`);
    pass += 1;
  } catch (err) {
    process.stdout.write(`FAIL  ${label}\n  ${err.message}\n`);
    fail += 1;
  }
}

// ── 1. buildBrowserContextPacket survives sparse captures ───────────────
it("buildBrowserContextPacket: bare capture without history produces valid packet", () => {
  const packet = buildBrowserContextPacket({
    capture: {
      sourceType: "selection",
      browser: "chrome",
      url: "https://example.com/article",
      text: "selected text"
    },
    traceId: "trace_test",
    contextId: "ctx_test"
  });
  assert.equal(packet.context_id, "ctx_test");
  assert.equal(packet.source_type, "selection");
});

it("buildBrowserContextPacket: capture with only sourceType still works", () => {
  const packet = buildBrowserContextPacket({
    capture: { sourceType: "clipboard" },
    traceId: "t",
    contextId: "c"
  });
  assert.equal(packet.context_id, "c");
  assert.equal(packet.source_type, "clipboard");
  assert.equal(packet.selection_metadata.page_title, undefined);
  assert.equal(packet.selection_metadata.image_url, undefined);
});

// ── 2. F1 boundary: no conversation_turns in selection_metadata ─────────
it("F1 boundary: selection_metadata has no conversation_turns field", () => {
  const packet = buildBrowserContextPacket({
    capture: { sourceType: "selection", text: "x", history: [{ role: "user", content: "ignored" }] },
    traceId: "t", contextId: "c"
  });
  assert.equal(packet.selection_metadata.conversation_turns, undefined,
    "F1: selection_metadata.conversation_turns must not be emitted");
  assert.equal(packet.selection_metadata.conversation_turn_count, undefined,
    "F1: selection_metadata.conversation_turn_count must not be emitted");
});

// ── 3. Source-level: no semantic-memory or embedding hard deps ──────────
const browserSrc = readFileSync("src/service/core/browser-submission.mjs", "utf8");
it("boundary: browser-submission does NOT import conversation-memory", () => {
  assert.ok(!/from\s+"\.\/conversation-memory\.mjs"/.test(browserSrc),
    "F1 removed the conversation-memory dependency; the import must not return");
});
it("boundary: browser-submission does NOT pull in seedSemanticMemories or embedding helpers", () => {
  assert.ok(!browserSrc.includes("seedSemanticMemories"));
  assert.ok(!browserSrc.includes("seedConversationMemoryContext"));
  assert.ok(!browserSrc.includes("embeddingStore"));
});
it("boundary: submitBrowserTask body does not reference embeddingStore", () => {
  const fnStart = browserSrc.indexOf("export async function submitBrowserTask({");
  assert.ok(fnStart > 0);
  const fnSlice = browserSrc.slice(fnStart);
  assert.ok(!fnSlice.includes("embeddingStore"));
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
