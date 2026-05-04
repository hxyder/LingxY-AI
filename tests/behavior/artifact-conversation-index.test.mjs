import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createSqliteStore } from "../../src/service/core/store/sqlite-store.mjs";
import { createInMemoryStoreScaffold } from "../../src/service/core/store/memory-store.mjs";
import { createArtifactStore } from "../../src/service/store/artifact-store.mjs";

function withSqlite(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "artifact-conv-index-"));
  const store = createSqliteStore({ dbPath: path.join(dir, "uca.db") });
  try {
    fn(store);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function runForBoth(label, fn) {
  test(`sqlite: ${label}`, () => withSqlite(fn));
  test(`memory: ${label}`, () => fn(createInMemoryStoreScaffold()));
}

function taskRecord(taskId, conversationId, createdAt = "2026-05-01T10:00:00.000Z") {
  return {
    task_id: taskId,
    conversation_id: conversationId,
    created_at: createdAt,
    updated_at: createdAt,
    status: "success",
    sub_status: "completed",
    intent: "general",
    executor: "tool_using",
    user_command: `task ${taskId}`,
    execution_mode: "interactive",
    context_packet: { source_type: "clipboard" },
    completed_steps: [],
    executor_history: []
  };
}

runForBoth("appendArtifact derives conversation_id from the task row", (store) => {
  store.insertTask(taskRecord("task_a", "conv_a"));
  const saved = store.appendArtifact({
    artifact_id: "artifact_a",
    task_id: "task_a",
    path: "E:\\out\\a.docx",
    mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    created_at: "2026-05-01T10:05:00.000Z"
  });
  assert.equal(saved.conversation_id, "conv_a");
  assert.equal(saved.kind, "document");
  assert.equal(saved.source, "generated");
  assert.equal(saved.status, "available");
  assert.equal(store.getArtifactsForTask("task_a")[0].conversation_id, "conv_a");
  assert.deepEqual(
    store.getArtifactsForConversation("conv_a").map((artifact) => artifact.path),
    ["E:\\out\\a.docx"]
  );
});

runForBoth("getArtifactsForConversation is scoped and newest first", (store) => {
  store.insertTask(taskRecord("task_a1", "conv_a"));
  store.insertTask(taskRecord("task_a2", "conv_a"));
  store.insertTask(taskRecord("task_b1", "conv_b"));
  store.appendArtifact({
    artifact_id: "artifact_old",
    task_id: "task_a1",
    path: "E:\\out\\old.docx",
    created_at: "2026-05-01T10:01:00.000Z"
  });
  store.appendArtifact({
    artifact_id: "artifact_new",
    task_id: "task_a2",
    path: "E:\\out\\new.docx",
    created_at: "2026-05-01T10:02:00.000Z"
  });
  store.appendArtifact({
    artifact_id: "artifact_other",
    task_id: "task_b1",
    path: "E:\\out\\other.docx",
    created_at: "2026-05-01T10:03:00.000Z"
  });
  assert.deepEqual(
    store.getArtifactsForConversation("conv_a", { limit: 10 }).map((artifact) => artifact.path),
    ["E:\\out\\new.docx", "E:\\out\\old.docx"]
  );
  assert.deepEqual(
    store.getArtifactsForConversation("conv_a", { limit: 1 }).map((artifact) => artifact.path),
    ["E:\\out\\new.docx"]
  );
});

runForBoth("soft-deleting a task keeps conversation artifact index rows", (store) => {
  store.insertTask(taskRecord("task_soft", "conv_soft"));
  store.appendArtifact({
    artifact_id: "artifact_soft",
    task_id: "task_soft",
    path: "E:\\out\\soft.pdf",
    created_at: "2026-05-01T10:04:00.000Z"
  });
  store.softDeleteTask("task_soft", { deletedBy: "test" });
  assert.deepEqual(
    store.getArtifactsForConversation("conv_soft").map((artifact) => artifact.path),
    ["E:\\out\\soft.pdf"]
  );
});

runForBoth("appendArtifact preserves supplied stable artifact metadata", (store) => {
  store.insertTask(taskRecord("task_meta", "conv_meta"));
  const saved = store.appendArtifact({
    artifact_id: "artifact_meta",
    task_id: "task_meta",
    path: "E:\\out\\meta.json",
    mime_type: "application/json",
    kind: "data",
    source: "imported",
    bytes: 42.9,
    sha256: "a".repeat(64),
    status: "available",
    parent_artifact_id: "artifact_root",
    revision_of: "artifact_previous",
    version_label: "v2",
    created_at: "2026-05-01T10:06:00.000Z"
  });
  assert.equal(saved.kind, "data");
  assert.equal(saved.source, "imported");
  assert.equal(saved.bytes, 42);
  assert.equal(saved.sha256, "a".repeat(64));
  assert.equal(saved.status, "available");
  assert.equal(saved.parent_artifact_id, "artifact_root");
  assert.equal(saved.revision_of, "artifact_previous");
  assert.equal(saved.version_label, "v2");
  assert.deepEqual(
    store.getArtifactsForConversation("conv_meta").map((artifact) => ({
      path: artifact.path,
      kind: artifact.kind,
      source: artifact.source,
      bytes: artifact.bytes,
      sha256: artifact.sha256,
      status: artifact.status,
      parent_artifact_id: artifact.parent_artifact_id,
      revision_of: artifact.revision_of,
      version_label: artifact.version_label
    })),
    [{
      path: "E:\\out\\meta.json",
      kind: "data",
      source: "imported",
      bytes: 42,
      sha256: "a".repeat(64),
      status: "available",
      parent_artifact_id: "artifact_root",
      revision_of: "artifact_previous",
      version_label: "v2"
    }]
  );
});

runForBoth("listProjectArtifacts aggregates SQL-scoped conversation artifacts without task scans", (store) => {
  store.insertConversation({ conversation_id: "conv_project_a", project_id: "project_a", title: "Project A1" });
  store.insertConversation({ conversation_id: "conv_project_b", project_id: "project_a", title: "Project A2" });
  store.insertConversation({ conversation_id: "conv_project_other", project_id: "project_b", title: "Other" });
  store.insertTask(taskRecord("task_project_a", "conv_project_a", "2026-05-01T10:08:00.000Z"));
  store.insertTask(taskRecord("task_project_b", "conv_project_b", "2026-05-01T10:09:00.000Z"));
  store.insertTask(taskRecord("task_project_other", "conv_project_other", "2026-05-01T10:10:00.000Z"));
  store.appendArtifact({
    artifact_id: "artifact_project_a",
    task_id: "task_project_a",
    path: "E:\\out\\project-a.docx",
    created_at: "2026-05-01T10:11:00.000Z"
  });
  store.appendArtifact({
    artifact_id: "artifact_project_b",
    task_id: "task_project_b",
    path: "E:\\out\\project-b.pdf",
    created_at: "2026-05-01T10:12:00.000Z"
  });
  store.appendArtifact({
    artifact_id: "artifact_project_other",
    task_id: "task_project_other",
    path: "E:\\out\\project-other.pdf",
    created_at: "2026-05-01T10:13:00.000Z"
  });
  assert.deepEqual(
    store.listProjectArtifacts({ projectId: "project_a", limit: 10 }).map((artifact) => ({
      path: artifact.path,
      project_id: artifact.project_id,
      conversation_title: artifact.conversation_title
    })),
    [
      { path: "E:\\out\\project-b.pdf", project_id: "project_a", conversation_title: "Project A2" },
      { path: "E:\\out\\project-a.docx", project_id: "project_a", conversation_title: "Project A1" }
    ]
  );
});

test("artifact store registerArtifact records file size, source, and status without hashing synchronously", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "artifact-metadata-"));
  try {
    const artifactPath = path.join(dir, "report.md");
    const body = "hello artifact metadata\n";
    writeFileSync(artifactPath, body);
    const artifactStore = createArtifactStore({ baseDir: dir });
    const saved = artifactStore.registerArtifact("task_file_meta", artifactPath, "text/markdown", {
      conversationId: "conv_file_meta",
      createdAt: "2026-05-01T10:07:00.000Z",
      revisionOf: "artifact_previous",
      parentArtifactId: "artifact_root",
      versionLabel: "v2"
    });
    assert.equal(saved.conversation_id, "conv_file_meta");
    assert.equal(saved.kind, "markdown");
    assert.equal(saved.source, "generated");
    assert.equal(saved.revision_of, "artifact_previous");
    assert.equal(saved.parent_artifact_id, "artifact_root");
    assert.equal(saved.version_label, "v2");
    assert.equal(saved.bytes, Buffer.byteLength(body));
    assert.equal(saved.sha256, null);
    assert.equal(saved.status, "available");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
