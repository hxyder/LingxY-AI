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
