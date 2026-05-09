import test from "node:test";
import assert from "node:assert/strict";

import { createRuntimeGraphScheduler } from "../../src/service/core/graph/runtime-graph-scheduler.mjs";
import { createInMemoryStoreScaffold } from "../../src/service/core/store/memory-store.mjs";
import { ensureRuntimeServices } from "../../src/service/core/task-runtime/runtime-services.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test("runtime graph scheduler serializes nodes within a session", async () => {
  const scheduler = createRuntimeGraphScheduler({
    budget: { maxConcurrent: 2, maxPerSession: 1, nodeTimeoutMs: 1000 }
  });
  const releaseFirst = deferred();
  const started = [];

  const first = scheduler.scheduleNode({
    node: "act",
    taskId: "task_a",
    sessionId: "session_a",
    run: async () => {
      started.push("first");
      await releaseFirst.promise;
      return "first-done";
    }
  });
  const second = scheduler.scheduleNode({
    node: "validate",
    taskId: "task_a",
    sessionId: "session_a",
    run: async () => {
      started.push("second");
      return "second-done";
    }
  });

  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(started, ["first"]);
  assert.equal(scheduler.snapshot().queued, 1);
  releaseFirst.resolve();
  assert.equal((await first).status, "completed");
  assert.equal((await second).status, "completed");
  assert.deepEqual(started, ["first", "second"]);
});

test("runtime graph scheduler allows bounded parallel work across sessions", async () => {
  const scheduler = createRuntimeGraphScheduler({
    budget: { maxConcurrent: 2, maxPerSession: 1, nodeTimeoutMs: 1000 }
  });
  const release = deferred();
  const started = [];

  const first = scheduler.scheduleNode({
    node: "act",
    sessionId: "session_a",
    run: async () => {
      started.push("a");
      await release.promise;
      return "a";
    }
  });
  const second = scheduler.scheduleNode({
    node: "act",
    sessionId: "session_b",
    run: async () => {
      started.push("b");
      await release.promise;
      return "b";
    }
  });

  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(started.sort(), ["a", "b"]);
  assert.equal(scheduler.snapshot().running, 2);
  release.resolve();
  assert.equal((await first).ok, true);
  assert.equal((await second).ok, true);
});

test("runtime graph scheduler applies timeout and queue bounds", async () => {
  const scheduler = createRuntimeGraphScheduler({
    budget: { maxConcurrent: 1, maxPerSession: 1, maxQueued: 1, nodeTimeoutMs: 5 }
  });
  const release = deferred();
  const first = scheduler.scheduleNode({
    node: "act",
    sessionId: "session_a",
    timeoutMs: 100,
    run: async () => {
      await release.promise;
      return "late";
    }
  });
  const second = scheduler.scheduleNode({
    node: "validate",
    sessionId: "session_a",
    run: async ({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")), { once: true });
    })
  });
  const rejected = await scheduler.scheduleNode({
    node: "synthesize",
    sessionId: "session_a",
    run: async () => "never"
  });

  assert.equal(rejected.status, "rejected");
  release.resolve();
  assert.equal((await first).status, "completed");
  const timeout = await second;
  assert.equal(timeout.ok, false);
  assert.equal(timeout.status, "cancelled");
  assert.match(timeout.error, /timeout/);
});

test("runtime graph scheduler propagates caller cancellation", async () => {
  const scheduler = createRuntimeGraphScheduler({
    budget: { maxConcurrent: 1, maxPerSession: 1, nodeTimeoutMs: 1000 }
  });
  const controller = new AbortController();
  const resultPromise = scheduler.scheduleNode({
    node: "act",
    sessionId: "session_cancel",
    signal: controller.signal,
    run: async ({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")), { once: true });
    })
  });

  controller.abort(new Error("user cancelled"));
  const result = await resultPromise;
  assert.equal(result.ok, false);
  assert.equal(result.status, "cancelled");
  assert.match(result.error, /cancelled/);
});

test("runtime services attach runtimeGraphScheduler", () => {
  const runtime = {
    store: createInMemoryStoreScaffold(),
    queue: { snapshot() { return { queued: 0, running: 0 }; } },
    eventBus: { publish() {} }
  };

  ensureRuntimeServices(runtime);

  assert.equal(typeof runtime.runtimeGraphScheduler.scheduleNode, "function");
  assert.equal(runtime.runtimeGraphScheduler.snapshot().budget.maxPerSession, 1);
});
