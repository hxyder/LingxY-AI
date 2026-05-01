import assert from "node:assert/strict";
import test from "node:test";

import { createActionToolRegistry } from "../../src/service/action_tools/registry.mjs";
import { submitActionToolTask } from "../../src/service/core/action-tool-submission.mjs";
import { createInMemoryStoreScaffold } from "../../src/service/core/store/memory-store.mjs";

function createRuntime() {
  return {
    store: createInMemoryStoreScaffold(),
    queue: {
      enqueue() { return { accepted: true, dedupedTaskId: null }; },
      markRunning() {},
      markFinished() {}
    },
    eventBus: {
      publish() {}
    },
    executors: []
  };
}

test("action-tool fast path treats policy-guard denial as task failure", async () => {
  const runtime = createRuntime();
  let executed = false;
  runtime.actionToolRegistry = createActionToolRegistry([{
    id: "web_search",
    name: "Fake web search",
    description: "Fake external read tool for boundary testing.",
    parameters: { type: "object", properties: {} },
    policy_group: "external_web_read",
    async execute() {
      executed = true;
      return { success: true, observation: "executed" };
    }
  }]);

  const result = await submitActionToolTask({
    runtime,
    userCommand: "不要联网，搜索 OpenAI",
    executionMode: "interactive",
    fastPathTool: "web_search",
    fastPathArgs: { query: "OpenAI" }
  });

  assert.equal(executed, false);
  assert.equal(result.task.status, "failed");

  const completion = result.taskEvents
    .find((event) => event.event_type === "tool_call_completed");
  assert.ok(completion);
  assert.equal(completion.payload.success, false);
  assert.equal(completion.payload.error, "blocked_by_policy");

  const audit = runtime.store.listAuditLogs()
    .find((entry) => entry.event_subtype === "tool.blocked_by_policy");
  assert.ok(audit);
  assert.equal(audit.payload.tool_id, "web_search");
});

test("action-tool fast path creates approval for confirmation-required tools", async () => {
  const runtime = createRuntime();
  const calls = [];
  runtime.actionToolRegistry = createActionToolRegistry([{
    id: "send_email_smtp",
    name: "Fake SMTP sender",
    description: "Fake high-risk send tool for approval testing.",
    parameters: { type: "object", properties: {} },
    risk_level: "high",
    requires_confirmation: true,
    async execute(args) {
      calls.push(args);
      return { success: true, observation: "sent" };
    }
  }]);

  const result = await submitActionToolTask({
    runtime,
    userCommand: "发送邮件给 ops@example.com",
    executionMode: "interactive",
    fastPathTool: "send_email_smtp",
    fastPathArgs: {
      to: ["ops@example.com"],
      subject: "Approval required",
      body: "Do not send before approval."
    }
  });

  assert.equal(calls.length, 0);
  assert.equal(result.task.status, "partial_success");
  assert.equal(result.task.sub_status, "waiting_external_decision");
  assert.ok(result.pendingApproval);

  const approvals = runtime.store.listPendingApprovals();
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].proposed_target, "send_email_smtp");
  assert.equal(approvals[0].metadata.task_id, result.task.task_id);

  const created = result.taskEvents
    .find((event) => event.event_type === "pending_approval_created");
  assert.ok(created);
  assert.equal(created.payload.tool_id, "send_email_smtp");
});
