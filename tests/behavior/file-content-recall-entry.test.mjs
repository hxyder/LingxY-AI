import test from "node:test";
import assert from "node:assert/strict";

import {
  computeFileContentRecallEntry
} from "../../src/service/core/context-submission.mjs";
import {
  createEmbeddingStore,
  EMBEDDING_NAMESPACES
} from "../../src/service/embeddings/store.mjs";

function createRuntimeWithFileIndex() {
  const embeddingStore = createEmbeddingStore();
  embeddingStore.add({
    id: "file_content_global",
    namespace: EMBEDDING_NAMESPACES.FILE_CONTENT,
    text: "global research notes about portable workflows",
    metadata: {
      path: "E:\\docs\\global.md",
      project_id: null,
      chunk_index: 0,
      chunk_count: 1,
      char_start: 0,
      char_end: 46
    }
  });
  embeddingStore.add({
    id: "file_content_project",
    namespace: EMBEDDING_NAMESPACES.FILE_CONTENT,
    text: "project alpha notes about model deployment risk controls",
    metadata: {
      path: "E:\\projects\\alpha\\risk.md",
      project_id: "project_alpha",
      chunk_index: 1,
      chunk_count: 3,
      char_start: 800,
      char_end: 1400
    }
  });
  return {
    platform: { embeddingStore }
  };
}

test("file-content recall stays off without structural file-read need", async () => {
  const runtime = createRuntimeWithFileIndex();
  const entry = await computeFileContentRecallEntry({
    runtime,
    userCommand: "今天天气怎么样",
    task: {
      project_id: "project_alpha",
      context_packet: {},
      task_spec: {
        success_contract: { required_policy_groups: [] }
      }
    }
  });

  assert.equal(entry, null);
});

test("file-content recall returns project-scoped candidate chunks for file-read tasks", async () => {
  const runtime = createRuntimeWithFileIndex();
  const entry = await computeFileContentRecallEntry({
    runtime,
    userCommand: "总结项目 alpha 的 model deployment risk controls",
    task: {
      project_id: "project_alpha",
      context_packet: {},
      task_spec: {
        success_contract: { required_policy_groups: ["local_file_text_read"] }
      }
    }
  });

  assert.ok(entry);
  assert.equal(entry.kind, "rag_background");
  assert.equal(entry.priority, "background");
  assert.equal(entry.metadata.project_id, "project_alpha");
  assert.deepEqual(entry.metadata.file_content_recall_ids, ["file_content_project"]);
  assert.equal(entry.metadata.results[0].path, "E:\\projects\\alpha\\risk.md");
  assert.equal(entry.metadata.results[0].chunk_index, 1);
  assert.match(entry.content, /Candidate indexed file-content chunks/);
  assert.match(entry.content, /read_file_text\/read_folder_text/);
  assert.doesNotMatch(entry.content, /global\.md/);
});

test("file-content recall can search global records for ordinary chat scope", async () => {
  const runtime = createRuntimeWithFileIndex();
  const entry = await computeFileContentRecallEntry({
    runtime,
    userCommand: "portable workflows",
    task: {
      project_id: null,
      context_packet: {
        semantic_router_decision: {
          needed_capabilities: ["file_read"]
        }
      },
      task_spec: {
        success_contract: { required_policy_groups: [] }
      }
    }
  });

  assert.ok(entry);
  assert.equal(entry.metadata.project_id, null);
  assert.deepEqual(entry.metadata.file_content_recall_ids, ["file_content_global"]);
});
