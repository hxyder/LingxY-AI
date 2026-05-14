import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { createProjectWorkspaceService } from "../../src/service/core/projects/project-workspace-service.mjs";
import { tryHandleNoteProjectConversationRoute } from "../../src/service/core/http-routes/note-project-conversation-routes.mjs";
import { createInMemoryStoreScaffold } from "../../src/service/core/store/memory-store.mjs";
import { createSqliteStore } from "../../src/service/core/store/sqlite-store.mjs";

const ACTOR_HEADER = "x-lingxy-desktop-actor";

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

function rawJsonRequest(body, headers = {}) {
  const request = Readable.from([JSON.stringify(body ?? {})]);
  request.headers = {
    "content-type": "application/json",
    ...headers
  };
  return request;
}

function captureResponse() {
  return {
    statusCode: null,
    headers: null,
    body: "",
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(chunk = "") {
      this.body += chunk;
    }
  };
}

function parsePayload(response) {
  return response.body ? JSON.parse(response.body) : null;
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
  store.insertConversation({
    conversation_id: "conv_docs_empty_legacy",
    project_id: "proj_docs",
    title: "Legacy placeholder",
    metadata: { imported_from_project_store: true }
  });

  const workspace = projects.getProjectWorkspace("proj_docs");
  assert.equal(workspace.project_id, "proj_docs");
  assert.equal(workspace.conversations.length, 2);
  assert.equal(workspace.conversations.some((conversation) =>
    conversation.conversation_id === "conv_docs_legacy"
  ), false);
  assert.equal(workspace.conversations.some((conversation) =>
    conversation.conversation_id === "conv_docs_empty_legacy"
  ), false);
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

test("project store sync preserves indexed project file metadata", () => {
  const fixture = sqliteFixture();
  try {
    const projects = createProjectWorkspaceService({ store: fixture.store });
    projects.upsertProject({
      id: "proj_sync",
      name: "Sync project",
      attachedFilePaths: []
    });
    projects.recordProjectFiles("proj_sync", ["E:\\work\\folder"], {
      status: "indexed",
      indexedAt: "2026-05-12T00:00:00.000Z",
      metadata: {
        source: "project_file_attach",
        kind: "folder",
        files_seen: 4
      }
    });

    projects.syncProjectStore({
      currentProjectId: "proj_sync",
      projects: [{
        id: "proj_sync",
        name: "Sync project",
        attachedFilePaths: ["E:\\work\\folder"]
      }],
      conversations: []
    });

    const workspace = projects.getProjectWorkspace("proj_sync");
    assert.equal(workspace.files.length, 1);
    assert.equal(workspace.files[0].status, "indexed");
    assert.equal(workspace.files[0].metadata.kind, "folder");
    assert.equal(workspace.files[0].metadata.source, "project_file_attach");
    assert.equal(workspace.files[0].metadata.files_seen, 4);
  } finally {
    fixture.cleanup();
  }
});

test("project metadata route updates project instructions without mutating conversations", async () => {
  const store = createInMemoryStoreScaffold();
  const projectWorkspaces = createProjectWorkspaceService({ store });
  projectWorkspaces.syncProjectStore({
    currentProjectId: "proj_write",
    projects: [{ id: "proj_write", name: "Write", attachedFilePaths: [] }],
    conversations: []
  });
  store.insertConversation({
    conversation_id: "conv_write",
    project_id: "proj_write",
    title: "Thread"
  });
  const response = captureResponse();
  const handled = await tryHandleNoteProjectConversationRoute({
    request: rawJsonRequest({
      instructions: "Prefer project terminology.",
      metadata: { owner: "design" }
    }, { [ACTOR_HEADER]: "desktop_console" }),
    response,
    method: "PATCH",
    url: new URL("http://127.0.0.1/projects/proj_write"),
    runtime: { store, projectWorkspaces },
    saveRuntimeConfig() {}
  });

  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  const payload = parsePayload(response);
  assert.equal(payload.project.metadata.instructions, "Prefer project terminology.");
  assert.equal(payload.project.metadata.owner, "design");
  assert.equal(store.getConversation("conv_write").project_id, "proj_write");
});
