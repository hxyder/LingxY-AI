import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTaskListEntries,
  isRoutineCompletedConversationTask,
  isNestedChildTask
} from "../../src/desktop/renderer/console-task-list.mjs";

function task(taskId, overrides = {}) {
  return {
    task_id: taskId,
    created_at: overrides.created_at ?? `2026-05-05T10:00:0${taskId.slice(-1)}.000Z`,
    status: "success",
    user_command: taskId,
    ...overrides
  };
}

test("task list nests conversation continuations under their parent task", () => {
  const parent = task("task_parent", { created_at: "2026-05-05T10:00:00.000Z" });
  const followUp = task("task_follow", {
    created_at: "2026-05-05T10:01:00.000Z",
    parent_task_id: "task_parent",
    child_index: null,
    is_continuation: true
  });

  assert.equal(isNestedChildTask(followUp), true);

  const entries = buildTaskListEntries([followUp, parent], { limit: 10 });
  assert.deepEqual(entries.map((entry) => [entry.task.task_id, entry.indent, entry.isChild]), [
    ["task_parent", 0, false],
    ["task_follow", 1, true]
  ]);
});

test("task list still nests composite children without continuation flags", () => {
  const parent = task("task_parent", { child_count: 1 });
  const child = task("task_child", {
    parent_task_id: "task_parent",
    child_index: 0,
    is_continuation: false
  });

  const entries = buildTaskListEntries([child, parent], { limit: 10 });
  assert.deepEqual(entries.map((entry) => [entry.task.task_id, entry.indent, entry.isChild]), [
    ["task_parent", 0, false],
    ["task_child", 1, true]
  ]);
});

test("task list keeps standalone tasks at top level", () => {
  const standalone = task("task_standalone", {
    parent_task_id: null,
    is_continuation: false
  });

  assert.equal(isNestedChildTask(standalone), false);
  assert.deepEqual(buildTaskListEntries([standalone], { limit: 10 }), [
    { task: standalone, indent: 0, isChild: false }
  ]);
});

test("task list keeps multi-turn continuation chains under the original visible root", () => {
  const first = task("task_first", { created_at: "2026-05-05T10:00:00.000Z" });
  const second = task("task_second", {
    created_at: "2026-05-05T10:01:00.000Z",
    parent_task_id: "task_first",
    is_continuation: true
  });
  const third = task("task_third", {
    created_at: "2026-05-05T10:02:00.000Z",
    parent_task_id: "task_second",
    is_continuation: true
  });

  const entries = buildTaskListEntries([third, second, first], { limit: 10 });

  assert.deepEqual(entries.map((entry) => [entry.task.task_id, entry.indent, entry.isChild]), [
    ["task_first", 0, false],
    ["task_second", 1, true],
    ["task_third", 2, true]
  ]);
});

test("task list can hide routine completed chat tasks while keeping operational work", () => {
  const routine = task("task_chat", {
    source_type: "clipboard",
    executor: "tool_using"
  });
  const fileTask = task("task_file", {
    source_type: "file",
    executor: "code_cli"
  });
  const failedChat = task("task_failed", {
    source_type: "clipboard",
    status: "failed"
  });
  const artifactTask = task("task_artifact", {
    source_type: "clipboard",
    task_spec: { artifact: { required: true } }
  });

  assert.equal(isRoutineCompletedConversationTask(routine), true);
  assert.equal(isRoutineCompletedConversationTask(fileTask), false);
  assert.equal(isRoutineCompletedConversationTask(failedChat), false);
  assert.equal(isRoutineCompletedConversationTask(artifactTask), false);

  const entries = buildTaskListEntries([routine, fileTask, failedChat, artifactTask], {
    limit: 10,
    hideRoutineCompleted: true
  });
  assert.deepEqual(new Set(entries.map((entry) => entry.task.task_id)), new Set([
    "task_file",
    "task_failed",
    "task_artifact"
  ]));
});
