#!/usr/bin/env node
/**
 * UCA-077 P4-02.x C2 (plan p4-03-p4-02-goofy-forest): RAG digest fix.
 *
 * Asserts:
 *   1. Digest sentinel is the new `[memory_background · ...]` prefix.
 *      Legacy `[跨对话相关任务（语义召回 · 可作为背景）]` is gone.
 *   2. Digest renders FULL callable task_id alongside a short display id;
 *      `get_task_detail` (memory-tools.mjs:212) requires exact match.
 *   3. TF-IDF-only hits below 0.25 are dropped (was 0.05 before — too
 *      lax; produced the 0.077 unrelated-email recall on the weather
 *      query reproduction).
 *   4. Vector-backed hits keep the loose 0.05 threshold (cosine over
 *      embedding space is less noisy).
 *   5. Mixed batch: tfidf below 0.25 dropped, vector above 0.05 kept.
 *   6. `selection_metadata.memory_background_injected = true` set on the
 *      returned packet (the C1 classifier reads this as authoritative).
 *   7. `selection_metadata.semantic_recall_ids` carries FULL ids (no
 *      truncation) — the model can ground get_task_detail on them.
 *   8. Empty results / missing store / no userCommand → contextPacket
 *      passed through unmodified.
 *
 * Run: node scripts/verify-rag-digest.mjs
 */

import assert from "node:assert/strict";

import { seedSemanticMemories } from "../src/service/core/context-submission.mjs";

let pass = 0;
let fail = 0;
function it(label, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { process.stdout.write(`PASS  ${label}\n`); pass += 1; })
    .catch((err) => {
      process.stdout.write(`FAIL  ${label}\n  ${err.message}\n`);
      if (err.stack) process.stdout.write(`  ${err.stack.split("\n").slice(1, 3).join("\n  ")}\n`);
      fail += 1;
    });
}

function makeStore(results) {
  return {
    embeddingStore: {
      async search() { return results; }
    }
  };
}

const FULL_ID_A = "task_5ab4836a8b7c9d1e2f3a4b5c6d7e8f9a";
const FULL_ID_B = "task_9876543210fedcba9876543210fedcba";

const FULL_ID_HIT = (overrides = {}) => ({
  id: FULL_ID_A,
  text: "summary text from task A",
  metadata: { summary: "Helped user write a quarterly report" },
  embeddingType: "tfidf",
  score: 0.5,
  lexicalScore: 0.5,
  semanticScore: 0,
  ...overrides
});

async function run() {
  // ── 1. sentinel rename ────────────────────────────────────────────────
  await it("sentinel: digest opens with [memory_background ·, NOT legacy", async () => {
    const runtime = { platform: makeStore([FULL_ID_HIT()]) };
    const out = await seedSemanticMemories({ runtime, userCommand: "x", contextPacket: {} });
    assert.match(out.text, /^\[memory_background ·/);
    assert.ok(!out.text.includes("[跨对话相关任务"),
      "legacy sentinel must be gone");
  });

  // ── 2. full callable task_id rendered ─────────────────────────────────
  await it("ids: digest renders display + callable: task_id=<full>", async () => {
    const runtime = { platform: makeStore([FULL_ID_HIT()]) };
    const out = await seedSemanticMemories({ runtime, userCommand: "x", contextPacket: {} });
    assert.match(out.text, new RegExp(`callable: task_id=${FULL_ID_A.replace(/[^a-z0-9]/gi, "\\$&")}`));
    assert.match(out.text, /display=task_5ab4836/);
  });
  await it("ids: model-callable id is the FULL id, not the truncated form", async () => {
    const runtime = { platform: makeStore([FULL_ID_HIT()]) };
    const out = await seedSemanticMemories({ runtime, userCommand: "x", contextPacket: {} });
    // The literal "task=<short>" pattern that pre-fix would emit must
    // not appear — it was the trap that produced "task not found".
    assert.ok(!out.text.match(/\(task=task_5ab4836a8b7\)/),
      "must not emit a shortened ' (task=<id>)' that the model would wrongly call");
  });

  // ── 3. TF-IDF threshold tightening ────────────────────────────────────
  await it("threshold: TF-IDF hit at 0.077 is DROPPED (was the bug)", async () => {
    const runtime = { platform: makeStore([
      FULL_ID_HIT({ score: 0.077, lexicalScore: 0.077 })
    ]) };
    const out = await seedSemanticMemories({ runtime, userCommand: "今天天气怎么样", contextPacket: {} });
    // Below 0.25 → no digest injected → returned unchanged.
    assert.equal(out.text, undefined);
    assert.equal(out.selection_metadata?.memory_background_injected, undefined);
  });
  await it("threshold: TF-IDF hit at 0.30 is KEPT (above 0.25)", async () => {
    const runtime = { platform: makeStore([
      FULL_ID_HIT({ score: 0.30, lexicalScore: 0.30 })
    ]) };
    const out = await seedSemanticMemories({ runtime, userCommand: "x", contextPacket: {} });
    assert.match(out.text, /^\[memory_background/);
  });

  // ── 4. vector hits keep loose threshold ───────────────────────────────
  await it("threshold: vector hit at 0.10 is KEPT (above 0.05 vector floor)", async () => {
    const runtime = { platform: makeStore([
      FULL_ID_HIT({ embeddingType: "vector", score: 0.10, semanticScore: 0.10 })
    ]) };
    const out = await seedSemanticMemories({ runtime, userCommand: "x", contextPacket: {} });
    assert.match(out.text, /^\[memory_background/);
  });
  await it("threshold: vector hit at 0.04 is DROPPED (below 0.05)", async () => {
    const runtime = { platform: makeStore([
      FULL_ID_HIT({ embeddingType: "vector", score: 0.04, semanticScore: 0.04 })
    ]) };
    const out = await seedSemanticMemories({ runtime, userCommand: "x", contextPacket: {} });
    assert.equal(out.text, undefined);
  });

  // ── 5. mixed batch ───────────────────────────────────────────────────
  await it("threshold: mixed batch — drop weak tfidf, keep strong vector", async () => {
    const weak = FULL_ID_HIT({ id: "task_weak1", embeddingType: "tfidf", score: 0.10 });
    const strong = FULL_ID_HIT({ id: FULL_ID_B, embeddingType: "vector", score: 0.30, semanticScore: 0.30 });
    const runtime = { platform: makeStore([weak, strong]) };
    const out = await seedSemanticMemories({ runtime, userCommand: "x", contextPacket: {} });
    assert.match(out.text, /^\[memory_background/);
    assert.deepEqual(out.selection_metadata.semantic_recall_ids, [FULL_ID_B]);
    assert.ok(!out.text.includes("task_weak1"), "weak tfidf must be filtered");
  });

  // ── 6. memory_background_injected flag ────────────────────────────────
  await it("flag: selection_metadata.memory_background_injected=true on success", async () => {
    const runtime = { platform: makeStore([FULL_ID_HIT()]) };
    const out = await seedSemanticMemories({ runtime, userCommand: "x", contextPacket: {} });
    assert.equal(out.selection_metadata.memory_background_injected, true);
  });

  // ── 7. semantic_recall_ids carry FULL ids ─────────────────────────────
  await it("metadata: semantic_recall_ids stores FULL task ids (no truncation)", async () => {
    const runtime = { platform: makeStore([FULL_ID_HIT()]) };
    const out = await seedSemanticMemories({ runtime, userCommand: "x", contextPacket: {} });
    assert.deepEqual(out.selection_metadata.semantic_recall_ids, [FULL_ID_A]);
    // sanity: the full id is much longer than the 12-char display slice.
    assert.ok(FULL_ID_A.length > 12);
    assert.equal(out.selection_metadata.semantic_recall_ids[0], FULL_ID_A);
  });

  // ── 8. degraded paths ─────────────────────────────────────────────────
  await it("degraded: missing embeddingStore → packet returned unmodified", async () => {
    const out = await seedSemanticMemories({ runtime: {}, userCommand: "x", contextPacket: { text: "original" } });
    assert.deepEqual(out, { text: "original" });
  });
  await it("degraded: empty userCommand → packet returned unmodified", async () => {
    const runtime = { platform: makeStore([FULL_ID_HIT()]) };
    const out = await seedSemanticMemories({ runtime, userCommand: "", contextPacket: { text: "original" } });
    assert.deepEqual(out, { text: "original" });
  });
  await it("degraded: empty results → packet returned unmodified", async () => {
    const runtime = { platform: makeStore([]) };
    const out = await seedSemanticMemories({ runtime, userCommand: "x", contextPacket: { text: "original" } });
    assert.deepEqual(out, { text: "original" });
  });
  await it("degraded: store.search throws → packet returned unmodified", async () => {
    const runtime = { platform: { embeddingStore: { async search() { throw new Error("kaboom"); } } } };
    const out = await seedSemanticMemories({ runtime, userCommand: "x", contextPacket: { text: "original" } });
    assert.deepEqual(out, { text: "original" });
  });

  // ── 9. parent task exclusion still respected ──────────────────────────
  await it("exclusion: parent_task_id hit is dropped even when score is high", async () => {
    const parent = FULL_ID_HIT({ id: "task_parent_xyz", score: 0.9 });
    const runtime = { platform: makeStore([parent]) };
    const out = await seedSemanticMemories({
      runtime, userCommand: "x", parentTaskId: "task_parent_xyz", contextPacket: {}
    });
    // Only hit was the parent → after exclusion no hits → unmodified packet.
    assert.equal(out.text, undefined);
  });

  // ── 10. C1 wiring lock-in ────────────────────────────────────────────
  await it("wiring: C1 classifyContextSources reads memory_background_injected as rag_background", async () => {
    const { classifyContextSources } = await import("../src/service/core/intent/context-sources.mjs");
    const runtime = { platform: makeStore([FULL_ID_HIT()]) };
    const enrichedPacket = await seedSemanticMemories({ runtime, userCommand: "x", contextPacket: {} });
    const sources = classifyContextSources({ text: "x", contextPacket: enrichedPacket });
    assert.equal(sources.rag_background, true,
      "C1 classifier must recognize the C2 producer flag");
  });

  process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
  if (fail > 0) process.exit(1);
}

await run();
