import assert from "node:assert/strict";
import { createServiceBootstrap } from "../src/service/core/service-bootstrap.mjs";
import { buildPendingApprovalsViewModel } from "../src/desktop/console/pending-approvals/view-model.mjs";
import { buildSchedulesViewModel } from "../src/desktop/console/schedules/view-model.mjs";
import { parseNaturalLanguageTrigger } from "../src/service/scheduler/nl_to_cron.mjs";

const service = createServiceBootstrap();
const { runtime } = service;

assert.ok(runtime.scheduler);

const parsed = parseNaturalLanguageTrigger("每天 9 点提醒我喝水");
assert.equal(parsed.ok, true);
assert.equal(parsed.trigger.expression, "0 9 * * *");

const createResult = await runtime.actionToolRegistry.call("create_scheduled_task", {
  name: "Daily Reminder",
  trigger: {
    natural_language: "每天 9 点提醒我喝水",
    timezone: "Asia/Shanghai"
  },
  action: {
    type: "action_tool",
    target: "notify",
    params: {
      title: "Drink Water",
      body: "Scheduled reminder"
    }
  },
  execution_mode: "unattended_safe"
}, {
  runtime
});
assert.equal(createResult.success, true);
const scheduleId = createResult.metadata.schedule_id;
assert.ok(runtime.store.getSchedule(scheduleId));

const listResult = await runtime.actionToolRegistry.call("list_scheduled_tasks", {
  includeDisabled: true
}, {
  runtime
});
assert.equal(listResult.metadata.schedules.length >= 1, true);

const dispatchResult = await runtime.scheduler.dispatch(scheduleId, "manual");
assert.equal(dispatchResult.status, "success");
assert.equal(runtime.store.listScheduleRuns(scheduleId).length, 1);

const pauseResult = await runtime.actionToolRegistry.call("pause_scheduled_task", {
  schedule_id: scheduleId
}, {
  runtime
});
assert.equal(pauseResult.success, true);
assert.equal(runtime.store.getSchedule(scheduleId).enabled, false);

await runtime.actionToolRegistry.call("pause_scheduled_task", {
  schedule_id: scheduleId,
  enabled: true
}, {
  runtime
});
assert.equal(runtime.store.getSchedule(scheduleId).enabled, true);

const fileWatchSchedule = runtime.scheduler.createSchedule({
  name: "Inbox Watch",
  trigger: {
    type: "file_watch",
    path: "C:/Users/der/Desktop/inbox",
    events: ["add"],
    glob: "*.pdf"
  },
  action: {
    type: "action_tool",
    target: "notify",
    params: {
      title: "File Arrived",
      body: "paper.pdf"
    }
  }
});
const fileWatchResult = await runtime.scheduler.handleFileWatchEvent(fileWatchSchedule.schedule_id, {
  path: "C:/Users/der/Desktop/inbox/paper.pdf",
  event: "add"
});
assert.equal(fileWatchResult.status, "success");

const approvalSchedule = runtime.scheduler.createSchedule({
  name: "Send Daily Email",
  trigger: {
    type: "interval",
    seconds: 300
  },
  action: {
    type: "action_tool",
    target: "send_email_smtp",
    params: {
      to: ["ops@example.com"],
      subject: "Daily Report",
      body: "Queued schedule"
    }
  },
  executionMode: "approval_required"
});

const approvalRun1 = await runtime.scheduler.dispatch(approvalSchedule.schedule_id, "manual");
assert.equal(approvalRun1.status, "pending_approval");
const firstApprovalId = approvalRun1.approval.approval_id;
assert.equal(runtime.store.getPendingApproval(firstApprovalId).status, "pending");

const approvalRun2 = await runtime.scheduler.dispatch(approvalSchedule.schedule_id, "manual");
assert.equal(approvalRun2.status, "pending_approval");
assert.equal(runtime.store.getPendingApproval(firstApprovalId).status, "superseded");

const approvalResult = await runtime.scheduler.approvePendingApproval(approvalRun2.approval.approval_id, {
  actor: "tester"
});
assert.equal(approvalResult.approval.status, "approved");
assert.equal(Boolean(approvalResult.approval.resulting_task_id), true);
assert.equal(approvalResult.executionResult.task.status, "success");

const expiredApproval = runtime.pendingApprovals.create({
  sourceType: "schedule_trigger",
  sourceId: "sched_expired",
  proposedAction: "action_tool",
  proposedTarget: "notify",
  proposedParams: {
    title: "Expired",
    body: "Expired"
  },
  previewText: "Expired approval",
  createdAt: "2026-03-01T00:00:00.000Z"
});
const expired = runtime.scheduler.sweepExpiredApprovals({
  now: "2026-04-08T00:00:00.000Z"
});
assert.equal(expired.some((entry) => entry.approval_id === expiredApproval.approval_id), true);
assert.equal(runtime.store.getPendingApproval(expiredApproval.approval_id).status, "expired");

const misfireSchedule = runtime.scheduler.createSchedule({
  name: "Misfire Catchup",
  trigger: {
    type: "interval",
    seconds: 60
  },
  action: {
    type: "action_tool",
    target: "notify",
    params: {
      title: "Catchup",
      body: "Recovered run"
    }
  },
  catchupPolicy: "run_once"
});
const misfireRecord = runtime.store.getSchedule(misfireSchedule.schedule_id);
misfireRecord.last_run_at = "2026-04-08T08:00:00.000Z";
misfireRecord.next_run_at = "2026-04-08T08:01:00.000Z";
runtime.store.updateSchedule(misfireRecord.schedule_id, misfireRecord);
const recovered = await runtime.scheduler.recoverSchedules({
  now: "2026-04-08T08:05:00.000Z"
});
assert.equal(recovered.length >= 1, true);

const failingSchedule = runtime.scheduler.createSchedule({
  name: "Broken Schedule",
  trigger: {
    type: "interval",
    seconds: 60
  },
  action: {
    type: "action_tool",
    target: "non_existent_tool",
    params: {}
  }
});
await runtime.scheduler.dispatch(failingSchedule.schedule_id, "manual");
await runtime.scheduler.dispatch(failingSchedule.schedule_id, "manual");
await runtime.scheduler.dispatch(failingSchedule.schedule_id, "manual");
assert.equal(runtime.store.getSchedule(failingSchedule.schedule_id).enabled, false);

const schedulesVm = buildSchedulesViewModel(runtime.store.listSchedules(), runtime.store.listScheduleRuns());
assert.equal(schedulesVm.actions.includes("run_now"), true);
const pendingVm = buildPendingApprovalsViewModel(runtime.store.listPendingApprovals());
assert.equal(pendingVm.actions.includes("approve"), true);

const deleteResult = await runtime.actionToolRegistry.call("delete_scheduled_task", {
  schedule_id: scheduleId
}, {
  runtime
});
assert.equal(deleteResult.success, true);
assert.equal(runtime.store.getSchedule(scheduleId), null);

console.log("Scheduler, misfire, and pending approval verification passed.");
