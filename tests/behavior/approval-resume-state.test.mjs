import test from "node:test";
import assert from "node:assert/strict";

import {
  attachApprovalResumeMetadata,
  createApprovalResumeState,
  resolveApprovalResumeMetadata
} from "../../src/service/scheduler/approval-resume-state.mjs";
import { createPendingApprovalService } from "../../src/service/scheduler/pending-approvals.mjs";

function createMockStore() {
  const approvals = new Map();
  const tasks = new Map();
  const events = [];
  return {
    listPendingApprovals() { return [...approvals.values()]; },
    getPendingApproval(id) { return approvals.get(id) ?? null; },
    appendPendingApproval(record) { approvals.set(record.approval_id, { ...record }); },
    updatePendingApproval(id, patch) {
      const approval = approvals.get(id);
      if (!approval) return null;
      const updated = { ...approval, ...patch };
      approvals.set(id, updated);
      return updated;
    },
    insertTask(task) { tasks.set(task.task_id, task); },
    getTask(id) { return tasks.get(id) ?? null; },
    updateTask(id, full) { tasks.set(id, { ...full }); },
    appendEvent(record) { events.push(record); },
    listEvents() { return [...events]; },
    appendAuditLog() {},
    updateScheduleRun() {}
  };
}

function createRuntime() {
  const store = createMockStore();
  const published = [];
  return {
    store,
    eventBus: {
      publish(record) { published.push(record); },
      listPublished() { return [...published]; }
    }
  };
}

test("approval resume state moves from interrupted to resumed with a stable token", () => {
  const state = createApprovalResumeState({
    approvalId: "appr_1",
    taskId: "task_1",
    toolId: "account_send_email",
    createdAt: "2026-05-08T10:00:00.000Z"
  });

  assert.equal(state.state, "interrupted");
  assert.equal(state.resume_token, "approval:appr_1");

  const metadata = resolveApprovalResumeMetadata({ approval_resume: state }, {
    decision: "approved",
    decidedAt: "2026-05-08T10:01:00.000Z",
    actor: "user",
    resultingTaskId: "task_result"
  });

  assert.equal(metadata.approval_resume.state, "resumed");
  assert.equal(metadata.approval_resume.resume_token, "approval:appr_1");
  assert.equal(metadata.approval_resume.resulting_task_id, "task_result");
});

test("pending approval records and terminal bridge events carry approval resume metadata", async () => {
  const runtime = createRuntime();
  runtime.store.insertTask({
    task_id: "task_origin",
    status: "partial_success",
    sub_status: "waiting_external_decision",
    progress: 0.5
  });
  const service = createPendingApprovalService({
    runtime,
    executeApprovedAction: async () => ({
      task: {
        task_id: "task_resumed",
        status: "success",
        result_summary: "done"
      }
    })
  });

  const approval = service.create({
    sourceType: "agent_tool_call",
    sourceId: "task_origin",
    proposedAction: "action_tool",
    proposedTarget: "account_send_email",
    proposedParams: { to: ["user@example.com"] },
    metadata: { task_id: "task_origin", tool_id: "account_send_email" },
    createdAt: "2026-05-08T10:00:00.000Z"
  });

  assert.equal(approval.metadata.approval_resume.state, "interrupted");
  assert.equal(approval.metadata.approval_resume.resume_token, `approval:${approval.approval_id}`);

  await service.approve(approval.approval_id, {
    actor: "desktop_console",
    decidedAt: "2026-05-08T10:02:00.000Z"
  });

  const updated = service.get(approval.approval_id);
  assert.equal(updated.metadata.approval_resume.state, "resumed");
  assert.equal(updated.metadata.approval_resume.resulting_task_id, "task_resumed");

  const terminal = runtime.store.listEvents().find((event) => event.event_type === "success");
  assert.equal(terminal.payload.approval_resume.resume_token, `approval:${approval.approval_id}`);
  assert.equal(terminal.payload.approval_resume.state, "resumed");
});

test("approval resume metadata marks rejected decisions without a resulting task", () => {
  const metadata = attachApprovalResumeMetadata({
    task_id: "task_origin",
    tool_id: "calendar_create"
  }, {
    approvalId: "appr_reject",
    createdAt: "2026-05-08T10:00:00.000Z"
  });

  const rejected = resolveApprovalResumeMetadata(metadata, {
    decision: "rejected",
    actor: "user",
    decidedAt: "2026-05-08T10:03:00.000Z"
  });

  assert.equal(rejected.approval_resume.state, "rejected");
  assert.equal(rejected.approval_resume.resulting_task_id, null);
  assert.equal(rejected.approval_resume.resume_token, "approval:appr_reject");
});
