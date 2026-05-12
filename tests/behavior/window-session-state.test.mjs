import assert from "node:assert/strict";
import test from "node:test";

import { createWindowSessionState } from "../../src/desktop/shared/window-session-state.mjs";

test("window session state rejects stale task events for a bound window", () => {
  const session = createWindowSessionState({ now: () => Date.parse("2026-05-12T12:00:00.000Z") });
  session.bindWindow("overlay", {
    surface: "overlay",
    taskId: "task_a",
    conversationId: "conv_a"
  });

  assert.deepEqual(
    session.canAcceptTaskEvent({ windowId: "overlay", taskId: "task_a", conversationId: "conv_a" }),
    { allowed: true, reason: "owner_match" }
  );

  const rejected = session.canAcceptTaskEvent({
    windowId: "overlay",
    taskId: "task_b",
    conversationId: "conv_a"
  });
  assert.equal(rejected.allowed, false);
  assert.equal(rejected.reason, "stale_task_for_window");
  assert.equal(rejected.expectedTaskId, "task_a");
});

test("window session state binds preview and rejects stale preview deltas", () => {
  const session = createWindowSessionState();
  const bound = session.acceptPreviewPayload({
    taskId: "task_preview_a",
    conversationId: "conv_preview",
    artifactPath: "a.md"
  }, { bind: true });

  assert.equal(bound.allowed, true);
  assert.equal(bound.binding.taskId, "task_preview_a");
  assert.equal(
    session.acceptPreviewPayload({ taskId: "task_preview_a", conversationId: "conv_preview" }).allowed,
    true
  );

  const stale = session.acceptPreviewPayload({ taskId: "task_preview_b", conversationId: "conv_preview" });
  assert.equal(stale.allowed, false);
  assert.equal(stale.reason, "stale_task_for_window");
  assert.equal(session.snapshot().rejectedEvents.length, 1);
});

test("window session state records popup owners and background task owners", () => {
  const session = createWindowSessionState();
  session.bindTaskOwner("task_bg", "conv_bg", { surface: "system", ownerType: "background" });
  session.registerPopup("card_1", {
    kind: "approval",
    taskId: "task_bg",
    conversationId: "conv_bg",
    approvalId: "appr_1"
  });

  const snapshot = session.snapshot();
  assert.equal(snapshot.backgroundOwners[0].taskId, "task_bg");
  assert.equal(snapshot.popupOwners[0].cardId, "card_1");
  assert.equal(snapshot.popupOwners[0].approvalId, "appr_1");

  assert.equal(session.unregisterPopup("card_1"), true);
  assert.equal(session.snapshot().popupOwners.length, 0);
});
