import assert from "node:assert/strict";
import test from "node:test";

import { createEventBusScaffold } from "../../src/service/core/events/event-bus.mjs";
import { createTaskQueueScaffold } from "../../src/service/core/queue/task-queue.mjs";
import { createInMemoryStoreScaffold } from "../../src/service/core/store/memory-store.mjs";
import { submitTaskWithConversation } from "../../src/service/core/task-runtime.mjs";
import {
  applyExecutorEvent,
  markTaskFailed,
  markTaskSucceeded,
  refreshCompositeParentStatus,
  registerActiveExecution,
  unregisterActiveExecution,
  updateTask
} from "../../src/service/core/task-runtime/task-lifecycle.mjs";

function makeRuntime() {
  const embeddingAdds = [];
  const clearedRedactions = [];
  const store = createInMemoryStoreScaffold();
  const queue = createTaskQueueScaffold();
  return {
    embeddingAdds,
    clearedRedactions,
    runtime: {
      store,
      queue,
      eventBus: createEventBusScaffold(),
      activeExecutions: new Map(),
      metrics: { increment() {}, observe() {} },
      paths: {},
      platform: { embeddingStore: { add(record) { embeddingAdds.push(record); } } },
      securityBroker: { clearTaskRedactionMap(taskId) { clearedRedactions.push(taskId); } }
    }
  };
}

const baseRoute = {
  intent: "general",
  goal: "qa",
  executor: "fast",
  suggested_executor: "fast",
  intent_tags: [],
  suggested_formats: [],
  requires_confirmation: false
};

test("task lifecycle success finalizer writes assistant outcome, history, queue finish, and redaction cleanup", () => {
  const { runtime, embeddingAdds, clearedRedactions } = makeRuntime();
  const { task } = submitTaskWithConversation({
    route: baseRoute,
    contextPacket: { source_type: "clipboard", source_app: "uca.overlay", text: "source text" },
    userCommand: "生成摘要",
    executionMode: "interactive",
    conversationId: "conv_success",
    runtime
  });
  runtime.store.appendEvent({
    event_id: "evt_inline",
    task_id: task.task_id,
    event_type: "inline_result",
    payload: { text: "最终回答" }
  });
  runtime.store.appendEvent({
    event_id: "evt_artifact",
    task_id: task.task_id,
    event_type: "artifact_created",
    payload: { path: "E:\\out\\result.docx" }
  });
  task.status = "success";
  task.result_summary = "最终回答";
  runtime.store.updateTask(task.task_id, task);
  runtime.queue.markRunning(task.task_id);

  markTaskSucceeded(runtime, task);

  const messages = runtime.store.getConversationMessages("conv_success");
  assert.equal(messages.at(-1).role, "assistant");
  assert.equal(messages.at(-1).content, "最终回答");
  assert.equal(runtime.queue.snapshot().running, 0);
  assert.deepEqual(clearedRedactions, [task.task_id]);
  assert.equal(embeddingAdds.length, 1);
  assert.equal(embeddingAdds[0].metadata.answer_excerpt, "最终回答");
  assert.deepEqual(embeddingAdds[0].metadata.artifact_paths, ["E:\\out\\result.docx"]);
});

test("task lifecycle history indexing uses task summary and artifact rows before event-log fallback", () => {
  const { runtime, embeddingAdds } = makeRuntime();
  const { task } = submitTaskWithConversation({
    route: baseRoute,
    contextPacket: { source_type: "clipboard", source_app: "uca.overlay", text: "source text" },
    userCommand: "生成报告",
    executionMode: "interactive",
    conversationId: "conv_success_no_event_scan",
    runtime
  });
  runtime.store.appendArtifact({
    artifact_id: "artifact_no_event_scan",
    task_id: task.task_id,
    conversation_id: task.conversation_id,
    path: "E:\\out\\structured.docx",
    mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    kind: "document",
    status: "ready"
  });
  task.status = "success";
  task.result_summary = "结构化最终回答";
  runtime.store.updateTask(task.task_id, task);
  runtime.queue.markRunning(task.task_id);

  const originalGetTaskEvents = runtime.store.getTaskEvents.bind(runtime.store);
  runtime.store.getTaskEvents = (taskId) => {
    if (taskId === task.task_id) throw new Error("event log should not be read");
    return originalGetTaskEvents(taskId);
  };

  markTaskSucceeded(runtime, task);

  assert.equal(embeddingAdds.length, 1);
  assert.equal(embeddingAdds[0].metadata.answer_excerpt, "结构化最终回答");
  assert.deepEqual(embeddingAdds[0].metadata.artifact_paths, ["E:\\out\\structured.docx"]);
});

test("task lifecycle failure finalizer emits failed event, system outcome, queue finish, and classified failure", () => {
  const { runtime, clearedRedactions } = makeRuntime();
  const { task } = submitTaskWithConversation({
    route: baseRoute,
    contextPacket: { source_type: "clipboard", source_app: "uca.overlay" },
    userCommand: "执行失败任务",
    executionMode: "interactive",
    conversationId: "conv_failed",
    runtime
  });

  runtime.queue.markRunning(task.task_id);

  const failure = markTaskFailed(runtime, task, { message: "Provider timed out", category: "timeout" });

  assert.equal(task.status, "failed");
  assert.equal(task.failure_category, failure.category);
  assert.equal(runtime.queue.snapshot().running, 0);
  assert.deepEqual(clearedRedactions, [task.task_id]);
  assert.ok(runtime.store.getTaskEvents(task.task_id).some((event) => event.event_type === "failed"));
  const messages = runtime.store.getConversationMessages("conv_failed");
  assert.equal(messages.at(-1).role, "system");
  assert.match(messages.at(-1).content, /Task failed:/);
});

test("task lifecycle applies executor events and refreshes composite parent state", () => {
  const { runtime } = makeRuntime();
  const parent = {
    task_id: "parent",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    status: "running",
    sub_status: "composite_running",
    progress: 0,
    child_task_ids: ["child_a", "child_b"],
    executor_history: []
  };
  const childA = {
    task_id: "child_a",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    status: "running",
    sub_status: "running",
    progress: 0,
    parent_task_id: "parent",
    child_index: 0,
    completed_steps: [],
    executor_history: []
  };
  const childB = {
    ...childA,
    task_id: "child_b",
    status: "success",
    child_index: 1
  };
  runtime.store.insertTask(parent);
  runtime.store.insertTask(childA);
  runtime.store.insertTask(childB);

  applyExecutorEvent(runtime, childA, { type: "success", text: "A done" });

  assert.equal(childA.status, "success");
  assert.equal(childA.result_summary, "A done");
  const updatedParent = runtime.store.getTask("parent");
  assert.equal(updatedParent.status, "success");
  assert.equal(updatedParent.progress, 1);
  assert.ok(runtime.store.getTaskEvents("parent").some((event) => event.event_type === "status_changed"));
});

test("task lifecycle update and active execution registry keep compatibility helpers", () => {
  const { runtime } = makeRuntime();
  const task = {
    task_id: "task_active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    status: "queued",
    sub_status: "queued",
    progress: 0,
    completed_steps: [],
    executor_history: []
  };
  runtime.store.insertTask(task);

  registerActiveExecution(runtime, task.task_id, { cancel() {} });
  assert.equal(runtime.activeExecutions.has(task.task_id), true);
  unregisterActiveExecution(runtime, task.task_id);
  assert.equal(runtime.activeExecutions.has(task.task_id), false);

  updateTask(runtime, task, { status: "running", sub_status: "running" }, true);
  assert.equal(task.status, "running");
  assert.ok(runtime.store.getTaskEvents(task.task_id).some((event) => event.event_type === "status_changed"));
  assert.equal(refreshCompositeParentStatus(runtime, "missing"), null);
});
