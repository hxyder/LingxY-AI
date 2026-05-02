import test from "node:test";
import assert from "node:assert/strict";

import {
  attemptedLaunchKeys,
  buildLaunchSequenceGuidance,
  nextPendingLaunchCandidate
} from "../../src/service/executors/tool_using/launch-sequence.mjs";

test("agent launch sequence tracks attempted apps by normalized key", () => {
  const keys = attemptedLaunchKeys([
    { type: "tool_result", tool: "launch_app", args: { app: "YouTube" } },
    { type: "tool_result", tool: "launch_app", args: { app: "Excel.exe" } },
    { type: "tool_result", tool: "notify", args: { title: "ignored" } }
  ]);

  assert.deepEqual([...keys].sort(), ["excel", "youtube"]);
});

test("agent launch sequence guidance points to the next unattempted target", () => {
  const task = { user_command: "打开 YouTube，打开 Excel，打开 Word" };
  const transcript = [
    { type: "tool_result", tool: "launch_app", args: { app: "YouTube" }, success: false },
    { type: "tool_result", tool: "launch_app", args: { app: "Excel.exe" }, success: true }
  ];

  assert.equal(nextPendingLaunchCandidate(task, transcript), "Word");
  const guidance = buildLaunchSequenceGuidance(task, transcript);
  assert.match(guidance, /Remaining targets: Word/);
  assert.match(guidance, /"app": "Word"/);
  assert.match(guidance, /Do not finalize/);
});

test("agent launch sequence does not fire for a single launch target", () => {
  const task = { user_command: "打开 Excel" };

  assert.equal(nextPendingLaunchCandidate(task, []), null);
  assert.equal(buildLaunchSequenceGuidance(task, []), null);
});
