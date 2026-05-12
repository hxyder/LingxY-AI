import test from "node:test";
import assert from "node:assert/strict";

import {
  attachApprovalResumeMetadata,
  createApprovalResumeState,
  resolveApprovalResumeMetadata
} from "../../src/service/scheduler/approval-resume-state.mjs";
import { resumeAgentToolApprovalInOriginalTask } from "../../src/service/scheduler/approval-graph-resume.mjs";
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

test("generic agent tool approval resumes and terminalizes the original task without bridge events", async () => {
  const runtime = createRuntime();
  const calls = [];
  runtime.actionToolRegistry = {
    get(toolId) {
      assert.equal(toolId, "risky_fixture");
      return {
        async execute(args, context) {
          calls.push({ args, transcript: context.transcript, taskId: context.task?.task_id });
          return { success: true, observation: `resumed:${args.value}` };
        }
      };
    }
  };
  runtime.store.insertTask({
    task_id: "task_origin",
    status: "partial_success",
    sub_status: "waiting_external_decision",
    progress: 0.5
  });
  const service = createPendingApprovalService({
    runtime,
    executeApprovedAction: (approval, options) => resumeAgentToolApprovalInOriginalTask({
      runtime,
      approval,
      ...options
    })
  });

  const approval = service.create({
    sourceType: "agent_tool_call",
    sourceId: "task_origin",
    proposedAction: "action_tool",
    proposedTarget: "risky_fixture",
    proposedParams: { value: "original" },
    metadata: {
      task_id: "task_origin",
      tool_id: "risky_fixture",
      deferred_tool_context: {
        transcript: [{ type: "tool_result", tool: "read_file_text", observation: "context" }]
      }
    },
    createdAt: "2026-05-08T10:00:00.000Z"
  });

  const result = await service.approve(approval.approval_id, {
    actor: "desktop_console",
    decidedAt: "2026-05-08T10:02:00.000Z",
    overrides: { value: "edited" }
  });

  assert.equal(result.executionResult.same_task_resume, true);
  assert.equal(result.executionResult.task.task_id, "task_origin");
  assert.equal(result.approval.resulting_task_id, "task_origin");
  assert.equal(result.approval.metadata.approval_resume.state, "resumed");
  assert.deepEqual(calls, [{
    args: { value: "edited" },
    transcript: [{ type: "tool_result", tool: "read_file_text", observation: "context" }],
    taskId: "task_origin"
  }]);

  const task = runtime.store.getTask("task_origin");
  assert.equal(task.status, "success");
  assert.equal(task.sub_status, "completed");
  assert.equal(task.result_summary, "resumed:edited");

  const events = runtime.store.listEvents();
  assert.ok(events.some((event) =>
    event.event_type === "approval_resume_started"
    && event.payload.same_task_resume === true
    && event.payload.approval_id === approval.approval_id
  ));
  assert.ok(events.some((event) =>
    event.event_type === "tool_call_completed"
    && event.payload.same_task_resume === true
    && event.payload.success === true
  ));
  assert.ok(events.some((event) =>
    event.event_type === "success"
    && event.payload.same_task_resume === true
    && event.payload.approval_resume.state === "resumed"
  ));
  assert.equal(events.some((event) => event.payload?.bridged_from_approval === true), false);
});
