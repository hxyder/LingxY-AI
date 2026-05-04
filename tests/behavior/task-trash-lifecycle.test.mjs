import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import {
  isDeletedRecord,
  markRecordDeleted,
  restoreDeletedRecord
} from "../../src/service/core/deletion-lifecycle.mjs";
import { tryHandleTaskRoute } from "../../src/service/core/http-routes/task-routes.mjs";
import { createInMemoryStoreScaffold } from "../../src/service/core/store/memory-store.mjs";

const ACTOR_HEADER = "x-lingxy-desktop-actor";

function jsonRequest(body = {}, headers = {}) {
  const request = Readable.from([Buffer.from(JSON.stringify(body), "utf8")]);
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

async function taskRoute({ method, pathname, actor = "desktop_console", runtime }) {
  const response = captureResponse();
  const handled = await tryHandleTaskRoute({
    request: jsonRequest({}, actor ? { [ACTOR_HEADER]: actor } : {}),
    response,
    method,
    url: new URL(`http://127.0.0.1${pathname}`),
    runtime
  });
  return {
    handled,
    statusCode: response.statusCode,
    payload: parsePayload(response),
    runtime
  };
}

function createTaskFixture() {
  const store = createInMemoryStoreScaffold();
  const task = {
    task_id: "task_trash",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    status: "success",
    sub_status: "success",
    progress: 1,
    intent: "demo",
    executor: "fast",
    user_command: "Keep me recoverable",
    execution_mode: "interactive",
    context_packet: {
      source_type: "clipboard",
      source_app: "test",
      capture_mode: "manual",
      text: "demo",
      selection_metadata: {}
    }
  };
  store.insertTask(task);
  store.appendEvent({
    event_id: "evt_trash",
    task_id: task.task_id,
    ts: "2026-01-01T00:00:01.000Z",
    event_type: "success",
    payload: { ok: true }
  });
  store.appendArtifact({
    artifact_id: "artifact_trash",
    task_id: task.task_id,
    path: "E:/linxiDoc/result.md",
    mime_type: "text/markdown",
    created_at: "2026-01-01T00:00:02.000Z"
  });
  return { store, task };
}

test("deletion lifecycle marks and restores records without domain-specific fields", () => {
  const record = { id: "demo", updated_at: "2026-01-01T00:00:00.000Z" };
  const deleted = markRecordDeleted(record, {
    actor: "desktop_console",
    now: "2026-01-02T00:00:00.000Z",
    restoreWindowDays: 7
  });

  assert.equal(isDeletedRecord(deleted), true);
  assert.equal(deleted.deleted_at, "2026-01-02T00:00:00.000Z");
  assert.equal(deleted.deleted_by, "desktop_console");
  assert.equal(deleted.restore_until, "2026-01-09T00:00:00.000Z");
  assert.equal(record.deleted_at, undefined);

  const restored = restoreDeletedRecord(deleted, {
    actor: "desktop_console",
    now: "2026-01-03T00:00:00.000Z"
  });
  assert.equal(isDeletedRecord(restored), false);
  assert.equal(restored.deleted_at, undefined);
  assert.equal(restored.restored_at, "2026-01-03T00:00:00.000Z");
});

test("task store soft delete hides tasks by default while preserving events and artifacts", () => {
  const { store, task } = createTaskFixture();

  const deleted = store.softDeleteTask(task.task_id, {
    actor: "desktop_console",
    now: "2026-01-02T00:00:00.000Z"
  });

  assert.equal(deleted.task_id, task.task_id);
  assert.equal(deleted.deleted_at, "2026-01-02T00:00:00.000Z");
  assert.equal(store.listTasks().length, 0);
  assert.equal(store.listTasks({ deleted: "only" }).length, 1);
  assert.equal(store.getTaskEvents(task.task_id).length, 1);
  assert.equal(store.getArtifactsForTask(task.task_id).length, 1);

  const restored = store.restoreTask(task.task_id, {
    actor: "desktop_console",
    now: "2026-01-03T00:00:00.000Z"
  });
  assert.equal(restored.task_id, task.task_id);
  assert.equal(restored.deleted_at, undefined);
  assert.equal(store.listTasks().length, 1);
  assert.equal(store.listTasks({ deleted: "only" }).length, 0);
});

test("task delete route is soft-delete by default and restore route reactivates the task", async () => {
  const { store, task } = createTaskFixture();
  const runtime = { store };

  const deleted = await taskRoute({
    method: "DELETE",
    pathname: `/task/${task.task_id}`,
    runtime
  });
  assert.equal(deleted.handled, true);
  assert.equal(deleted.statusCode, 200);
  assert.equal(deleted.payload.deleted, true);
  assert.equal(deleted.payload.soft, true);
  assert.equal(deleted.payload.task.task_id, task.task_id);
  assert.equal(deleted.payload.task.deleted_by, "desktop_console");
  assert.equal(store.getTaskEvents(task.task_id).length, 1);

  const hidden = await taskRoute({
    method: "GET",
    pathname: "/tasks",
    runtime
  });
  assert.equal(hidden.payload.tasks.length, 0);

  const trash = await taskRoute({
    method: "GET",
    pathname: "/tasks?deleted=only",
    runtime
  });
  assert.equal(trash.payload.tasks.length, 1);
  assert.equal(trash.payload.tasks[0].task_id, task.task_id);

  const restored = await taskRoute({
    method: "POST",
    pathname: `/task/${task.task_id}/restore`,
    runtime
  });
  assert.equal(restored.statusCode, 200);
  assert.equal(restored.payload.restored, true);
  assert.equal(restored.payload.task.deleted_at, undefined);
  assert.equal(store.listTasks().length, 1);
});
