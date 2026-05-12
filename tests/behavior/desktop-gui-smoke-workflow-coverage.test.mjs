import test from "node:test";
import assert from "node:assert/strict";

import {
  DESKTOP_GUI_DAILY_WORKFLOW_GROUPS,
  summarizeDesktopGuiDailyWorkflowCoverage,
  validateDesktopGuiDailyWorkflowCoverage
} from "../../src/shared/desktop-gui-smoke-workflow-coverage.mjs";

test("desktop GUI daily workflow coverage groups conversation task and artifact checks", () => {
  const workflows = DESKTOP_GUI_DAILY_WORKFLOW_GROUPS.map((group) => group.workflow);
  assert.deepEqual(workflows, [
    "conversation_continuity",
    "task_operations",
    "artifact_workflow"
  ]);
});

test("desktop GUI daily workflow coverage validates complete smoke result", () => {
  const names = DESKTOP_GUI_DAILY_WORKFLOW_GROUPS.flatMap((group) => group.requiredChecks);
  const validation = validateDesktopGuiDailyWorkflowCoverage({
    checks: names.map((name) => ({ name, ok: true }))
  });
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.missing, []);
});

test("desktop GUI daily workflow coverage reports missing checks by workflow", () => {
  const summary = summarizeDesktopGuiDailyWorkflowCoverage([
    "console_chat_branch_fork",
    "task_cancel_ipc_bridge"
  ]);
  assert.equal(summary.find((entry) => entry.workflow === "conversation_continuity").ok, false);
  assert.ok(
    summary
      .find((entry) => entry.workflow === "conversation_continuity")
      .missing.includes("console_chat_branch_edit")
  );
});
