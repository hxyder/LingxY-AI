import assert from "node:assert/strict";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { tryHandleNoteProjectConversationRoute } from "../../src/service/core/http-routes/note-project-conversation-routes.mjs";
import { createEmbeddingStore, EMBEDDING_NAMESPACES } from "../../src/service/embeddings/store.mjs";
import { buildDefaultProjectStore, buildProject } from "../../src/shared/project-store.mjs";

const ACTOR_HEADER = "x-lingxy-desktop-actor";

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

function createConfigStore(initialConfig) {
  let current = initialConfig;
  return {
    load() {
      return current;
    },
    save(next) {
      current = next;
    }
  };
}

function createRuntime({ withAudit = true } = {}) {
  const projectFilePath = path.join("E:\\docs", "resume.md");
  const otherFilePath = path.join("E:\\docs", "other.md");
  const auditLog = [];
  const store = {
    appendAuditLog(entry) {
      auditLog.push(entry);
      return entry;
    }
  };
  const runtime = {
    platform: { embeddingStore: createEmbeddingStore() },
    configStore: createConfigStore({
      ui: {
        projectStore: {
          ...buildDefaultProjectStore({ withUpdatedAt: false }),
          projects: [buildProject({
            id: "proj_a",
            name: "A",
            attachedFilePaths: [projectFilePath, otherFilePath]
          })]
        }
      }
    }),
    ...(withAudit ? { store } : {})
  };
  runtime.platform.embeddingStore.add({
    id: "file_content_project_target",
    namespace: EMBEDDING_NAMESPACES.FILE_CONTENT,
    text: "Target indexed project file content.",
    metadata: {
      namespace: EMBEDDING_NAMESPACES.FILE_CONTENT,
      project_id: "proj_a",
      path: projectFilePath
    }
  });
  runtime.platform.embeddingStore.add({
    id: "file_content_project_other",
    namespace: EMBEDDING_NAMESPACES.FILE_CONTENT,
    text: "Other indexed project file content.",
    metadata: {
      namespace: EMBEDDING_NAMESPACES.FILE_CONTENT,
      project_id: "proj_a",
      path: otherFilePath
    }
  });
  runtime.platform.embeddingStore.add({
    id: "file_content_other_project_same_path",
    namespace: EMBEDDING_NAMESPACES.FILE_CONTENT,
    text: "Same path but another project.",
    metadata: {
      namespace: EMBEDDING_NAMESPACES.FILE_CONTENT,
      project_id: "proj_b",
      path: projectFilePath
    }
  });
  return { runtime, auditLog, projectFilePath, otherFilePath };
}

async function removeIndexRoute({ body, actor, runtime }) {
  const response = captureResponse();
  const handled = await tryHandleNoteProjectConversationRoute({
    request: rawJsonRequest(body, actor ? { [ACTOR_HEADER]: actor } : {}),
    response,
    method: "POST",
    url: new URL("http://127.0.0.1/projects/proj_a/files/remove-index"),
    runtime,
    saveRuntimeConfig(runtimeArg, updater) {
      const currentConfig = runtimeArg.configStore.load();
      const nextConfig = updater(currentConfig);
      runtimeArg.configStore.save(nextConfig);
      return nextConfig;
    }
  });
  return {
    handled,
    statusCode: response.statusCode,
    payload: parsePayload(response)
  };
}

test("project file index removal requires the desktop console actor", async () => {
  const { runtime, projectFilePath } = createRuntime();

  const result = await removeIndexRoute({
    body: { paths: [projectFilePath] },
    runtime
  });

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 403);
  assert.equal(result.payload.error, "desktop_actor_required");
  assert.equal(runtime.platform.embeddingStore.list({ namespace: EMBEDDING_NAMESPACES.FILE_CONTENT }).length, 3);
});

test("project file index removal requires audit logging", async () => {
  const { runtime, projectFilePath } = createRuntime({ withAudit: false });

  const result = await removeIndexRoute({
    body: { paths: [projectFilePath] },
    actor: "desktop_console",
    runtime
  });

  assert.equal(result.statusCode, 503);
  assert.equal(result.payload.error, "audit_log_unavailable");
  assert.equal(runtime.platform.embeddingStore.list({ namespace: EMBEDDING_NAMESPACES.FILE_CONTENT }).length, 3);
});

test("project file index removal purges only matching project/path records and keeps attachment by default", async () => {
  const { runtime, auditLog, projectFilePath } = createRuntime();

  const result = await removeIndexRoute({
    body: { paths: [projectFilePath] },
    actor: "desktop_console",
    runtime
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.removed_count, 1);
  assert.deepEqual(result.payload.removed_ids, ["file_content_project_target"]);
  assert.equal(result.payload.detached, false);
  assert.equal(auditLog.length, 1);
  assert.equal(auditLog[0].event_subtype, "project_file_index.deleted");
  assert.equal(auditLog[0].payload.project_id, "proj_a");

  const remaining = runtime.platform.embeddingStore.list({ namespace: EMBEDDING_NAMESPACES.FILE_CONTENT });
  assert.deepEqual(new Set(remaining.map((record) => record.id)), new Set([
    "file_content_project_other",
    "file_content_other_project_same_path"
  ]));
  const project = result.payload.store.projects.find((item) => item.id === "proj_a");
  assert.equal(project.attachedFilePaths.includes(projectFilePath), true);
});

test("project file index removal can detach while removing index records", async () => {
  const { runtime, projectFilePath, otherFilePath } = createRuntime();

  const result = await removeIndexRoute({
    body: { paths: [projectFilePath], detach: true },
    actor: "desktop_console",
    runtime
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.removed_count, 1);
  assert.equal(result.payload.detached, true);
  const project = result.payload.store.projects.find((item) => item.id === "proj_a");
  assert.equal(project.attachedFilePaths.includes(projectFilePath), false);
  assert.equal(project.attachedFilePaths.includes(otherFilePath), true);
});

test("project file index removal is idempotent for missing paths", async () => {
  const { runtime } = createRuntime();
  const missingPath = path.join("E:\\docs", "missing.md");

  const result = await removeIndexRoute({
    body: { paths: [missingPath] },
    actor: "desktop_console",
    runtime
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.removed_count, 0);
  assert.deepEqual(result.payload.missing_paths, [missingPath]);
  assert.equal(runtime.platform.embeddingStore.list({ namespace: EMBEDDING_NAMESPACES.FILE_CONTENT }).length, 3);
});
