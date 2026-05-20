import assert from "node:assert/strict";
import test from "node:test";

import {
  bindTaskToConversationId,
  resolveOverlayTaskEventVisibility,
  taskOwnerConversationId
} from "../../src/desktop/renderer/overlay-task-routing.mjs";

test("overlay task routing normalizes task ids at bind and lookup boundaries", () => {
  const owners = new Map();
  assert.equal(bindTaskToConversationId(owners, 42, "conv_a"), true);
  assert.equal(taskOwnerConversationId(owners, "42"), "conv_a");
});

test("overlay task visibility only renders events owned by the current visible conversation", () => {
  const owners = new Map();
  bindTaskToConversationId(owners, "task_a", "conv_a");

  assert.deepEqual(
    resolveOverlayTaskEventVisibility(owners, {
      taskId: "task_a",
      activeTaskId: "task_a",
      currentConversationId: "conv_a"
    }),
    {
      render: true,
      ownerConversationId: "conv_a",
      reason: "owner_matches_visible_conversation"
    }
  );

  const stale = resolveOverlayTaskEventVisibility(owners, {
    taskId: "task_a",
    activeTaskId: "task_a",
    currentConversationId: "conv_b"
  });
  assert.equal(stale.render, false);
  assert.equal(stale.ownerConversationId, "conv_a");
  assert.equal(stale.reason, "owner_mismatch");
});

test("overlay task visibility rejects unowned events when no visible conversation exists", () => {
  const owners = new Map();

  const clearedOverlay = resolveOverlayTaskEventVisibility(owners, {
    taskId: "task_old",
    activeTaskId: null,
    currentConversationId: null
  });
  assert.equal(clearedOverlay.render, false);
  assert.equal(clearedOverlay.reason, "no_visible_conversation");

  const oldBackgroundTask = resolveOverlayTaskEventVisibility(owners, {
    taskId: "task_old",
    activeTaskId: "task_new",
    currentConversationId: "conv_new"
  });
  assert.equal(oldBackgroundTask.render, false);
  assert.equal(oldBackgroundTask.reason, "unowned_background_task");

  const liveActiveTask = resolveOverlayTaskEventVisibility(owners, {
    taskId: "task_new",
    activeTaskId: "task_new",
    currentConversationId: "conv_new"
  });
  assert.equal(liveActiveTask.render, true);
  assert.equal(liveActiveTask.reason, "active_task_without_owner");
});
