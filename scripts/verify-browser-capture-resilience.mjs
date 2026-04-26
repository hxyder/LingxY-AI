#!/usr/bin/env node
/**
 * UCA-077 (post-P4-RR boundary check): browser-capture independence.
 *
 * Establishes the boundary the user called out after `track conversation
 * memory dependency` (commit 835a859) landed:
 *
 *   - `normalizeConversationTurns` is a LIGHTWEIGHT, ALWAYS-AVAILABLE
 *     dependency of the browser submission path — fresh checkouts must
 *     boot the service without it crashing.
 *   - `seedSemanticMemories` (RAG recall via embeddingStore) is an
 *     OPTIONAL ENHANCEMENT — if the runtime has no embeddingStore, the
 *     browser flow must keep working with degraded but functional output.
 *
 * Asserts:
 *   1. `normalizeConversationTurns` accepts every shape it might receive
 *      from a browser capture: undefined, null, [], non-array, mixed roles.
 *   2. `buildBrowserContextPacket` produces a valid context packet when
 *      `capture.history` is absent — the result still carries a non-null
 *      `selection_metadata.conversation_turns` (= []), and downstream
 *      consumers can read it without further checks.
 *   3. The same when `capture` is missing every optional enrichment
 *      (no anchor_text, no contextBefore, no image, no html, no url).
 *   4. Source-level boundary: `browser-submission.mjs` imports ONLY
 *      `normalizeConversationTurns` from `conversation-memory.mjs` — no
 *      semantic-memory primitives are pulled in. This is a regression
 *      guard against turning the optional enhancement into a hard dep.
 *   5. Source-level boundary: `submitBrowserTask` does not reference
 *      `embeddingStore` directly. Any future RAG hook must go through a
 *      separate code path that degrades when the store is absent.
 *
 * Run: node scripts/verify-browser-capture-resilience.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { normalizeConversationTurns } from "../src/service/core/conversation-memory.mjs";
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
    if (err.stack) process.stdout.write(`  ${err.stack.split("\n").slice(1, 3).join("\n  ")}\n`);
    fail += 1;
  }
}

async function run() {
  // ── 1. normalizeConversationTurns is total over what the extension may send ──
  it("normalize: undefined → []", () => {
    assert.deepEqual(normalizeConversationTurns(undefined), []);
  });
  it("normalize: null → []", () => {
    assert.deepEqual(normalizeConversationTurns(null), []);
  });
  it("normalize: [] → []", () => {
    assert.deepEqual(normalizeConversationTurns([]), []);
  });
  it("normalize: non-array (e.g. accidentally an object) → []", () => {
    assert.deepEqual(normalizeConversationTurns({ foo: "bar" }), []);
  });
  it("normalize: mixed roles passes through valid turns", () => {
    const turns = [
      { role: "user", content: "hi" },
      { role: "tool", content: "ignore me" },
      { role: "assistant", content: "hello" }
    ];
    const out = normalizeConversationTurns(turns);
    assert.equal(out.length, 2);
    assert.equal(out[0].role, "user");
    assert.equal(out[1].role, "assistant");
  });

  // ── 2. buildBrowserContextPacket survives bare capture (no history) ─────
  it("buildBrowserContextPacket: bare capture without history produces valid packet", () => {
    const packet = buildBrowserContextPacket({
      capture: {
        sourceType: "selection",
        browser: "chrome",
        url: "https://example.com/article",
        text: "selected text"
        // NB: no `history` field
      },
      traceId: "trace_test",
      contextId: "ctx_test"
    });
    assert.equal(packet.context_id, "ctx_test");
    assert.equal(packet.source_type, "selection");
    assert.deepEqual(packet.selection_metadata.conversation_turns, []);
    assert.equal(packet.selection_metadata.conversation_turn_count, 0);
  });

  // ── 3. buildBrowserContextPacket survives a maximally-bare capture ─────
  it("buildBrowserContextPacket: capture with only sourceType still works", () => {
    const packet = buildBrowserContextPacket({
      capture: { sourceType: "clipboard" },
      traceId: "t",
      contextId: "c"
    });
    assert.equal(packet.context_id, "c");
    assert.equal(packet.source_type, "clipboard");
    assert.deepEqual(packet.selection_metadata.conversation_turns, []);
    // optional enrichments default to undefined / null without crashing.
    assert.equal(packet.selection_metadata.page_title, undefined);
    assert.equal(packet.selection_metadata.image_url, undefined);
  });
  it("buildBrowserContextPacket: history=null is treated identically to omitted", () => {
    const packet = buildBrowserContextPacket({
      capture: { sourceType: "chat", text: "anything", history: null },
      traceId: "t",
      contextId: "c"
    });
    assert.deepEqual(packet.selection_metadata.conversation_turns, []);
  });

  // ── 4. Source-level boundary guard: only the lightweight import ─────────
  const browserSrc = readFileSync("src/service/core/browser-submission.mjs", "utf8");
  it("boundary: browser-submission imports ONLY normalizeConversationTurns from conversation-memory", () => {
    const importLines = browserSrc.match(/import\s+\{[^}]*\}\s+from\s+"\.\/conversation-memory\.mjs"/g) ?? [];
    assert.equal(importLines.length, 1, `expected exactly 1 import from conversation-memory; got ${importLines.length}`);
    const symbols = importLines[0].match(/\{([^}]*)\}/)[1].split(",").map((s) => s.trim()).filter(Boolean);
    assert.deepEqual(symbols, ["normalizeConversationTurns"],
      `browser-submission must import exactly { normalizeConversationTurns }; got ${symbols.join(", ")}`);
  });
  it("boundary: browser-submission does NOT pull in seedSemanticMemories or embedding helpers", () => {
    assert.ok(!browserSrc.includes("seedSemanticMemories"),
      "browser-submission must not invoke seedSemanticMemories — RAG is optional, not a hard dep");
    assert.ok(!browserSrc.includes("seedConversationMemoryContext"),
      "browser-submission must not invoke seedConversationMemoryContext directly");
    assert.ok(!browserSrc.includes("embeddingStore"),
      "browser-submission must not reach into runtime.platform.embeddingStore");
  });

  // ── 5. submitBrowserTask source signature — no embeddingStore reference ──
  it("boundary: submitBrowserTask body does not reference embeddingStore", () => {
    const fnStart = browserSrc.indexOf("export async function submitBrowserTask({");
    assert.ok(fnStart > 0);
    const fnSlice = browserSrc.slice(fnStart);
    // We don't try to find the function's exact end; if the symbol shows
    // up anywhere in the rest of the file, that's a leak we want flagged.
    assert.ok(!fnSlice.includes("embeddingStore"),
      "any future RAG hook must live in a separate code path that degrades cleanly without embeddingStore");
  });

  process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
  if (fail > 0) process.exit(1);
}

await run();
