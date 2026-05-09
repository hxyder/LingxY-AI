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

test("agentic tool execution passes cancellation signal into tool context", async () => {
  const controller = new AbortController();
  let seenSignal = null;
  const tool = {
    id: "read_only_lookup",
    name: "Lookup",
    risk_level: "low",
    requires_confirmation: false,
    async execute(_args, context = {}) {
      seenSignal = context.signal ?? null;
      return {
        success: true,
        observation: "looked up",
        metadata: { ok: true }
      };
    }
  };

  const result = await executeAgenticToolCall({
    registry: registryFor(tool),
    call: { id: "call1", name: tool.id, arguments: { query: "x" } },
    toolContext: {},
    signal: controller.signal
  });

  assert.equal(result.success, true);
  assert.equal(seenSignal, controller.signal);
});

test("agentic tool execution aborts before running a tool", async () => {
  const controller = new AbortController();
  controller.abort();
  let executed = false;
  const tool = {
    id: "read_only_lookup",
    name: "Lookup",
    risk_level: "low",
    requires_confirmation: false,
    async execute() {
      executed = true;
      return { success: true, observation: "should not run" };
    }
  };

  await assert.rejects(
    () => executeAgenticToolCall({
      registry: registryFor(tool),
      call: { id: "call1", name: tool.id, arguments: {} },
      signal: controller.signal
    }),
    (error) => error?.code === "ABORT_ERR"
  );
  assert.equal(executed, false);
});

test("agentic tool execution rejects thin artifact outlines before execution", async () => {
  let executed = false;
  const tool = {
    id: "generate_document",
    name: "Generate Document",
    risk_level: "low",
    requires_confirmation: false,
    parameters: {
      type: "object",
      required: ["kind", "outline"],
      properties: {
        kind: { type: "string" },
        outline: {}
      }
    },
    async execute() {
      executed = true;
      return { success: true, observation: "generated" };
    }
  };

  const result = await executeAgenticToolCall({
    registry: registryFor(tool),
    call: {
      id: "call_doc",
      name: tool.id,
      arguments: {
        kind: "html",
        outline: {
          title: "Research Guide",
          sections: [{ heading: "Overview", body: "Too short." }]
        }
      }
    },
    task: {
      task_id: "task_rich_artifact",
      user_command: "调研公开资料，生成 HTML 报告",
      task_spec: {
        artifact: { required: true, kind: "html" },
        research_quality: { profile: "multi_source_research" }
      }
    },
    toolContext: {}
  });

  assert.equal(result.success, false);
  assert.equal(result.metadata.validation_error, true);
  assert.equal(result.metadata.artifact_preflight, true);
  assert.match(result.observation, /outline_quality_failed/);
  assert.equal(executed, false);
});

test("agentic artifact preflight repairs missing document kind from task contract", async () => {
  const calls = [];
  const tool = {
    id: "generate_document",
    name: "Generate Document",
    risk_level: "low",
    requires_confirmation: false,
    parameters: {
      type: "object",
      required: ["kind", "outline"],
      properties: {
        kind: { type: "string" },
        outline: {}
      }
    },
    async execute(args) {
      calls.push(args);
      return { success: true, observation: "generated", metadata: { tool_id: "generate_document" } };
    }
  };

  const result = await executeAgenticToolCall({
    registry: registryFor(tool),
    call: {
      id: "call_doc",
      name: tool.id,
      arguments: {
        outline: {
          title: "Report",
          sections: [{ heading: "Summary", body: "A concise report." }]
        }
      }
    },
    task: {
      task_id: "task_html_artifact",
      task_spec: {
        artifact: { required: true, kind: "html" }
      }
    },
    toolContext: {}
  });

  assert.equal(result.success, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, "html");
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

test("agentic tool execution stores deferred context for index approvals", async () => {
  const approvals = [];
  const tool = {
    id: "index_file_content",
    name: "Index File Content",
    risk_level: "high",
    requires_confirmation: true,
    async execute() {
      return { success: true, observation: "indexed" };
    }
  };

  const result = await executeAgenticToolCall({
    registry: registryFor(tool),
    call: {
      id: "call_index",
      name: tool.id,
      arguments: { max_records: 5 }
    },
    runtime: {
      pendingApprovals: {
        create(record) {
          approvals.push(record);
          return { approval_id: "appr_index" };
        }
      }
    },
    task: { task_id: "task_index" },
    transcript: [{
      role: "tool",
      name: "read_file_text",
      success: true,
      observation: "File content",
      metadata: { path: "E:\\docs\\indexed.md", content_extracted: true }
    }],
    toolContext: {}
  });

  assert.equal(result.metadata.waiting_approval, true);
  assert.equal(approvals.length, 1);
  assert.match(approvals[0].previewText, /indexed\.md/);
  assert.equal(approvals[0].metadata.deferred_tool_context.transcript.length, 1);
  assert.equal(approvals[0].metadata.deferred_tool_context.transcript[0].tool, "read_file_text");
});

test("agentic approval preview formats common tool families", () => {
  assert.match(
    buildApprovalPreview({ id: "account_send_email" }, { to: ["a@b.test"], subject: "Hello", body: "Body text" }),
    /发送邮件.*a@b\.test/
  );
  assert.match(buildApprovalPreview({ id: "file_op" }, { operation: "delete", path: "E:/x.txt" }), /删除文件/);
  assert.match(buildApprovalPreview({ id: "launch_app" }, { app: "Excel" }), /启动应用: Excel/);
  assert.match(
    buildApprovalPreview({ id: "index_file_content" }, {}, {
      deferredContext: {
        transcript: [{ metadata: { path: "E:/docs/index.md" } }]
      }
    }),
    /index\.md/
  );
  assert.match(buildApprovalPreview({ id: "custom", name: "Custom" }, { a: 1 }), /Custom/);
});
