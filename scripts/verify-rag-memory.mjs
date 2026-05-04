// Phase 18 verifier (UCA-182) — RAG memory write + semantic recall.
//
// embeddingStore was instantiated in Phase 1 work but nothing read
// from it, so RAG never fired. This verifier proves the two newly
// added paths actually land:
//
//   1. static wiring in context-submission.mjs + task-lifecycle.mjs
//   2. buildHistoryRecord now includes the final inline_result answer
//      text + artifact paths, capped to HISTORY_TEXT_CAP
//   3. seedSemanticMemories returns a contextPacket with the
//      "[memory_background · ...]" digest when the store has relevant
//      hits, and leaves contextPacket untouched when the store is empty
//      or times out
//   4. the 400ms recall timeout is honoured — verifier builds a fake
//      store whose search takes 2s, and asserts submit still returns
//
// UCA-077 P4-02.x C2: the digest sentinel was renamed from the legacy
// `[跨对话相关任务（语义召回 · 可作为背景）]` to
// `[memory_background · 语义召回 · ...]` so the C1 context-source
// classifier can recognise it as background-only. Per-hit threshold
// also tightened (0.05 → 0.25 for TF-IDF) and task ids in the digest
// are now full callable ids, not 12-char slices.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// --- 1. static wiring ------------------------------------------------
{
  const ctx = await readFile(path.join(ROOT, "src/service/core/context-submission.mjs"), "utf8");
  // Phase 1.11: recall is now POST-task fire-and-forget. The legacy
  // helper `seedSemanticMemories` survives as a back-compat shim that
  // wraps `computeMemoryRecallEntry`; production callers go through
  // `computeMemoryRecallEntry` and patch `task.context_packet.background_contexts`.
  assert.ok(ctx.includes("export async function computeMemoryRecallEntry"),
    "context-submission must define the structured-entry helper");
  assert.ok(ctx.includes("async function seedSemanticMemories"),
    "context-submission must keep the back-compat seedSemanticMemories shim");
  assert.ok(ctx.includes("MEMORY_RECALL_TIMEOUT_MS"),
    "recall must still be wrapped in a race-against-timeout");
  assert.ok(!/await\s+seedSemanticMemories/.test(ctx),
    "submitContextTask must NOT await semantic recall in the pre-task path (Phase 1.11 — moved to post-task)");
  assert.ok(/computeMemoryRecallEntry\s*\(\s*\{/.test(ctx),
    "post-task patcher must invoke computeMemoryRecallEntry");
  assert.ok(ctx.includes("export async function computeFileContentRecallEntry"),
    "context-submission must define the file-content recall helper");
  assert.ok(/computeFileContentRecallEntry\s*\(\s*\{/.test(ctx),
    "post-task patcher must invoke computeFileContentRecallEntry");
  assert.ok(ctx.includes("__fileContentPatchPromise"),
    "file-content recall must be tracked as a non-enumerable task promise");
  assert.ok(ctx.includes("file_content_recall_injected"),
    "file-content recall must stamp structured selection metadata");
  assert.ok(/pushBackgroundContextInPlace/.test(ctx),
    "post-task patcher must push the recall entry into background_contexts");
  assert.ok(ctx.includes("[memory_background · 语义召回"),
    "back-compat shim must still emit the legacy sentinel for callers on the old contract");

  const taskLifecycle = await readFile(path.join(ROOT, "src/service/core/task-runtime/task-lifecycle.mjs"), "utf8");
  assert.ok(taskLifecycle.includes("HISTORY_TEXT_CAP"),
    "task-lifecycle must cap history record text");
  assert.ok(taskLifecycle.includes("answer_excerpt"),
    "history metadata must carry the assistant answer excerpt");
  assert.ok(taskLifecycle.includes("artifact_paths"),
    "history metadata must carry artifact paths");
}

// --- 2. runtime behaviour (semantic recall ON a real store) ---------
// Build a throwaway embedding store, seed it, call the server-side
// submitContextTask, and assert the resulting task's context_packet
// carries the [跨对话相关任务] digest + selection_metadata hints.
{
  const { createEmbeddingStore } = await import("../src/service/embeddings/store.mjs");
  const tmpRoot = mkdtempSync(path.join(tmpdir(), "lingxy-rag-"));
  const store = createEmbeddingStore({ filePath: path.join(tmpRoot, "embed.json") });
  store.add({
    id: "task_prior_001",
    text: "帮我写一份关于未来5年人工智能产业发展的分析报告",
    metadata: {
      summary: "生成未来5年AI发展分析报告",
      status: "success",
      answer_excerpt: "报告覆盖基础模型、硬件、应用场景三部分",
      artifact_paths: ["E:\\linxiDoc\\ai-report.docx"]
    }
  });
  store.add({
    id: "task_prior_002",
    text: "今天天气怎么样",
    metadata: { summary: "天气查询", status: "success" }
  });

  const { seedSemanticMemories } = await import("../src/service/core/context-submission.mjs");
  const runtime = { platform: { embeddingStore: store } };
  const result = await seedSemanticMemories({
    runtime,
    userCommand: "基于之前的人工智能报告再写一份ppt",
    parentTaskId: null,
    contextPacket: { text: "原始 context" }
  });
  assert.ok(result.text.includes("[memory_background · 语义召回"),
    "digest line must be prepended with the C2 sentinel when relevant memories exist");
  assert.ok(result.text.includes("task_prior_0") || result.text.includes("生成未来5年AI发展"),
    "digest must cite the matching prior task's summary or id");
  assert.ok(Array.isArray(result.selection_metadata?.semantic_recall_ids),
    "selection_metadata must carry recall IDs");

  // parentTaskId exclusion
  const result2 = await seedSemanticMemories({
    runtime,
    userCommand: "基于之前的人工智能报告再写一份ppt",
    parentTaskId: "task_prior_001",
    contextPacket: { text: "" }
  });
  if (result2.text.includes("task_prior_001")) {
    assert.fail("parent_task_id must be excluded from its own recall digest");
  }

  // empty store → pass-through
  const emptyStore = createEmbeddingStore({ filePath: path.join(tmpRoot, "empty.json") });
  const result3 = await seedSemanticMemories({
    runtime: { platform: { embeddingStore: emptyStore } },
    userCommand: "foo",
    parentTaskId: null,
    contextPacket: { text: "original" }
  });
  assert.equal(result3.text, "original", "empty store must leave context untouched");

  // timeout budget: a fake store whose search takes 3s should not stall
  // the call. P4-02.x follow-up bumped MEMORY_RECALL_TIMEOUT_MS from
  // 400 → 1000 (real searches measured 350-470ms; 400 was too tight).
  // The slow-store sleep is now 3s and the assertion ceiling is 1500ms
  // so the timeout fires well before the store would resolve.
  const slowStore = {
    search: () => new Promise((r) => setTimeout(() => r([]), 3000))
  };
  const started = Date.now();
  const result4 = await seedSemanticMemories({
    runtime: { platform: { embeddingStore: slowStore } },
    userCommand: "foo",
    parentTaskId: null,
    contextPacket: { text: "original" }
  });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 1500, `recall must fall back within timeout; took ${elapsed}ms`);
  assert.equal(result4.text, "original", "slow search must degrade silently");

  rmSync(tmpRoot, { recursive: true, force: true });
}

console.log("ok verify-rag-memory");
