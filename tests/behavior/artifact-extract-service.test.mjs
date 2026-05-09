import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ARTIFACT_EXTRACT_KINDS,
  createArtifactExtractService
} from "../../src/service/core/artifact-extracts/artifact-extract-service.mjs";
import { compileContextForTask } from "../../src/service/core/context/context-compiler.mjs";
import { createInMemoryStoreScaffold } from "../../src/service/core/store/memory-store.mjs";
import { createSqliteStore } from "../../src/service/core/store/sqlite-store.mjs";
import { ensureRuntimeServices } from "../../src/service/core/task-runtime/runtime-services.mjs";

function taskRecord(taskId, conversationId) {
  return {
    task_id: taskId,
    conversation_id: conversationId,
    created_at: "2026-05-09T04:00:00.000Z",
    updated_at: "2026-05-09T04:00:00.000Z",
    status: "success",
    sub_status: "completed",
    intent: "general",
    executor: "tool_using",
    source_type: "clipboard",
    user_command: "create artifact",
    execution_mode: "interactive",
    context_packet: { source_type: "clipboard" }
  };
}

function seedArtifact(store) {
  store.insertTask(taskRecord("task_extract_seed", "conv_extract_seed"));
  return store.appendArtifact({
    artifact_id: "artifact_extract_seed",
    task_id: "task_extract_seed",
    path: "E:\\linxiDoc\\task_extract_seed\\report.xlsx",
    kind: "xlsx",
    created_at: "2026-05-09T04:01:00.000Z"
  });
}

function withSqlite(fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lingxy-artifact-extract-"));
  const store = createSqliteStore({ dbPath: path.join(dir, "store.sqlite") });
  try {
    return fn(store);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function runForBoth(label, fn) {
  test(`memory: ${label}`, () => fn(createInMemoryStoreScaffold()));
  test(`sqlite: ${label}`, () => withSqlite(fn));
}

runForBoth("artifact extract service stores typed extract records", (store) => {
  seedArtifact(store);
  const service = createArtifactExtractService({ store });
  const extract = service.appendExtract({
    artifactId: "artifact_extract_seed",
    kind: ARTIFACT_EXTRACT_KINDS.TABLE,
    label: "Sheet1 preview",
    locator: { sheet: "Sheet1", rows: [1, 5] },
    content: "Name, Total\nAda, 42",
    data: { columns: ["Name", "Total"], row_count: 1 },
    confidence: 0.92,
    metadata: { extractor: "unit_test" },
    createdAt: "2026-05-09T04:02:00.000Z"
  });

  assert.equal(extract.artifact_id, "artifact_extract_seed");
  assert.equal(extract.task_id, "task_extract_seed");
  assert.equal(extract.conversation_id, "conv_extract_seed");
  assert.equal(extract.kind, "table");
  assert.deepEqual(extract.locator, { sheet: "Sheet1", rows: [1, 5] });
  assert.equal(extract.metadata.schema_version, "1.0");

  const listed = service.listForArtifact("artifact_extract_seed");
  assert.equal(listed.length, 1);
  assert.equal(listed[0].content_text, "Name, Total\nAda, 42");
  assert.deepEqual(service.listForTask("task_extract_seed").map((item) => item.extract_id), [extract.extract_id]);
});

test("runtime services attach ArtifactExtractService when store supports extracts", () => {
  const runtime = {
    store: createInMemoryStoreScaffold(),
    queue: { snapshot() { return { queued: 0, running: 0 }; } },
    eventBus: { publish() {} }
  };
  ensureRuntimeServices(runtime);
  assert.equal(typeof runtime.artifactExtracts.appendExtract, "function");
});

test("context compiler includes existing typed artifact extracts without reading files", () => {
  const store = createInMemoryStoreScaffold();
  const artifact = seedArtifact(store);
  const service = createArtifactExtractService({ store });
  service.appendExtract({
    artifactId: artifact.artifact_id,
    kind: ARTIFACT_EXTRACT_KINDS.SUMMARY,
    label: "Workbook summary",
    content: "Workbook contains Q2 totals by owner.",
    createdAt: "2026-05-09T04:03:00.000Z"
  });

  const compiled = compileContextForTask({
    task: {
      task_id: "task_follow_extract",
      conversation_id: "conv_extract_seed",
      user_command: "继续，把上个表格改成 PPT",
      context_packet: {
        recent_conversation_artifacts: [artifact]
      }
    },
    runtime: {
      store,
      artifactExtracts: service
    }
  });

  const extractItem = compiled.selected.find((item) => item.kind === "artifact_extract_summary");
  assert.ok(extractItem);
  assert.equal(extractItem.value.artifact_id, artifact.artifact_id);
  assert.match(extractItem.inclusion_reason, /typed artifact extract/);
});
