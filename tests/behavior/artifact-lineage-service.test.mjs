import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ARTIFACT_ACTIONS,
  createArtifactLineageService,
  validateArtifactTransformContract
} from "../../src/service/core/artifact-lineage/artifact-lineage-service.mjs";
import { createArtifactExtractService } from "../../src/service/core/artifact-extracts/artifact-extract-service.mjs";
import { createInMemoryStoreScaffold } from "../../src/service/core/store/memory-store.mjs";
import { createSqliteStore } from "../../src/service/core/store/sqlite-store.mjs";
import { ensureRuntimeServices } from "../../src/service/core/task-runtime/runtime-services.mjs";

function taskRecord(taskId, conversationId) {
  return {
    task_id: taskId,
    conversation_id: conversationId,
    created_at: "2026-05-09T05:00:00.000Z",
    updated_at: "2026-05-09T05:00:00.000Z",
    status: "success",
    sub_status: "completed",
    intent: "general",
    executor: "tool_using",
    source_type: "clipboard",
    user_command: "convert workbook to presentation",
    execution_mode: "interactive",
    context_packet: { source_type: "clipboard" }
  };
}

function seedTransformArtifacts(store, { targetPath = "E:\\linxiDoc\\task_lineage\\deck.pptx" } = {}) {
  store.insertTask(taskRecord("task_lineage_seed", "conv_lineage_seed"));
  const source = store.appendArtifact({
    artifact_id: "artifact_source_xlsx",
    task_id: "task_lineage_seed",
    path: "E:\\linxiDoc\\task_lineage\\source.xlsx",
    kind: "xlsx",
    created_at: "2026-05-09T05:01:00.000Z"
  });
  const target = store.appendArtifact({
    artifact_id: "artifact_target_pptx",
    task_id: "task_lineage_seed",
    path: targetPath,
    kind: "pptx",
    created_at: "2026-05-09T05:02:00.000Z"
  });
  return { source, target };
}

function withSqlite(fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lingxy-artifact-lineage-"));
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

runForBoth("artifact lineage service stores transform lineage and semantic validation", (store) => {
  const { source, target } = seedTransformArtifacts(store);
  const extractService = createArtifactExtractService({ store });
  extractService.appendExtract({
    artifactId: source.artifact_id,
    kind: "table",
    label: "Workbook shape",
    content: "Sheet1: Region, Revenue",
    createdAt: "2026-05-09T05:03:00.000Z"
  });

  const lineageService = createArtifactLineageService({ store });
  const lineage = lineageService.appendTransformLineage({
    targetArtifactId: target.artifact_id,
    sourceArtifactIds: [source.artifact_id],
    targetKind: "pptx",
    transformKind: "xlsx_to_pptx",
    contract: {
      requested_kind: "pptx",
      source_kind: "xlsx"
    },
    createdAt: "2026-05-09T05:04:00.000Z"
  });

  assert.equal(lineage.action, ARTIFACT_ACTIONS.TRANSFORM);
  assert.equal(lineage.task_id, "task_lineage_seed");
  assert.equal(lineage.conversation_id, "conv_lineage_seed");
  assert.deepEqual(lineage.source_artifact_ids, [source.artifact_id]);
  assert.equal(lineage.target_artifact_id, target.artifact_id);
  assert.equal(lineage.validation.ok, true);
  assert.equal(lineage.contract.schema_version, "1.0");

  assert.deepEqual(
    lineageService.listForArtifact(target.artifact_id, { role: "target" }).map((item) => item.lineage_id),
    [lineage.lineage_id]
  );
  assert.deepEqual(
    lineageService.listForArtifact(source.artifact_id, { role: "source" }).map((item) => item.lineage_id),
    [lineage.lineage_id]
  );
  assert.deepEqual(
    lineageService.listForTask("task_lineage_seed").map((item) => item.lineage_id),
    [lineage.lineage_id]
  );
});

runForBoth("transform contract rejects unrelated create-new artifacts", (store) => {
  const { source, target } = seedTransformArtifacts(store);
  const lineageService = createArtifactLineageService({ store });
  const lineage = lineageService.appendLineage({
    action: ARTIFACT_ACTIONS.CREATE_NEW,
    targetArtifactId: target.artifact_id,
    sourceArtifactIds: [source.artifact_id],
    targetKind: "pptx",
    contract: { requested_kind: "pptx" },
    validation: validateArtifactTransformContract({
      action: ARTIFACT_ACTIONS.CREATE_NEW,
      targetArtifact: target,
      sourceArtifactIds: [source.artifact_id],
      requestedKind: "pptx",
      quality: { source_extract: { status: "failed", reason: "extractor unavailable in unit test" } }
    }),
    createdAt: "2026-05-09T05:05:00.000Z"
  });

  assert.equal(lineage.validation.ok, false);
  assert.ok(lineage.validation.failures.includes("action_not_transform"));
});

test("transform contract rejects fake target paths and missing source extract quality", () => {
  const validation = validateArtifactTransformContract({
    action: ARTIFACT_ACTIONS.TRANSFORM,
    targetArtifact: {
      artifact_id: "target_fake",
      path: "sandbox:/download/result.pptx",
      kind: "pptx"
    },
    sourceArtifactIds: ["source_xlsx"],
    requestedKind: "pptx"
  });

  assert.equal(validation.ok, false);
  assert.ok(validation.failures.includes("fake_or_unstable_target_path"));
  assert.ok(validation.failures.includes("missing_source_extract_or_quality_reason"));
});

test("runtime services attach ArtifactLineageService when store supports lineage", () => {
  const runtime = {
    store: createInMemoryStoreScaffold(),
    queue: { snapshot() { return { queued: 0, running: 0 }; } },
    eventBus: { publish() {} }
  };
  ensureRuntimeServices(runtime);
  assert.equal(typeof runtime.artifactLineage.appendTransformLineage, "function");
});
