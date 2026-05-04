#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createEmbeddingStore,
  EMBEDDING_NAMESPACES
} from "../src/service/embeddings/store.mjs";

const tmpRoot = mkdtempSync(path.join(tmpdir(), "lingxy-file-rag-namespace-"));
try {
  const store = createEmbeddingStore({ filePath: path.join(tmpRoot, "embed.json") });

  store.add({
    id: "task_memory_1",
    text: "Quarterly planning conversation summary",
    metadata: { summary: "Planning summary" }
  });
  store.add({
    id: "file_content_1",
    namespace: EMBEDDING_NAMESPACES.FILE_CONTENT,
    text: "Unique file-only retrieval marker",
    metadata: {
      path: "E:\\workspace\\notes.md",
      coverage_scope: "folder_recursive_text",
      chars_extracted: 42,
      truncated: false,
      artifact_id: "artifact_1",
      revision_of: null
    }
  });

  const defaultResults = await store.search("Unique file-only retrieval marker", 5);
  assert.ok(defaultResults.every((record) => record.metadata.namespace === EMBEDDING_NAMESPACES.TASK_MEMORY),
    "default semantic recall must stay in task_memory namespace");
  assert.equal(defaultResults.some((record) => record.id === "file_content_1"), false,
    "file_content records must not pollute default task memory recall");

  const fileResults = await store.search("Unique file-only retrieval marker", 5, {
    namespace: EMBEDDING_NAMESPACES.FILE_CONTENT
  });
  assert.equal(fileResults[0]?.id, "file_content_1");
  assert.equal(fileResults[0]?.metadata.coverage_scope, "folder_recursive_text");
  assert.equal(fileResults[0]?.metadata.artifact_id, "artifact_1");

  const allRecords = store.list();
  assert.equal(allRecords.length, 2, "list() remains an all-namespace inventory");
  const fileInventory = store.list({ namespace: EMBEDDING_NAMESPACES.FILE_CONTENT });
  assert.deepEqual(fileInventory.map((record) => record.id), ["file_content_1"]);

  assert.equal(store.remove("task_memory_1", { namespace: EMBEDDING_NAMESPACES.FILE_CONTENT }), null,
    "namespace-scoped removal must not delete task_memory records");
  assert.equal(store.list().some((record) => record.id === "task_memory_1"), true,
    "task_memory record should remain after a file_content-scoped miss");

  const removed = store.remove("file_content_1", { namespace: EMBEDDING_NAMESPACES.FILE_CONTENT });
  assert.equal(removed?.id, "file_content_1");
  assert.equal(removed?.namespace, EMBEDDING_NAMESPACES.FILE_CONTENT);
  assert.equal(store.list({ namespace: EMBEDDING_NAMESPACES.FILE_CONTENT }).length, 0);
  assert.equal(store.list({ namespace: EMBEDDING_NAMESPACES.TASK_MEMORY }).length, 1);

  console.log("file RAG namespace verification passed");
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}
