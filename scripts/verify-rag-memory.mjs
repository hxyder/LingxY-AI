// Phase 18 verifier (UCA-182) — RAG memory write + semantic recall.
//
// embeddingStore was instantiated in Phase 1 work but nothing read
// from it, so RAG never fired. This verifier proves the two newly
// added paths actually land:
//
//   1. static wiring in context-submission.mjs + task-runtime.mjs
//   2. buildHistoryRecord now includes the final inline_result answer
//      text + artifact paths, capped to HISTORY_TEXT_CAP
//   3. seedSemanticMemories returns a contextPacket with the "[跨对话
//      相关任务]" digest when the store has relevant hits, and leaves
//      contextPacket untouched when the store is empty or times out
//   4. the 400ms recall timeout is honoured — verifier builds a fake
//      store whose search takes 2s, and asserts submit still returns

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
  assert.ok(ctx.includes("async function seedSemanticMemories"),
    "context-submission must define seedSemanticMemories");
  assert.ok(ctx.includes("MEMORY_RECALL_TIMEOUT_MS"),
    "recall must be wrapped in a race-against-timeout");
  assert.ok(ctx.includes("await seedSemanticMemories"),
    "submitContextTask must await the semantic recall helper");
  assert.ok(ctx.includes("[跨对话相关任务"),
    "digest label must be present");

  const tr = await readFile(path.join(ROOT, "src/service/core/task-runtime.mjs"), "utf8");
  assert.ok(tr.includes("HISTORY_TEXT_CAP"),
    "task-runtime must cap history record text");
  assert.ok(tr.includes("answer_excerpt"),
    "history metadata must carry the assistant answer excerpt");
  assert.ok(tr.includes("artifact_paths"),
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
  assert.ok(result.text.includes("[跨对话相关任务"),
    "digest line must be prepended when relevant memories exist");
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

  // timeout budget: a fake store whose search takes 2s should not stall the call
  const slowStore = {
    search: () => new Promise((r) => setTimeout(() => r([]), 2000))
  };
  const started = Date.now();
  const result4 = await seedSemanticMemories({
    runtime: { platform: { embeddingStore: slowStore } },
    userCommand: "foo",
    parentTaskId: null,
    contextPacket: { text: "original" }
  });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 800, `recall must fall back within timeout; took ${elapsed}ms`);
  assert.equal(result4.text, "original", "slow search must degrade silently");

  rmSync(tmpRoot, { recursive: true, force: true });
}

console.log("ok verify-rag-memory");
