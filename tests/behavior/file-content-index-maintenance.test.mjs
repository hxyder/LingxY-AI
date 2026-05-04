import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { tryHandleRuntimeAdminRoute } from "../../src/service/core/http-routes/runtime-admin-routes.mjs";
import {
  createEmbeddingStore,
  EMBEDDING_NAMESPACES
} from "../../src/service/embeddings/store.mjs";

const ACTOR_HEADER = "x-lingxy-desktop-actor";

function rawRequest(headers = {}) {
  const request = Readable.from([]);
  request.headers = headers;
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

async function withEmbeddingRuntime(fn) {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "lingxy-file-content-maintenance-"));
  const auditLog = [];
  const runtime = {
    platform: {
      embeddingStore: createEmbeddingStore({ filePath: path.join(tmpRoot, "embeddings.json") })
    },
    store: {
      appendAuditLog(entry) {
        assert.match(entry.audit_id, /^audit_/);
        assert.equal(typeof entry.ts, "string");
        assert.equal(entry.task_id, null);
        assert.equal(entry.event_subtype, "file_content_index.deleted");
        auditLog.push(entry);
      }
    }
  };
  try {
    return await fn({ runtime, auditLog });
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
}

async function runtimeAdminRoute({ method, pathname, actor, runtime }) {
  const response = captureResponse();
  const handled = await tryHandleRuntimeAdminRoute({
    request: rawRequest(actor ? { [ACTOR_HEADER]: actor } : {}),
    response,
    method,
    url: new URL(`http://127.0.0.1${pathname}`),
    runtime,
    paths: {}
  });
  return {
    handled,
    statusCode: response.statusCode,
    payload: parsePayload(response)
  };
}

function seedRecords(store) {
  store.add({
    id: "task_memory_1",
    text: "General task memory should not appear in file index maintenance.",
    metadata: { title: "Task memory" }
  });
  store.add({
    id: "file_content_1",
    namespace: EMBEDDING_NAMESPACES.FILE_CONTENT,
    text: "File content index maintenance record with a deliberately visible preview.",
    metadata: {
      path: "E:\\docs\\strategy.md",
      coverage_scope: "folder_recursive_text",
      artifact_id: "artifact_1",
      truncated: false
    }
  });
}

test("file content index maintenance requires the desktop console actor", async () => {
  await withEmbeddingRuntime(async ({ runtime }) => {
    seedRecords(runtime.platform.embeddingStore);

    const listResult = await runtimeAdminRoute({
      method: "GET",
      pathname: "/history/file-content",
      runtime
    });
    assert.equal(listResult.handled, true);
    assert.equal(listResult.statusCode, 403);
    assert.equal(listResult.payload.error, "desktop_actor_required");

    const deleteResult = await runtimeAdminRoute({
      method: "DELETE",
      pathname: "/history/file-content/file_content_1",
      runtime
    });
    assert.equal(deleteResult.handled, true);
    assert.equal(deleteResult.statusCode, 403);
    assert.equal(deleteResult.payload.error, "desktop_actor_required");
    assert.equal(runtime.platform.embeddingStore.list({ namespace: EMBEDDING_NAMESPACES.FILE_CONTENT }).length, 1);

    const overlayDelete = await runtimeAdminRoute({
      method: "DELETE",
      pathname: "/history/file-content/file_content_1",
      actor: "desktop_overlay",
      runtime
    });
    assert.equal(overlayDelete.statusCode, 403);
    assert.equal(runtime.platform.embeddingStore.list({ namespace: EMBEDDING_NAMESPACES.FILE_CONTENT }).length, 1);
  });
});

test("file content index maintenance lists only indexed file records", async () => {
  await withEmbeddingRuntime(async ({ runtime }) => {
    seedRecords(runtime.platform.embeddingStore);

    const result = await runtimeAdminRoute({
      method: "GET",
      pathname: "/history/file-content?limit=10",
      actor: "desktop_console",
      runtime
    });

    assert.equal(result.handled, true);
    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.namespace, EMBEDDING_NAMESPACES.FILE_CONTENT);
    assert.deepEqual(result.payload.records.map((record) => record.id), ["file_content_1"]);
    assert.equal(result.payload.records[0].namespace, EMBEDDING_NAMESPACES.FILE_CONTENT);
    assert.equal(result.payload.records[0].metadata.path, "E:\\docs\\strategy.md");
    assert.match(result.payload.records[0].text_preview, /File content index maintenance/);
  });
});

test("file content index deletion is namespace-scoped and audited", async () => {
  await withEmbeddingRuntime(async ({ runtime, auditLog }) => {
    seedRecords(runtime.platform.embeddingStore);

    const miss = await runtimeAdminRoute({
      method: "DELETE",
      pathname: "/history/file-content/task_memory_1",
      actor: "desktop_console",
      runtime
    });
    assert.equal(miss.statusCode, 404);
    assert.equal(miss.payload.ok, false);
    assert.equal(runtime.platform.embeddingStore.list({ namespace: EMBEDDING_NAMESPACES.TASK_MEMORY }).length, 1);

    const deleted = await runtimeAdminRoute({
      method: "DELETE",
      pathname: "/history/file-content/file_content_1",
      actor: "desktop_console",
      runtime
    });
    assert.equal(deleted.statusCode, 200);
    assert.equal(deleted.payload.ok, true);
    assert.equal(deleted.payload.deleted, "file_content_1");
    assert.equal(deleted.payload.record.metadata.path, "E:\\docs\\strategy.md");
    assert.equal(runtime.platform.embeddingStore.list({ namespace: EMBEDDING_NAMESPACES.FILE_CONTENT }).length, 0);
    assert.equal(runtime.platform.embeddingStore.list({ namespace: EMBEDDING_NAMESPACES.TASK_MEMORY }).length, 1);
    assert.equal(auditLog.length, 1);
    assert.equal(auditLog[0].event_subtype, "file_content_index.deleted");
    assert.equal(auditLog[0].payload.id, "file_content_1");
    assert.equal(auditLog[0].payload.actor, "desktop_console");
  });
});

test("file content index deletion refuses to delete when audit logging is unavailable", async () => {
  await withEmbeddingRuntime(async ({ runtime }) => {
    seedRecords(runtime.platform.embeddingStore);
    delete runtime.store;

    const result = await runtimeAdminRoute({
      method: "DELETE",
      pathname: "/history/file-content/file_content_1",
      actor: "desktop_console",
      runtime
    });

    assert.equal(result.statusCode, 503);
    assert.equal(result.payload.ok, false);
    assert.equal(result.payload.error, "audit_log_unavailable");
    assert.equal(runtime.platform.embeddingStore.list({ namespace: EMBEDDING_NAMESPACES.FILE_CONTENT }).length, 1);
  });
});
