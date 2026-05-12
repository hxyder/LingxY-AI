import assert from "node:assert/strict";
import test from "node:test";

import { createInMemoryStoreScaffold } from "../../src/service/core/store/memory-store.mjs";
import { ensureRuntimeServices } from "../../src/service/core/task-runtime/runtime-services.mjs";

function makeRuntime(overrides = {}) {
  return {
    store: createInMemoryStoreScaffold(),
    queue: {
      snapshot() { return { queued: 0, running: 0 }; },
      markFinished() {}
    },
    eventBus: { publish() {} },
    logsDir: null,
    toolContext: { outputDir: "out-dir" },
    ...overrides
  };
}

test("runtime services initializer creates missing singleton services", () => {
  const runtime = makeRuntime();

  const result = ensureRuntimeServices(runtime);

  assert.equal(result, runtime);
  assert.ok(runtime.activeExecutions instanceof Map);
  assert.equal(typeof runtime.actionToolRegistry?.call, "function");
  assert.equal(typeof runtime.metrics?.snapshot, "function");
  assert.equal(typeof runtime.securityBroker?.inspectContext, "function");
  assert.equal(typeof runtime.pendingApprovals?.create, "function");
});

test("runtime services initializer preserves caller-provided singletons", () => {
  const customRegistry = { get() {}, list() { return []; }, register() {}, evaluate() {}, async call() {} };
  const customMetrics = { snapshot() { return {}; } };
  const customSecurityBroker = { inspectContext() { return { allowed: true }; } };
  const customPendingApprovals = { create() {} };
  const runtime = makeRuntime({
    actionToolRegistry: customRegistry,
    metrics: customMetrics,
    securityBroker: customSecurityBroker,
    pendingApprovals: customPendingApprovals
  });

  ensureRuntimeServices(runtime);

  assert.equal(runtime.actionToolRegistry, customRegistry);
  assert.equal(runtime.metrics, customMetrics);
  assert.equal(runtime.securityBroker, customSecurityBroker);
  assert.equal(runtime.pendingApprovals, customPendingApprovals);
});

test("runtime services approval hook executes agent tool calls through the runtime registry", async () => {
  const calls = [];
  const runtime = makeRuntime({
    actionToolRegistry: {
      get(toolId) {
        if (toolId !== "demo_tool") return null;
        return {
          id: "demo_tool",
          async execute(args, ctx) {
            calls.push({ args, ctx });
            return { success: true, observation: "demo ok" };
          }
        };
      },
      list() { return []; },
      register() {},
      evaluate() {},
      async call() {}
    }
  });

  ensureRuntimeServices(runtime);
  runtime.store.insertTask({
    task_id: "task_origin",
    status: "partial_success",
    sub_status: "waiting_external_decision",
    progress: 0.5
  });
  const approval = runtime.pendingApprovals.create({
    sourceType: "agent_tool_call",
    sourceId: "task_origin",
    proposedAction: "execute",
    proposedTarget: "demo_tool",
    proposedParams: { value: 42 },
    metadata: { task_id: "task_origin", tool_id: "demo_tool" }
  });

  const result = await runtime.pendingApprovals.approve(approval.approval_id);

  assert.equal(result.executionResult.executed, true);
  assert.equal(result.executionResult.same_task_resume, true);
  assert.equal(result.executionResult.tool_id, "demo_tool");
  assert.equal(result.executionResult.success, true);
  assert.equal(result.executionResult.observation, "demo ok");
  assert.deepEqual(calls[0].args, { value: 42 });
  assert.equal(calls[0].ctx.runtime, runtime);
  assert.equal(calls[0].ctx.task.task_id, "task_origin");
  assert.equal(calls[0].ctx.outputDir, "out-dir");
});

test("runtime services approval hook replays deferred transcript context", async () => {
  const calls = [];
  const deferredTranscript = [{
    type: "tool_result",
    tool: "read_file_text",
    success: true,
    observation: "Indexed later.",
    metadata: { path: "E:\\docs\\later.md" }
  }];
  const runtime = makeRuntime({
    actionToolRegistry: {
      get(toolId) {
        if (toolId !== "index_file_content") return null;
        return {
          id: "index_file_content",
          async execute(args, ctx) {
            calls.push({ args, ctx });
            return { success: true, observation: `ctx:${ctx.transcript.length}` };
          }
        };
      },
      list() { return []; },
      register() {},
      evaluate() {},
      async call() {}
    }
  });

  ensureRuntimeServices(runtime);
  runtime.store.insertTask({
    task_id: "task_origin",
    status: "partial_success",
    sub_status: "waiting_external_decision",
    progress: 0.5
  });
  const approval = runtime.pendingApprovals.create({
    sourceType: "agent_tool_call",
    sourceId: "task_origin",
    proposedAction: "execute",
    proposedTarget: "index_file_content",
    proposedParams: { max_records: 5 },
    metadata: {
      task_id: "task_origin",
      tool_id: "index_file_content",
      deferred_tool_context: { transcript: deferredTranscript }
    }
  });

  const result = await runtime.pendingApprovals.approve(approval.approval_id);

  assert.equal(result.executionResult.success, true);
  assert.equal(result.executionResult.observation, "ctx:1");
  assert.deepEqual(calls[0].ctx.transcript, deferredTranscript);
});

test("runtime services approval hook reports missing agent tools without throwing", async () => {
  const runtime = makeRuntime({
    actionToolRegistry: {
      get() { return null; },
      list() { return []; },
      register() {},
      evaluate() {},
      async call() {}
    }
  });

  ensureRuntimeServices(runtime);
  runtime.store.insertTask({
    task_id: "task_origin",
    status: "partial_success",
    sub_status: "waiting_external_decision",
    progress: 0.5
  });
  const approval = runtime.pendingApprovals.create({
    sourceType: "agent_tool_call",
    sourceId: "task_origin",
    proposedAction: "execute",
    proposedTarget: "missing_tool",
    proposedParams: {},
    metadata: { task_id: "task_origin", tool_id: "missing_tool" }
  });

  const result = await runtime.pendingApprovals.approve(approval.approval_id);

  assert.deepEqual(result.executionResult, {
    same_task_resume: false,
    executed: false,
    reason: "tool_not_found",
    tool_id: "missing_tool"
  });
});
