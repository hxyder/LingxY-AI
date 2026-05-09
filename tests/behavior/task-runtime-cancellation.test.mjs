import assert from "node:assert/strict";
import test from "node:test";

import { createInMemoryStoreScaffold } from "../../src/service/core/store/memory-store.mjs";
import { cancelTask } from "../../src/service/core/task-runtime/task-cancellation.mjs";

function makeRuntime() {
  const finished = [];
  const published = [];
  return {
    store: createInMemoryStoreScaffold(),
    queue: {
      snapshot() { return { queued: 0, running: 0 }; },
      markFinished(taskId) { finished.push(taskId); }
    },
    eventBus: {
      publish(event) { published.push(event); }
    },
    logsDir: null,
    finished,
    published
  };
}

function insertRunningTask(runtime, patch = {}) {
  const task = {
    task_id: "task_cancel",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    status: "running",
    sub_status: "running",
    progress: 0.5,
    retryable: true,
    ...patch
  };
  runtime.store.insertTask(task);
  return task;
}

test("task cancellation returns null for a missing task", async () => {
  const runtime = makeRuntime();

  const result = await cancelTask({ runtime, taskId: "missing" });

  assert.equal(result, null);
  assert.ok(runtime.activeExecutions instanceof Map);
});

test("task cancellation leaves terminal tasks unchanged", async () => {
  const runtime = makeRuntime();
  const task = insertRunningTask(runtime, {
    status: "success",
    sub_status: "completed",
    progress: 1
  });

  const result = await cancelTask({ runtime, taskId: task.task_id });

  assert.equal(result, task);
  assert.equal(task.status, "success");
  assert.equal(runtime.store.getTaskEvents(task.task_id).length, 0);
  assert.deepEqual(runtime.finished, []);
});

test("task cancellation asks active execution to cancel before forcing terminal state", async () => {
  const runtime = makeRuntime();
  const task = insertRunningTask(runtime);
  let cancelCalls = 0;
  runtime.activeExecutions = new Map([
    [task.task_id, { async cancel() { cancelCalls += 1; } }]
  ]);

  const result = await cancelTask({ runtime, taskId: task.task_id });

  assert.equal(result, task);
  assert.equal(cancelCalls, 1);
  assert.equal(task.status, "cancelling");
  assert.equal(task.sub_status, "cancelling");
  assert.deepEqual(runtime.finished, []);
  assert.deepEqual(
    runtime.store.getTaskEvents(task.task_id).map((event) => event.event_type),
    ["status_changed", "cancel_requested"]
  );
});

test("task cancellation force path marks task cancelled and finishes queue", async () => {
  const runtime = makeRuntime();
  const task = insertRunningTask(runtime);
  runtime.activeExecutions = new Map([
    [task.task_id, { async cancel() { throw new Error("should not be called"); } }]
  ]);

  const result = await cancelTask({ runtime, taskId: task.task_id, force: true });

  assert.equal(result, task);
  assert.equal(task.status, "cancelled");
  assert.equal(task.sub_status, "user_interrupted");
  assert.equal(task.failure_category, "user_interrupted");
  assert.match(task.failure_user_message, /强制/);
  assert.deepEqual(runtime.finished, [task.task_id]);
  const events = runtime.store.getTaskEvents(task.task_id);
  assert.deepEqual(
    events
      .filter((event) => event.event_type !== "runtime_graph_checkpoint")
      .map((event) => event.event_type),
    ["status_changed", "cancel_requested", "status_changed", "cancelled"]
  );
  assert.ok(events.some((event) => (
    event.event_type === "runtime_graph_checkpoint"
    && event.payload?.node === "act"
    && event.payload?.status === "interrupted"
  )));
});

test("task cancellation second request force-finishes an already cancelling task", async () => {
  const runtime = makeRuntime();
  const task = insertRunningTask(runtime, {
    status: "cancelling",
    sub_status: "cancelling"
  });

  await cancelTask({ runtime, taskId: task.task_id });

  assert.equal(task.status, "cancelled");
  assert.equal(task.sub_status, "user_interrupted");
  assert.deepEqual(runtime.finished, [task.task_id]);
  const events = runtime.store.getTaskEvents(task.task_id);
  assert.deepEqual(
    events
      .filter((event) => event.event_type !== "runtime_graph_checkpoint")
      .map((event) => event.event_type),
    ["status_changed", "cancelled"]
  );
  assert.ok(events.some((event) => (
    event.event_type === "runtime_graph_checkpoint"
    && event.payload?.node === "act"
    && event.payload?.status === "interrupted"
  )));
});
