import assert from "node:assert/strict";
import test from "node:test";

import {
  actionGroupHitSatisfies,
  evaluateActionObligations
} from "../../src/service/core/policy/obligation-evaluator.mjs";

test("successful connector workflow satisfies matching email action even without emitted connector_status metadata", () => {
  const entry = {
    type: "tool_result",
    tool: "connector_workflow_run",
    args: { workflowId: "google.gmail.draft_confirm_send" },
    success: true,
    observation: "Gmail Draft Confirm Send completed."
  };

  assert.equal(actionGroupHitSatisfies("email_send", entry), true);
  const obligations = evaluateActionObligations({
    success_contract: { required_policy_groups: ["email_send"] }
  }, [entry]);
  assert.equal(obligations[0].status, "satisfied");
});

test("connector workflow with explicit non-success status does not satisfy action obligation", () => {
  const entry = {
    type: "tool_result",
    tool: "connector_workflow_run",
    args: { workflowId: "google.gmail.draft_confirm_send" },
    success: true,
    observation: "Waiting for user confirmation.",
    metadata: { connector_status: "waiting_external_decision", workflow_id: "google.gmail.draft_confirm_send" }
  };

  assert.equal(actionGroupHitSatisfies("email_send", entry), false);
});
