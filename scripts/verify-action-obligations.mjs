#!/usr/bin/env node
import assert from "node:assert/strict";

import { createActionToolRegistry } from "../src/service/action_tools/registry.mjs";
import {
  actionObligationsAllowFinal,
  evaluateActionObligations
} from "../src/service/core/policy/obligation-evaluator.mjs";
import { POLICY_GROUPS } from "../src/service/core/policy/policy-groups.mjs";
import {
  detectUnbackedActionClaims,
  validateSuccessContract
} from "../src/service/core/policy/success-contract-validator.mjs";
import {
  runToolAgentLoop,
  shouldInjectRequiredActionGuidance
} from "../src/service/executors/tool_using/agent-loop.mjs";

function taskSpec(groups) {
  return {
    success_contract: {
      required_policy_groups: groups,
      required_tool_names: []
    }
  };
}

{
  assert.ok(POLICY_GROUPS.calendar_create.includes("account_create_event"));
  assert.ok(POLICY_GROUPS.calendar_create.includes("connector_workflow_run"));
  assert.ok(POLICY_GROUPS.file_upload.includes("account_upload_file"));
}

{
  const spec = taskSpec(["calendar_create"]);
  const ok = validateSuccessContract(spec, [{
    type: "tool_result",
    tool: "account_create_event",
    success: true,
    observation: "Event created."
  }]);
  assert.equal(ok.satisfied, true, "calendar create tool satisfies calendar_create");

  const missing = validateSuccessContract(spec, []);
  assert.equal(missing.satisfied, false);
  assert.equal(missing.violations[0]?.kind, "calendar_create_required_not_called");
}

{
  const spec = taskSpec(["file_upload"]);
  const ok = validateSuccessContract(spec, [{
    type: "tool_result",
    tool: "account_upload_file",
    success: true,
    observation: "Uploaded file."
  }]);
  assert.equal(ok.satisfied, true, "upload tool satisfies file_upload");
}

{
  const waitingEmail = evaluateActionObligations(taskSpec(["email_send"]), [{
    type: "tool_result",
    tool: "connector_workflow_run",
    success: true,
    metadata: {
      connector_status: "waiting_external_decision",
      workflow_id: "google.gmail.draft_confirm_send",
      approval: { approval_id: "approval_email" }
    }
  }]);
  assert.equal(waitingEmail[0].status, "waiting_approval");
  assert.equal(waitingEmail[0].approval.approval_id, "approval_email");

  const waitingCalendar = evaluateActionObligations(taskSpec(["calendar_create"]), [{
    type: "tool_result",
    tool: "connector_workflow_run",
    success: true,
    metadata: {
      connector_status: "waiting_external_decision",
      workflow_id: "google.calendar.create_confirm",
      approval: { approval_id: "approval_calendar" }
    }
  }]);
  assert.equal(waitingCalendar[0].status, "waiting_approval");
}

{
  const abandoned = evaluateActionObligations(taskSpec(["email_send"]), [{
    type: "tool_result",
    tool: "account_send_email",
    success: false,
    observation: "No connected account is available."
  }]);
  assert.equal(abandoned[0].status, "abandoned_with_reason");
  assert.equal(actionObligationsAllowFinal(abandoned), true);
  assert.equal(validateSuccessContract(taskSpec(["email_send"]), [{
    type: "tool_result",
    tool: "account_send_email",
    success: false,
    observation: "No connected account is available."
  }]).satisfied, true, "abandoned action may finalize with a failure reason");
}

{
  const groups = shouldInjectRequiredActionGuidance({
    next_action: "continue",
    satisfied: false,
    violations: [{
      kind: "calendar_create_required_not_called",
      message: "calendar_create missing"
    }, {
      kind: "file_upload_required_not_called",
      message: "file_upload missing"
    }]
  });
  assert.deepEqual(groups.sort(), ["calendar_create", "file_upload"]);
}

{
  const violations = detectUnbackedActionClaims([{
    type: "tool_result",
    tool: "connector_workflow_run",
    success: true,
    metadata: {
      connector_status: "success",
      workflow_id: "google.gmail.draft_confirm_send"
    }
  }], "Calendar event has been created.");
  assert.equal(
    violations[0]?.kind,
    "calendar_create_claim_unsupported",
    "email workflow must not satisfy calendar_create claims"
  );
}

{
  const calls = [];
  const registry = createActionToolRegistry([
    {
      id: "web_search_fetch",
      name: "Web Search Fetch",
      description: "Fetch search results.",
      parameters: { type: "object", properties: { query: { type: "string" } } },
      risk_level: "low",
      requires_confirmation: false,
      async execute(args) {
        calls.push({ tool: "web_search_fetch", args });
        return {
          success: true,
          observation: "Market data from several current sources with enough substance to continue.",
          metadata: { results: [{ url: "https://example.com/a" }] },
          artifact_paths: []
        };
      }
    },
    {
      id: "connector_workflow_run",
      name: "Connector Workflow Run",
      description: "Run connector workflow.",
      parameters: { type: "object", required: ["workflowId"], properties: { workflowId: { type: "string" }, input: { type: "object" } } },
      risk_level: "medium",
      requires_confirmation: false,
      async execute(args) {
        calls.push({ tool: "connector_workflow_run", args });
        return {
          success: true,
          observation: "Waiting for user confirmation.",
          metadata: {
            connector_status: "waiting_external_decision",
            workflow_id: args.workflowId,
            approval: { approval_id: "approval_loop" }
          },
          artifact_paths: []
        };
      }
    }
  ]);
  const runtime = {
    actionToolRegistry: registry,
    toolContext: {},
    toolOutputDir: ".",
    store: { appendAuditLog() {} },
    emitTaskEvent() {}
  };
  const plannerDecisions = [
    { type: "tool_call", tool: "web_search_fetch", args: { query: "market summary" } },
    { type: "final", text: "Market research is done." },
    {
      type: "tool_call",
      tool: "connector_workflow_run",
      args: {
        workflowId: "google.gmail.draft_confirm_send",
        input: {
          to: ["user-a@example.com"],
          subject: "Market summary",
          body: "Summary body"
        }
      }
    }
  ];
  const result = await runToolAgentLoop({
    runtime,
    task: {
      task_id: "task_action_obligation",
      user_command: "Research the market and send the summary to user-a@example.com",
      execution_mode: "interactive",
      task_spec: {
        connector_domain: true,
        success_contract: { required_policy_groups: ["external_web_read", "email_send"], required_tool_names: [] },
        tool_policy: { web_search_fetch: { mode: "required" }, policy_groups: { external_web_read: { mode: "required" } } },
        synthesis: { expected_output: "execution" },
        execution_constraints: { max_iterations: 6 }
      },
      context_packet: {}
    },
    planner: async () => plannerDecisions.shift()
  });
  assert.equal(result.status, "waiting_external_decision");
  assert.ok(calls.some((call) => call.tool === "connector_workflow_run"));
}

console.log("ok verify-action-obligations");
