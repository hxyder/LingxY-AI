import assert from "node:assert/strict";
import test from "node:test";

import { buildTaskSummaryPayload } from "../../src/service/core/http-routes/task-routes.mjs";
import { createInMemoryStoreScaffold } from "../../src/service/core/store/memory-store.mjs";

test("task summary payload exposes continuation state for renderer nesting", () => {
  const store = createInMemoryStoreScaffold();
  store.insertTask({
    task_id: "task_parent",
    created_at: "2026-05-05T10:00:00.000Z",
    updated_at: "2026-05-05T10:00:00.000Z",
    status: "success",
    user_command: "first",
    context_packet: { source_type: "manual", source_app: "uca.test" }
  });
  store.insertTask({
    task_id: "task_follow",
    created_at: "2026-05-05T10:01:00.000Z",
    updated_at: "2026-05-05T10:01:00.000Z",
    status: "success",
    user_command: "继续",
    parent_task_id: "task_parent",
    child_index: null,
    is_continuation: true,
    context_packet: { source_type: "manual", source_app: "uca.test" }
  });

  const payload = buildTaskSummaryPayload({ store }, { recentLimit: 10 });
  const follow = payload.tasks.find((task) => task.task_id === "task_follow");

  assert.equal(follow.parent_task_id, "task_parent");
  assert.equal(follow.child_index, null);
  assert.equal(follow.is_continuation, true);
});

test("task summary payload exposes conversation id and llm usage for token UI", () => {
  const store = createInMemoryStoreScaffold();
  store.insertTask({
    task_id: "task_usage",
    created_at: "2026-05-13T10:00:00.000Z",
    updated_at: "2026-05-13T10:01:00.000Z",
    status: "success",
    user_command: "count tokens",
    conversation_id: "conv_usage",
    usage_summary: {
      input_tokens: 100,
      output_tokens: 25,
      total_tokens: 125,
      cache_hit_tokens: 60,
      cache_miss_tokens: 40
    },
    context_packet: { source_type: "manual", source_app: "uca.test" }
  });

  const payload = buildTaskSummaryPayload({ store }, { recentLimit: 10 });
  const task = payload.tasks.find((item) => item.task_id === "task_usage");

  assert.equal(task.conversation_id, "conv_usage");
  assert.equal(task.usage_summary.input_tokens, 100);
  assert.equal(task.usage_summary.output_tokens, 25);
  assert.equal(task.usage_summary.total_tokens, 125);
  assert.equal(task.usage_summary.cache_hit_tokens, 60);
  assert.equal(task.usage_summary.cache_miss_tokens, 40);
});

test("task summary payload does not scan event logs for first-screen usage", () => {
  const store = createInMemoryStoreScaffold();
  store.insertTask({
    task_id: "task_fast_summary",
    created_at: "2026-05-13T11:00:00.000Z",
    updated_at: "2026-05-13T11:01:00.000Z",
    status: "success",
    user_command: "show fast list",
    conversation_id: "conv_fast_summary",
    usage_summary: {
      input_tokens: 12,
      output_tokens: 8,
      total_tokens: 20
    },
    context_packet: { source_type: "manual", source_app: "uca.test" }
  });
  store.getTaskEvents = () => {
    throw new Error("task summary should not scan task event logs");
  };

  const payload = buildTaskSummaryPayload({ store }, { recentLimit: 10 });
  const task = payload.tasks.find((item) => item.task_id === "task_fast_summary");

  assert.equal(task.conversation_id, "conv_fast_summary");
  assert.equal(task.usage_summary.total_tokens, 20);
});
