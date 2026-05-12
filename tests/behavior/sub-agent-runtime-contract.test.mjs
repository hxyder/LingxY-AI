import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSubAgentResultReport,
  createLinkedSubAgentCancellation,
  createSubAgentRunContract,
  createSubAgentRuntimeService,
  validateSubAgentBudgetUsage
} from "../../src/service/core/subagents/sub-agent-runtime-contract.mjs";
import { createInMemoryStoreScaffold } from "../../src/service/core/store/memory-store.mjs";
import { ensureRuntimeServices } from "../../src/service/core/task-runtime/runtime-services.mjs";

const parentTask = {
  task_id: "task_parent",
  conversation_id: "conv_1",
  user_command: "research and summarize"
};

const childTask = {
  task_id: "task_child",
  parent_task_id: "task_parent",
  conversation_id: "conv_1",
  user_command: "read the local evidence",
  status: "success",
  result_summary: "Read the assigned evidence."
};

const compiledContext = {
  schema_version: "1.0",
  selected: [
    {
      id: "ctx_allowed",
      kind: "attached_file",
      content: "allowed evidence"
    },
    {
      id: "ctx_forbidden",
      kind: "prior_message",
      content: "private parent-only context"
    }
  ],
  metrics: { selected_count: 2 }
};

function createEnabledContract(patch = {}) {
  return createSubAgentRunContract({
    config: { enabled: true },
    parentTask,
    childTask,
    parentCompiledContext: compiledContext,
    parentAllowedToolIds: ["read_file_text", "search_file_content", "web_search_fetch"],
    assignedScope: {
      scope_id: "scope_read",
      objective: "Read only the assigned file context.",
      context_item_ids: ["ctx_allowed"],
      allowed_tool_ids: ["read_file_text"],
      budget: {
        max_tool_calls: 1,
        max_prompt_tokens: 100,
        max_runtime_ms: 1000,
        max_context_items: 1
      }
    },
    delegation: {
      source: "planner_selected",
      planner_step_id: "plan_1",
      reason: "bounded evidence read"
    },
    now: "2026-05-12T00:00:00.000Z",
    ...patch
  });
}

test("sub-agent runtime contract is disabled unless explicitly feature-flagged", () => {
  const result = createSubAgentRunContract({
    parentTask,
    childTask,
    parentCompiledContext: compiledContext,
    parentAllowedToolIds: ["read_file_text"],
    assignedScope: {
      scope_id: "scope_read",
      context_item_ids: ["ctx_allowed"],
      allowed_tool_ids: ["read_file_text"]
    },
    delegation: { source: "planner_selected" }
  });

  assert.equal(result.enabled, false);
  assert.equal(result.reason, "feature_flag_disabled");
});

test("sub-agent runtime contract requires planner-selected delegation", () => {
  assert.throws(() => createEnabledContract({
    delegation: { source: "prompt_only", reason: "just ask another agent" }
  }), /planner_selected/u);
});

test("sub-agent runtime contract isolates context and allowed tools", () => {
  const contract = createEnabledContract();

  assert.equal(contract.enabled, true);
  assert.equal(contract.parent_task_id, "task_parent");
  assert.equal(contract.child_task_id, "task_child");
  assert.deepEqual(contract.allowed_tool_ids, ["read_file_text"]);
  assert.deepEqual(contract.assigned_scope.context_item_ids, ["ctx_allowed"]);
  assert.deepEqual(
    contract.isolated_compiled_context.selected.map((item) => item.id),
    ["ctx_allowed"]
  );
  assert.equal(
    contract.isolated_compiled_context.selected.some((item) => /private/u.test(item.content)),
    false
  );
  assert.equal(contract.cancellation_token.propagation, "parent_to_child");
});

test("sub-agent runtime contract rejects tool-surface escape", () => {
  assert.throws(() => createEnabledContract({
    assignedScope: {
      scope_id: "scope_escape",
      context_item_ids: ["ctx_allowed"],
      allowed_tool_ids: ["read_file_text", "write_file"]
    }
  }), /tool escape/u);
});

test("sub-agent runtime contract detects budget exhaustion", () => {
  const contract = createEnabledContract();
  const result = validateSubAgentBudgetUsage(contract, {
    tool_calls: 2,
    prompt_tokens: 101,
    runtime_ms: 1001,
    context_items: 2
  });

  assert.equal(result.ok, false);
  assert.equal(result.exhausted, true);
  assert.deepEqual(result.violations, [
    "tool_call_budget_exhausted",
    "prompt_token_budget_exhausted",
    "runtime_budget_exhausted",
    "context_item_budget_exhausted"
  ]);
});

test("sub-agent runtime contract propagates parent cancellation to child signal", () => {
  const parentController = new AbortController();
  const cancellation = createLinkedSubAgentCancellation({
    parentTaskId: "task_parent",
    childTaskId: "task_child",
    parentSignal: parentController.signal
  });

  assert.equal(cancellation.signal.aborted, false);
  parentController.abort(new Error("parent cancelled"));
  assert.equal(cancellation.signal.aborted, true);
  assert.match(cancellation.signal.reason.message, /parent cancelled/u);
  assert.equal(cancellation.token.status, "aborted");
});

test("sub-agent runtime report is structured and flags escaped tool calls", () => {
  const contract = createEnabledContract();
  const report = buildSubAgentResultReport({
    contract,
    childTask,
    events: [
      {
        event_type: "tool_call_completed",
        payload: { tool_id: "read_file_text", success: true }
      },
      {
        event_type: "tool_call_started",
        payload: { tool_id: "write_file" }
      }
    ],
    usage: { prompt_tokens: 50, runtime_ms: 100 }
  });

  assert.equal(report.parent_task_id, "task_parent");
  assert.equal(report.child_task_id, "task_child");
  assert.equal(report.status, "success");
  assert.equal(report.ok, false);
  assert.ok(report.violations.includes("tool_call_budget_exhausted"));
  assert.ok(report.violations.includes("tool_surface_escape:write_file"));
});

test("runtime services attach a service-owned sub-agent runtime contract service", () => {
  const runtime = {
    store: createInMemoryStoreScaffold(),
    queue: { snapshot() { return { queued: 0, running: 0 }; } },
    eventBus: { publish() {} },
    featureFlags: { subAgentRuntime: true }
  };

  ensureRuntimeServices(runtime);

  assert.equal(typeof runtime.subAgentRuntime.createRunContract, "function");
  const contract = runtime.subAgentRuntime.createRunContract({
    parentTask,
    childTask,
    parentCompiledContext: compiledContext,
    parentAllowedToolIds: ["read_file_text"],
    assignedScope: {
      scope_id: "scope_read",
      context_item_ids: ["ctx_allowed"],
      allowed_tool_ids: ["read_file_text"]
    },
    delegation: { source: "planner_selected" }
  });
  assert.equal(contract.enabled, true);

  const standalone = createSubAgentRuntimeService({ runtime });
  assert.equal(typeof standalone.buildResultReport, "function");
});
