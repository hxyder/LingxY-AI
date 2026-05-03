import assert from "node:assert/strict";
import test from "node:test";

import {
  buildApprovalPreview,
  executeAgenticToolCall
} from "../../src/service/executors/agentic/tool-execution.mjs";

function registryFor(tool) {
  return {
    get(id) {
      return id === tool.id ? tool : null;
    }
  };
}

test("agentic tool execution reports unregistered tools without throwing", async () => {
  const result = await executeAgenticToolCall({
    registry: { get: () => null },
    call: { name: "missing_tool", arguments: {} }
  });

  assert.equal(result.success, false);
  assert.equal(result.metadata.tool_id, "missing_tool");
  assert.match(result.observation, /not registered/);
});

test("agentic tool execution normalizes successful tool results", async () => {
  const calls = [];
  const tool = {
    id: "read_only_lookup",
    name: "Lookup",
    risk_level: "low",
    requires_confirmation: false,
    async execute(args) {
      calls.push(args);
      return {
        success: true,
        observation: "looked up",
        metadata: { ok: true },
        artifact_paths: ["E:/linxiDoc/out.md"]
      };
    }
  };

  const result = await executeAgenticToolCall({
    registry: registryFor(tool),
    call: { id: "call1", name: tool.id, arguments: { query: "x" } },
    toolContext: {}
  });

  assert.equal(result.success, true);
  assert.deepEqual(calls, [{ query: "x" }]);
  assert.deepEqual(result.artifact_paths, ["E:/linxiDoc/out.md"]);
  assert.equal(result.metadata.ok, true);
});

test("agentic tool execution blocks schedule registry mutation inside scheduled fires before approval", async () => {
  let executed = false;
  let approvals = 0;
  const tool = {
    id: "create_scheduled_task",
    name: "Create schedule",
    policy_group: "schedule_create",
    risk_level: "high",
    requires_confirmation: true,
    async execute() {
      executed = true;
      return { success: true, observation: "scheduled" };
    }
  };

  const result = await executeAgenticToolCall({
    registry: registryFor(tool),
    call: { id: "call_schedule", name: tool.id, arguments: {} },
    runtime: { pendingApprovals: { create: () => { approvals += 1; return { approval_id: "appr" }; } } },
    task: { task_id: "task_fire", context_packet: { selection_metadata: { scheduled_task_fire: true } } },
    toolContext: {}
  });

  assert.equal(result.success, false);
  assert.equal(result.metadata.reason, "scheduled_fire_cannot_modify_schedule_registry");
  assert.equal(executed, false);
  assert.equal(approvals, 0);
});

test("agentic tool execution blocks redundant side-effect calls after prior success", async () => {
  let executed = false;
  const tool = {
    id: "account_send_email",
    name: "Send email",
    risk_level: "low",
    requires_confirmation: false,
    async execute() {
      executed = true;
      return { success: true, observation: "sent" };
    }
  };

  const result = await executeAgenticToolCall({
    registry: registryFor(tool),
    call: { id: "call_email", name: tool.id, arguments: { to: "a@b.test" } },
    transcript: [{ role: "tool", name: tool.id, success: true }],
    toolContext: {}
  });

  assert.equal(result.success, false);
  assert.equal(result.metadata.reason, "redundant_side_effect_call");
  assert.equal(executed, false);
});

test("agentic tool execution creates pending approval instead of running high-risk tools", async () => {
  let executed = false;
  const approvals = [];
  const tool = {
    id: "account_send_email",
    name: "Send email",
    risk_level: "high",
    requires_confirmation: true,
    async execute() {
      executed = true;
      return { success: true, observation: "sent" };
    }
  };

  const result = await executeAgenticToolCall({
    registry: registryFor(tool),
    call: {
      id: "call_email",
      name: tool.id,
      arguments: { to: "a@b.test", subject: "Hi", body: "Hello there" }
    },
    runtime: {
      pendingApprovals: {
        create(record) {
          approvals.push(record);
          return { approval_id: "appr_1" };
        }
      }
    },
    task: { task_id: "task_email" },
    toolContext: {}
  });

  assert.equal(result.success, false);
  assert.equal(result.metadata.waiting_approval, true);
  assert.equal(result.metadata.approval_id, "appr_1");
  assert.equal(executed, false);
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].sourceId, "task_email");
  assert.match(approvals[0].previewText, /a@b\.test/);
});

test("agentic approval preview formats common tool families", () => {
  assert.match(
    buildApprovalPreview({ id: "account_send_email" }, { to: ["a@b.test"], subject: "Hello", body: "Body text" }),
    /发送邮件.*a@b\.test/
  );
  assert.match(buildApprovalPreview({ id: "file_op" }, { operation: "delete", path: "E:/x.txt" }), /删除文件/);
  assert.match(buildApprovalPreview({ id: "launch_app" }, { app: "Excel" }), /启动应用: Excel/);
  assert.match(buildApprovalPreview({ id: "custom", name: "Custom" }, { a: 1 }), /Custom/);
});
