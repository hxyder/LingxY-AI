import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPermissionModeContract,
  describePermissionModeContract,
  shouldBlockToolForExecutionMode,
  shouldPromptForToolApproval
} from "../../src/shared/permission-mode-model.mjs";
import { createTaskRecord } from "../../src/service/core/task-runtime/task-record.mjs";

const route = {
  intent: "act",
  executor: "tool_using",
  requires_confirmation: false
};

test("permission mode contract maps unattended safe to no-prompt high-risk blocking", () => {
  const contract = buildPermissionModeContract({
    executionMode: "unattended_safe",
    privacyConfig: { privacy_sandbox: { mode: "local_only" } },
    task: { task_id: "task_mode" }
  });

  assert.equal(contract.mode_id, "unattended_safe");
  assert.equal(contract.user_visible.unattended_safe, true);
  assert.equal(contract.user_visible.approval_required, false);
  assert.equal(contract.user_visible.local_only, true);
  assert.equal(contract.approval.behavior, "do_not_prompt");
  assert.equal(contract.approval.blocks_high_risk_tools, true);
  assert.equal(contract.tool_surface.network_allowed, false);
  assert.match(describePermissionModeContract(contract), /Unattended safe/);
  assert.match(describePermissionModeContract(contract), /Local only/);
});

test("permission mode helpers preserve current approval semantics", () => {
  const highConfirmation = { risk_level: "high", requires_confirmation: true };
  const mediumConfirmation = { risk_level: "medium", requires_confirmation: true };

  assert.equal(shouldPromptForToolApproval({ executionMode: "interactive", risk: highConfirmation }), true);
  assert.equal(shouldPromptForToolApproval({ executionMode: "approval_required", risk: highConfirmation }), true);
  assert.equal(shouldPromptForToolApproval({ executionMode: "unattended_safe", risk: highConfirmation }), false);
  assert.equal(shouldBlockToolForExecutionMode({ executionMode: "unattended_safe", risk: highConfirmation }), true);
  assert.equal(shouldBlockToolForExecutionMode({ executionMode: "unattended_safe", risk: mediumConfirmation }), false);
});

test("task records persist permission mode contract in selection metadata", () => {
  const task = createTaskRecord({
    route,
    runtime: {
      securityBroker: {
        getConfig() {
          return { privacy_sandbox: { file_write: "block" } };
        }
      }
    },
    contextPacket: {
      source_type: "manual",
      source_app: "uca.test",
      selection_metadata: {}
    },
    userCommand: "Run safely",
    executionMode: "approval_required",
    executorOverride: "tool_using",
    submissionKind: "action_tool"
  });

  const contract = task.context_packet.selection_metadata.permission_mode_contract;
  assert.equal(task.execution_mode, "approval_required");
  assert.equal(contract.mode_id, "approval_required");
  assert.equal(contract.privacy.active, true);
  assert.deepEqual(contract.privacy.blocked_capabilities, ["file_write"]);
  assert.equal(describePermissionModeContract(task), "Approval required");
});
