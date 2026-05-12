import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createActionResult } from "../src/service/capabilities/registry/types.mjs";
import { createServiceBootstrap } from "../src/service/core/service-bootstrap.mjs";
import { createPersistentRuntime } from "../src/service/core/persistent-runtime.mjs";
import { submitConnectorWorkflowTask } from "../src/service/capabilities/connectors/core/workflow-submission.mjs";
import { CONNECTOR_WORKFLOW_RUN_TOOL } from "../src/service/capabilities/connectors/tools/catalog-tools.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const runtimeDir = path.join(repoRoot, ".tmp", "verify-connector-workflow-dispatcher", crypto.randomUUID());

function installFakeSendTool(runtime) {
  const calls = [];
  runtime.actionToolRegistry.register({
    id: "account_send_email",
    name: "Fake Account Send Email",
    description: "Fake connector send tool for workflow dispatcher verification.",
    parameters: { type: "object", required: [], properties: {} },
    risk_level: "high",
    required_capabilities: ["network"],
    requires_confirmation: true,
    async execute(args = {}) {
      calls.push(args);
      return createActionResult({
        success: true,
        observation: `Fake sent email to ${(args.to ?? []).join(", ")}`,
        metadata: {
          provider: args.provider,
          accountId: args.accountId ?? "fake-account",
          messageId: "fake-message-1"
        }
      });
    }
  });
  return calls;
}

const service = createServiceBootstrap();
const runtime = service.runtime;
const sendCalls = installFakeSendTool(runtime);

const input = {
  to: ["user-b@example.com"],
  subject: "Project update",
  body: "Here is the draft body."
};

const firstRun = await submitConnectorWorkflowTask({
  runtime,
  workflowId: "google.gmail.draft_confirm_send",
  input,
  userCommand: "先给我草稿，我确认了再发"
});

assert.equal(firstRun.task.status, "partial_success");
assert.equal(firstRun.pendingApproval.status, "pending");
assert.equal(sendCalls.length, 0, "send step must not run before confirmation");
assert.equal(firstRun.workflowResult.outputs.draft.subject, input.subject);

const approved = await runtime.pendingApprovals.approve(firstRun.pendingApproval.approval_id, {
  actor: "verify-connector-workflow-dispatcher"
});
assert.equal(approved.approval.status, "approved");
assert.equal(approved.executionResult.task.status, "success");
assert.equal(approved.executionResult.task.task_id, firstRun.task.task_id,
  "approval resume should continue the original connector workflow task");
assert.equal(approved.executionResult.resumed_same_task, true,
  "connector workflow approval should use same-task resume");
assert.equal(approved.approval.resulting_task_id, firstRun.task.task_id,
  "approval record should point back to the resumed task, not a bridge task");
assert.equal(approved.approval.metadata.approval_resume.resulting_task_id, firstRun.task.task_id,
  "approval resume metadata should resolve to the resumed task id");
assert.equal(sendCalls.length, 1, "send step should run after approval");
assert.equal(sendCalls[0].provider, "google");
assert.deepEqual(sendCalls[0].to, input.to);
assert.ok(runtime.store.getTaskEvents(firstRun.task.task_id).some((event) =>
  event.event_type === "approval_resume_started"
  && event.payload?.approval_id === firstRun.pendingApproval.approval_id),
"same-task resume should leave an approval_resume_started event on the original task");

const invalid = await CONNECTOR_WORKFLOW_RUN_TOOL.execute({
  workflowId: "google.gmail.draft_confirm_send",
  input: {
    to: ["user-b@example.com"],
    subject: "",
    body: ""
  }
}, { runtime });
assert.equal(invalid.success, false, "empty draft workflow output should fail validation");
assert.equal(invalid.metadata.connector_status, "failed");

await rm(runtimeDir, { recursive: true, force: true });
const persistent = createPersistentRuntime({
  baseDir: runtimeDir,
  port: 0,
  pipeName: `\\\\.\\pipe\\uca-helper-connector-workflow-${crypto.randomUUID()}`
});
const listening = await persistent.start();
try {
  installFakeSendTool(persistent.runtime);
  const response = await fetch(`${listening.baseUrl}/connectors/catalog/workflows/${encodeURIComponent("google.gmail.draft_confirm_send")}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input,
      userCommand: "HTTP workflow run"
    })
  });
  assert.equal(response.ok, true);
  const payload = await response.json();
  assert.equal(payload.task.status, "partial_success");
  assert.equal(payload.pendingApproval.status, "pending");
} finally {
  await persistent.stop();
}

console.log("Connector workflow dispatcher verification passed.");
