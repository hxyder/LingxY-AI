import test from "node:test";
import assert from "node:assert/strict";

import {
  computeFileContentRecallEntry
} from "../../src/service/core/context-submission.mjs";
import {
  createEmbeddingStore,
  EMBEDDING_NAMESPACES
} from "../../src/service/embeddings/store.mjs";

const PROJECT_ID = "project_alpha";
const PATH_A = "E:\\projects\\alpha\\safety.md";
const PATH_B = "E:\\projects\\alpha\\cost.md";

function createRuntime({ attachedFilePaths = null, withConfigStore = true } = {}) {
  const embeddingStore = createEmbeddingStore();
  embeddingStore.add({
    id: "file_content_a",
    namespace: EMBEDDING_NAMESPACES.FILE_CONTENT,
    text: "project alpha deployment risk checklist for safety controls",
    metadata: {
      path: PATH_A,
      project_id: PROJECT_ID,
      chunk_index: 0,
      chunk_count: 1
    }
  });
  embeddingStore.add({
    id: "file_content_b",
    namespace: EMBEDDING_NAMESPACES.FILE_CONTENT,
    text: "project alpha deployment risk checklist for cost controls",
    metadata: {
      path: PATH_B,
      project_id: PROJECT_ID,
      chunk_index: 0,
      chunk_count: 1
    }
  });
  const runtime = {
    platform: { embeddingStore }
  };
  if (withConfigStore) {
    runtime.configStore = {
      load: () => ({
        ui: {
          projectStore: {
            projects: [
              {
                id: PROJECT_ID,
                name: "Alpha",
                attachedFilePaths: attachedFilePaths ?? []
              }
            ],
            conversations: []
          }
        }
      })
    };
  }
  return runtime;
}

function fileReadTask() {
  return {
    project_id: PROJECT_ID,
    context_packet: {},
    task_spec: {
      success_contract: { required_policy_groups: ["local_file_text_read"] }
    }
  };
}

test("project attached file allowlist narrows file-content recall", async () => {
  const entry = await computeFileContentRecallEntry({
    runtime: createRuntime({ attachedFilePaths: [PATH_A] }),
    userCommand: "project alpha deployment risk checklist",
    task: fileReadTask()
  });

  assert.ok(entry);
  assert.deepEqual(entry.metadata.file_content_recall_ids, ["file_content_a"]);
  assert.equal(entry.metadata.results[0].path, PATH_A);
  assert.doesNotMatch(entry.content, /cost\.md/);
});

test("non-empty project allowlist blocks unrelated indexed chunks", async () => {
  const entry = await computeFileContentRecallEntry({
    runtime: createRuntime({ attachedFilePaths: ["E:\\projects\\alpha\\missing.md"] }),
    userCommand: "project alpha deployment risk checklist",
    task: fileReadTask()
  });

  assert.equal(entry, null);
});

test("empty project allowlist keeps existing implicit project scope behavior", async () => {
  const entry = await computeFileContentRecallEntry({
    runtime: createRuntime({ attachedFilePaths: [] }),
    userCommand: "project alpha deployment risk checklist",
    task: fileReadTask()
  });

  assert.ok(entry);
  assert.deepEqual(new Set(entry.metadata.file_content_recall_ids), new Set(["file_content_a", "file_content_b"]));
});

test("missing config store keeps existing implicit project scope behavior", async () => {
  const entry = await computeFileContentRecallEntry({
    runtime: createRuntime({ withConfigStore: false }),
    userCommand: "project alpha deployment risk checklist",
    task: fileReadTask()
  });

  assert.ok(entry);
  assert.deepEqual(new Set(entry.metadata.file_content_recall_ids), new Set(["file_content_a", "file_content_b"]));
});
