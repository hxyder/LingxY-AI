import assert from "node:assert/strict";
import test from "node:test";

import { refreshCompositeParentStatus } from "../../src/service/core/task-runtime.mjs";
import { aggregateCompositeStatus } from "../../src/service/core/task-runtime/composite-status.mjs";

function createRuntimeWithTasks(tasks) {
  const byId = new Map(tasks.map((task) => [task.task_id, { ...task }]));
  const updates = [];
  const appendedEvents = [];
  const publishedEvents = [];

  return {
    updates,
    appendedEvents,
    publishedEvents,
    runtime: {
      paths: {},
      store: {
        getTask(taskId) {
          return byId.get(taskId) ?? null;
        },
        listTasks() {
          return [...byId.values()];
        },
        updateTask(taskId, task) {
          const next = { ...task };
          byId.set(taskId, next);
          updates.push({ taskId, task: next });
        },
        appendEvent(event) {
          appendedEvents.push(event);
        }
      },
      eventBus: {
        publish(event) {
          publishedEvents.push(event);
        }
      }
    }
  };
}

test("pure composite aggregation waits when a parent has no children yet", () => {
  assert.deepEqual(aggregateCompositeStatus([]), {
    status: "running",
    sub_status: "composite_waiting",
    progress: 0
  });
});

test("composite parent succeeds only when all children succeed", () => {
  const { runtime, updates, appendedEvents } = createRuntimeWithTasks([
    { task_id: "parent", status: "running", child_task_ids: ["a", "b"] },
    { task_id: "a", status: "success", parent_task_id: "parent", child_index: 0 },
    { task_id: "b", status: "success", parent_task_id: "parent", child_index: 1 }
  ]);

  const result = refreshCompositeParentStatus(runtime, "parent");

  assert.equal(result.aggregate.status, "success");
  assert.equal(result.aggregate.sub_status, "completed");
  assert.equal(result.aggregate.progress, 1);
  assert.equal(result.aggregate.failure_count, 0);
  assert.equal(updates.at(-1).task.status, "success");
  assert.equal(appendedEvents.at(-1).event_type, "status_changed");
  assert.equal(appendedEvents.at(-1).payload.status, "success");
});

test("composite parent becomes partial_success when any child is cancelled", () => {
  const { runtime, updates, appendedEvents } = createRuntimeWithTasks([
    { task_id: "parent", status: "running", child_task_ids: ["a", "b", "c"] },
    { task_id: "a", status: "success", parent_task_id: "parent", child_index: 0 },
    { task_id: "b", status: "cancelled", parent_task_id: "parent", child_index: 1 },
    { task_id: "c", status: "success", parent_task_id: "parent", child_index: 2 }
  ]);

  const result = refreshCompositeParentStatus(runtime, "parent");

  assert.equal(result.aggregate.status, "partial_success");
  assert.equal(result.aggregate.sub_status, "completed_with_warnings");
  assert.equal(result.aggregate.progress, 2 / 3);
  assert.equal(result.aggregate.failure_count, 1);
  assert.equal(updates.at(-1).task.status, "partial_success");
  assert.equal(updates.at(-1).task.failure_count, 1);
  assert.equal(appendedEvents.at(-1).payload.status, "partial_success");
});

test("composite parent remains running while any child is still active", () => {
  const { runtime, updates, appendedEvents } = createRuntimeWithTasks([
    { task_id: "parent", status: "queued", child_task_ids: ["a", "b", "c"] },
    { task_id: "a", status: "success", parent_task_id: "parent", child_index: 0 },
    { task_id: "b", status: "running", parent_task_id: "parent", child_index: 1 },
    { task_id: "c", status: "queued", parent_task_id: "parent", child_index: 2 }
  ]);

  const result = refreshCompositeParentStatus(runtime, "parent");

  assert.equal(result.aggregate.status, "running");
  assert.equal(result.aggregate.sub_status, "composite_running");
  assert.equal(result.aggregate.progress, 1 / 3);
  assert.equal(result.aggregate.failure_count, 0);
  assert.equal(updates.at(-1).task.status, "running");
  assert.equal(appendedEvents.at(-1).payload.previous_status, "queued");
  assert.equal(appendedEvents.at(-1).payload.status, "running");
});
