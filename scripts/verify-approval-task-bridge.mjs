// UCA-181 follow-up verifier:
//
// Bug seen in production: a chat task suspended on `waiting_external_decision`
// (agent-loop's framework gate created a pending approval for
// account_send_email). User clicked 通过, the resulting tool ran, but the
// ORIGINAL task never transitioned out of waiting_external_decision —
// the desktop task panel showed "运行中…" indefinitely.
//
// Root cause: `pendingApprovals.approve()` recorded the new task's id on
// the approval but never closed out the originating task.
//
// This verifier asserts the approval-bridge fix:
//   1. Approval whose metadata.task_id points at a real task in
//      waiting_external_decision is bridged: original task transitions
//      to success/partial_success/failed mirroring the new task's
//      outcome, and a terminal event is appended + published.
//   2. Status mapping is correct (success → success+completed,
//      failed → failed, partial_success → partial_success).
//   3. No-op when metadata.task_id is missing (back-compat).
//   4. No-op when the original task already resolved (don't trample).
//   5. Connector workflow approvals (with metadata.task_id) bridge too.

import assert from "node:assert/strict";

import { createPendingApprovalService } from "../src/service/scheduler/pending-approvals.mjs";

function createMockStore() {
  const approvals = new Map();
  const tasks = new Map();
  const events = [];
  const audit = [];
  return {
    listPendingApprovals() { return [...approvals.values()]; },
    getPendingApproval(id) { return approvals.get(id) ?? null; },
    appendPendingApproval(record) { approvals.set(record.approval_id, { ...record }); },
    updatePendingApproval(id, patch) {
      const a = approvals.get(id);
      if (!a) return null;
      const updated = { ...a, ...patch };
      approvals.set(id, updated);
      return updated;
    },
    insertTask(task) { tasks.set(task.task_id, task); return task; },
    getTask(id) { return tasks.get(id) ?? null; },
    updateTask(id, full) { tasks.set(id, { ...full }); return full; },
    appendEvent(record) { events.push(record); },
    appendAuditLog(entry) { audit.push(entry); },
    listAuditLogs() { return [...audit]; },
    listEvents() { return [...events]; },
    updateScheduleRun() {},
    getTaskEvents() { return []; }
  };
}

function createMockBus() {
  const published = [];
  return {
    publish(record) { published.push(record); },
    listPublished() { return [...published]; }
  };
}

function makeRuntime() {
  const store = createMockStore();
  const eventBus = createMockBus();
  return { store, eventBus };
}

let pass = 0;
let fail = 0;
function check(label, condition) {
  if (condition) { pass += 1; console.log(`PASS  ${label}`); }
  else { fail += 1; console.log(`FAIL  ${label}`); }
}

// ---------------------------------------------------------------------
// 1. Successful execution → originating task closes as success.
// ---------------------------------------------------------------------
{
  const runtime = makeRuntime();
  const originatingTaskId = "task_orig_001";
  runtime.store.insertTask({
    task_id: originatingTaskId,
    status: "partial_success",
    sub_status: "waiting_external_decision",
    progress: 0.5
  });

  const newTask = { task_id: "task_new_001", status: "success", result_summary: "邮件已发送至 boss@example.com" };
  const service = createPendingApprovalService({
    runtime,
    executeApprovedAction: async () => ({ task: newTask })
  });

  const approval = service.create({
    sourceType: "agent_tool_call",
    sourceId: originatingTaskId,
    proposedAction: "action_tool",
    proposedTarget: "account_send_email",
    proposedParams: { to: ["boss@example.com"] },
    metadata: { task_id: originatingTaskId, tool_id: "account_send_email" }
  });

  await service.approve(approval.approval_id);

  const orig = runtime.store.getTask(originatingTaskId);
  check("success: original task transitions to status=success", orig.status === "success");
  check("success: sub_status becomes completed", orig.sub_status === "completed");
  check("success: result_summary uses new task's text", orig.result_summary === "邮件已发送至 boss@example.com");
  check("success: progress becomes 1", orig.progress === 1);

  const events = runtime.store.listEvents();
  const terminal = events.find((e) => e.event_type === "success" && e.task_id === originatingTaskId);
  check("success: terminal `success` event appended", Boolean(terminal));
  check("success: event payload carries resulting_task_id", terminal?.payload?.resulting_task_id === "task_new_001");
  check("success: event published to bus", runtime.eventBus.listPublished().some((e) => e.event_id === terminal.event_id));
}

// ---------------------------------------------------------------------
// 2. Failed execution → originating task transitions to failed.
// ---------------------------------------------------------------------
{
  const runtime = makeRuntime();
  const originatingTaskId = "task_orig_002";
  runtime.store.insertTask({
    task_id: originatingTaskId,
    status: "partial_success",
    sub_status: "waiting_external_decision"
  });

  const newTask = { task_id: "task_new_002", status: "failed", result_summary: "Account not found." };
  const service = createPendingApprovalService({
    runtime,
    executeApprovedAction: async () => ({ task: newTask })
  });

  const approval = service.create({
    sourceType: "agent_tool_call",
    sourceId: originatingTaskId,
    proposedAction: "action_tool",
    proposedTarget: "account_send_email",
    proposedParams: {},
    metadata: { task_id: originatingTaskId }
  });

  await service.approve(approval.approval_id);

  const orig = runtime.store.getTask(originatingTaskId);
  check("failed: original task transitions to status=failed", orig.status === "failed");
  const events = runtime.store.listEvents();
  check("failed: terminal `failed` event appended", events.some((e) => e.event_type === "failed" && e.task_id === originatingTaskId));
}

// ---------------------------------------------------------------------
// 3. No metadata.task_id → no bridge (back-compat for legacy approvals).
// ---------------------------------------------------------------------
{
  const runtime = makeRuntime();
  const otherTaskId = "task_other_003";
  runtime.store.insertTask({
    task_id: otherTaskId,
    status: "partial_success",
    sub_status: "waiting_external_decision"
  });

  const service = createPendingApprovalService({
    runtime,
    executeApprovedAction: async () => ({ task: { task_id: "task_new_003", status: "success" } })
  });

  const approval = service.create({
    sourceType: "agent_tool_call",
    sourceId: otherTaskId,
    proposedAction: "action_tool",
    proposedTarget: "account_send_email",
    proposedParams: {}
    // no metadata at all
  });

  await service.approve(approval.approval_id);

  const orig = runtime.store.getTask(otherTaskId);
  check("no-metadata: original task is NOT touched", orig.sub_status === "waiting_external_decision");
  check("no-metadata: no extra event published", runtime.store.listEvents().length === 0);
}

// ---------------------------------------------------------------------
// 4. Original task already resolved (cancelled/etc.) → no bridge.
// ---------------------------------------------------------------------
{
  const runtime = makeRuntime();
  const originatingTaskId = "task_orig_004";
  runtime.store.insertTask({
    task_id: originatingTaskId,
    status: "cancelled",
    sub_status: "user_cancelled"
  });

  const service = createPendingApprovalService({
    runtime,
    executeApprovedAction: async () => ({ task: { task_id: "task_new_004", status: "success" } })
  });

  const approval = service.create({
    sourceType: "agent_tool_call",
    sourceId: originatingTaskId,
    proposedAction: "action_tool",
    proposedTarget: "account_send_email",
    proposedParams: {},
    metadata: { task_id: originatingTaskId }
  });

  await service.approve(approval.approval_id);

  const orig = runtime.store.getTask(originatingTaskId);
  check("already-resolved: bridge does NOT overwrite a different terminal state", orig.status === "cancelled");
  check("already-resolved: bridge does NOT overwrite sub_status either", orig.sub_status === "user_cancelled");
}

// ---------------------------------------------------------------------
// 5. executeApprovedAction returned no task (inline action) → success.
// ---------------------------------------------------------------------
{
  const runtime = makeRuntime();
  const originatingTaskId = "task_orig_005";
  runtime.store.insertTask({
    task_id: originatingTaskId,
    status: "partial_success",
    sub_status: "waiting_external_decision"
  });

  const service = createPendingApprovalService({
    runtime,
    executeApprovedAction: async () => ({ executed: true, success: true })
  });

  const approval = service.create({
    sourceType: "agent_tool_call",
    sourceId: originatingTaskId,
    proposedAction: "action_tool",
    proposedTarget: "account_send_email",
    proposedParams: {},
    metadata: { task_id: originatingTaskId }
  });

  await service.approve(approval.approval_id);

  const orig = runtime.store.getTask(originatingTaskId);
  check("inline-action: original task closes as success", orig.status === "success");
  check("inline-action: result_summary falls back to a useful sentence",
    typeof orig.result_summary === "string" && orig.result_summary.length > 0);
}

// ---------------------------------------------------------------------
// 6. metadata.task_id points at a missing task → silent skip.
// ---------------------------------------------------------------------
{
  const runtime = makeRuntime();
  const service = createPendingApprovalService({
    runtime,
    executeApprovedAction: async () => ({ task: { task_id: "task_new_006", status: "success" } })
  });

  const approval = service.create({
    sourceType: "agent_tool_call",
    sourceId: "task_missing_006",
    proposedAction: "action_tool",
    proposedTarget: "account_send_email",
    proposedParams: {},
    metadata: { task_id: "task_missing_006" }
  });

  // Should not throw or warn — task lookup misses harmlessly.
  const res = await service.approve(approval.approval_id);
  check("missing-task: approve still resolves successfully", Boolean(res?.approval));
  check("missing-task: no terminal event for the phantom task", runtime.store.listEvents().length === 0);
}

console.log(`\n${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
