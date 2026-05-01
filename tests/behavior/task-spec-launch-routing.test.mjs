import assert from "node:assert/strict";
import test from "node:test";

import { classifyGoal, createTaskSpec } from "../../src/service/core/task-spec.mjs";

test("pure app launch stays launch_and_act without artifact output", () => {
  const spec = createTaskSpec("打开 AlphaApp");

  assert.equal(classifyGoal("打开 AlphaApp"), "launch_and_act");
  assert.equal(spec.goal, "launch_and_act");
  assert.equal(spec.artifact.required, false);
  assert.equal(spec.artifact.kind, null);
});

test("Chinese file-open phrasing routes to file action, not app launch", () => {
  for (const command of ["打开这个文件", "显示所在位置", "打开上次生成的ppt"]) {
    const spec = createTaskSpec(command);

    assert.equal(classifyGoal(command), "open_or_reveal_file", command);
    assert.equal(spec.goal, "open_or_reveal_file", command);
    assert.equal(spec.artifact.required, false, command);
  }
});

test("scheduled file-open phrasing keeps the schedule goal", () => {
  assert.equal(classifyGoal("明天提醒我打开这个文件"), "schedule_or_notify");
});
