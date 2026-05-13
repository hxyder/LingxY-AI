import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createProjectWorkspaceService } from "../../src/service/core/projects/project-workspace-service.mjs";
import { createInMemoryStoreScaffold } from "../../src/service/core/store/memory-store.mjs";
import { createSqliteStore } from "../../src/service/core/store/sqlite-store.mjs";

function sqliteFixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lingxy-project-workspace-"));
  const store = createSqliteStore({ dbPath: path.join(dir, "store.sqlite") });
  return {
    store,
    cleanup() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

test("project workspace service separates projects, conversations, and files", () => {
  const store = createInMemoryStoreScaffold();
  const projects = createProjectWorkspaceService({ store });
  projects.syncProjectStore({
    currentProjectId: "proj_docs",
    projects: [{
      id: "proj_docs",
      name: "Docs",
      color: "#1f766e",
      attachedFilePaths: ["E:\\work\\brief.md", "E:\\work\\source.pdf"]
    }],
    conversations: [{
      id: "conv_docs_legacy",
      projectId: "proj_docs",
      title: "Legacy local thread"
    }]
  });
  store.insertConversation({
    conversation_id: "conv_docs_1",
    project_id: "proj_docs",
    title: "Draft brief"
  });
  store.insertConversation({
    conversation_id: "conv_docs_2",
    project_id: "proj_docs",
    title: "Revise brief"
  });

  const workspace = projects.getProjectWorkspace("proj_docs");
  assert.equal(workspace.project_id, "proj_docs");
  assert.equal(workspace.conversations.length, 3);
  assert.ok(workspace.conversations.some((conversation) =>
    conversation.conversation_id === "conv_docs_legacy"
    && conversation.metadata.imported_from_project_store === true
  ));
  assert.deepEqual(workspace.files.map((file) => file.path).sort(), [
    "E:\\work\\brief.md",
    "E:\\work\\source.pdf"
  ]);
  assert.equal(workspace.stats.file_count, 2);
});

test("project workspace store methods round-trip through sqlite", () => {
  const fixture = sqliteFixture();
  try {
    const projects = createProjectWorkspaceService({ store: fixture.store });
    projects.upsertProject({
      id: "proj_sql",
      name: "SQL project",
      attachedFilePaths: []
    });
    projects.recordProjectFiles("proj_sql", ["E:\\work\\one.md"], {
      status: "indexed",
      indexedAt: "2026-05-12T00:00:00.000Z"
    });
    fixture.store.insertConversation({
      conversation_id: "conv_sql_project",
      project_id: "proj_sql",
      title: "SQL conversation"
    });

    const workspace = projects.getProjectWorkspace("proj_sql");
    assert.equal(workspace.project.name, "SQL project");
    assert.equal(workspace.files[0].status, "indexed");
    assert.equal(workspace.conversations[0].conversation_id, "conv_sql_project");
  } finally {
    fixture.cleanup();
  }
});
