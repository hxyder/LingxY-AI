import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createArtifactExtractBackgroundLane } from "../../src/service/core/artifact-extracts/artifact-extract-background-lane.mjs";
import { createArtifactExtractService } from "../../src/service/core/artifact-extracts/artifact-extract-service.mjs";
import { createInMemoryStoreScaffold } from "../../src/service/core/store/memory-store.mjs";
import { ensureRuntimeServices } from "../../src/service/core/task-runtime/runtime-services.mjs";
import { runArtifactExtractWorker } from "../../src/service/workers/artifact-extract-worker.mjs";

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

function seedStore() {
  const store = createInMemoryStoreScaffold();
  store.insertTask(taskRecord("task_extract_lane", "conv_extract_lane"));
  store.appendArtifact({
    artifact_id: "artifact_extract_lane",
    task_id: "task_extract_lane",
    conversation_id: "conv_extract_lane",
    path: "E:\\linxiDoc\\task_extract_lane\\report.xlsx",
    kind: "xlsx",
    created_at: "2026-05-09T04:01:00.000Z"
  });
  return store;
}

test("artifact extract background lane records worker result and progress", async () => {
  const store = seedStore();
  const artifactExtracts = createArtifactExtractService({ store });
  const progress = [];
  const lane = createArtifactExtractBackgroundLane({
    artifactExtracts,
    worker: async () => ({
      artifactId: "artifact_extract_lane",
      kind: "xlsx",
      quality: { parse_status: "partial", row_count: 2 },
      summary: "Workbook summary from worker.",
      content: "Owner,Total\nAda,42",
      warnings: ["sampled_rows"]
    })
  });

  const result = await lane.enqueueArtifactExtract({
    artifactId: "artifact_extract_lane",
    taskId: "task_extract_lane",
    conversationId: "conv_extract_lane",
    kind: "xlsx"
  }, {
    onProgress: (event) => progress.push(event)
  });

  assert.equal(result.ok, true);
  assert.equal(result.record.artifact_id, "artifact_extract_lane");
  assert.equal(result.record.task_id, "task_extract_lane");
  assert.equal(result.record.conversation_id, "conv_extract_lane");
  assert.equal(result.record.source, "artifact_extract_background_lane");
  assert.equal(result.record.metadata.quality.parse_status, "partial");
  assert.deepEqual(progress.map((event) => event.phase), ["queued", "started", "completed"]);
  assert.deepEqual(lane.snapshot(), { queued: 0, running: 0, max_concurrent: 1 });
});

test("artifact extract background lane writes structured failed extract instead of throwing", async () => {
  const store = seedStore();
  const lane = createArtifactExtractBackgroundLane({
    artifactExtracts: createArtifactExtractService({ store }),
    worker: async () => {
      throw new Error("parse failed");
    }
  });

  const result = await lane.enqueueArtifactExtract({
    artifactId: "artifact_extract_lane",
    taskId: "task_extract_lane",
    conversationId: "conv_extract_lane",
    kind: "pdf"
  });

  assert.equal(result.ok, false);
  assert.equal(result.record.metadata.quality.parse_status, "failed");
  assert.match(result.record.content_text, /parse failed/);
});

test("artifact extract background lane enforces timeout through AbortSignal", async () => {
  const store = seedStore();
  const progress = [];
  const lane = createArtifactExtractBackgroundLane({
    artifactExtracts: createArtifactExtractService({ store }),
    timeoutMs: 5,
    worker: async (_input, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")), { once: true });
      setTimeout(() => resolve({
        artifactId: "artifact_extract_lane",
        kind: "xlsx",
        quality: { parse_status: "partial" },
        summary: "too late",
        warnings: []
      }), 50);
    })
  });

  const result = await lane.enqueueArtifactExtract({
    artifactId: "artifact_extract_lane",
    taskId: "task_extract_lane",
    kind: "xlsx"
  }, {
    onProgress: (event) => progress.push(event)
  });

  assert.equal(result.ok, false);
  assert.equal(result.record.metadata.quality.parse_status, "timeout_or_aborted");
  assert.ok(progress.some((event) => event.phase === "failed"));
});

test("artifact extract worker returns structured warning for unsupported or missing files", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "linxi-artifact-worker-"));
  try {
    const file = path.join(dir, "sample.bin");
    writeFileSync(file, "sample", "utf8");
    const unsupported = await runArtifactExtractWorker({
      artifactId: "artifact_worker",
      path: file,
      kind: "bin"
    });
    const missing = await runArtifactExtractWorker({
      artifactId: "artifact_worker_missing",
      path: path.join(dir, "missing.xlsx"),
      kind: "xlsx"
    });

    assert.equal(unsupported.quality.parse_status, "failed");
    assert.deepEqual(unsupported.warnings, ["unsupported_kind"]);
    assert.equal(missing.quality.reason, "file_not_found");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runtime services attach artifact extract background lane with ArtifactExtractService", () => {
  const runtime = {
    store: createInMemoryStoreScaffold(),
    queue: { snapshot() { return { queued: 0, running: 0 }; } },
    eventBus: { publish() {} }
  };

  ensureRuntimeServices(runtime);

  assert.equal(typeof runtime.artifactExtracts.appendExtract, "function");
  assert.equal(typeof runtime.artifactExtractBackgroundLane.enqueueArtifactExtract, "function");
  assert.deepEqual(runtime.artifactExtractBackgroundLane.snapshot(), { queued: 0, running: 0, max_concurrent: 1 });
});
