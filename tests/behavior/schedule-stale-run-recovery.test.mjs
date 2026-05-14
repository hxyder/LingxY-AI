import assert from "node:assert/strict";
import test from "node:test";

import { createInMemoryStoreScaffold } from "../../src/service/core/store/memory-store.mjs";
import { createScheduleRecord, createScheduleRunRecord } from "../../src/service/scheduler/store.mjs";
import { recoverStaleScheduleRuns } from "../../src/service/scheduler/stale-runs.mjs";
import { createSchedulerRuntime } from "../../src/service/scheduler/engine.mjs";

function runtimeFixture() {
  const store = createInMemoryStoreScaffold();
  const runtime = {
    store,
    actionToolRegistry: { get() { return null; } }
  };
  runtime.scheduler = createSchedulerRuntime({ runtime });
  return runtime;
}

function insertSchedule(runtime, overrides = {}) {
  const schedule = createScheduleRecord({
    name: "Daily digest",
    trigger: { type: "cron", expression: "0 9 * * *", timezone: "UTC" },
    action: { type: "action_tool", target: "notify", params: { body: "digest" } },
    maxRuntimeSeconds: 60,
    now: "2026-05-14T08:00:00.000Z",
    ...overrides
  });
  schedule.schedule_id = overrides.schedule_id ?? "sched_stale";
  schedule.next_run_at = overrides.next_run_at ?? "2026-05-15T09:00:00.000Z";
  runtime.store.insertSchedule(schedule);
  return schedule;
}

test("stale triggered schedule run without task is closed as failed", () => {
  const runtime = runtimeFixture();
  const schedule = insertSchedule(runtime);
  const run = createScheduleRunRecord({
    scheduleId: schedule.schedule_id,
    triggerReason: "due",
    triggeredAt: "2026-05-14T09:00:00.000Z"
  });
  run.run_id = "run_missing_task";
  runtime.store.appendScheduleRun(run);

  const recovered = recoverStaleScheduleRuns({
    runtime,
    now: "2026-05-14T09:02:30.000Z"
  });

  assert.equal(recovered.length, 1);
  assert.equal(runtime.store.getScheduleRun(run.run_id).status, "failed");
  assert.match(runtime.store.getScheduleRun(run.run_id).error_message, /did not create a task/i);
  const nextSchedule = runtime.store.getSchedule(schedule.schedule_id);
  assert.equal(nextSchedule.last_run_status, "failed");
  assert.equal(nextSchedule.last_run_task_id, null);
  assert.equal(nextSchedule.failure_count, 1);
  assert.equal(nextSchedule.consecutive_failure_count, 1);
  assert.equal(nextSchedule.run_count, 1);
});

test("stale triggered schedule run with terminal task is reconciled to task status", () => {
  const runtime = runtimeFixture();
  const schedule = insertSchedule(runtime, { schedule_id: "sched_success" });
  runtime.store.insertTask({
    task_id: "task_success",
    created_at: "2026-05-14T09:00:10.000Z",
    updated_at: "2026-05-14T09:00:30.000Z",
    status: "success",
    intent: "agent",
    executor: "tool_using",
    user_command: "send digest",
    execution_mode: "unattended_safe",
    context_packet: {}
  });
  const run = createScheduleRunRecord({
    scheduleId: schedule.schedule_id,
    triggerReason: "due",
    triggeredAt: "2026-05-14T09:00:00.000Z",
    taskId: "task_success"
  });
  run.run_id = "run_success_task";
  runtime.store.appendScheduleRun(run);

  const recovered = recoverStaleScheduleRuns({
    runtime,
    now: "2026-05-14T09:02:30.000Z"
  });

  assert.equal(recovered.length, 1);
  assert.equal(runtime.store.getScheduleRun(run.run_id).status, "success");
  const nextSchedule = runtime.store.getSchedule(schedule.schedule_id);
  assert.equal(nextSchedule.last_run_status, "success");
  assert.equal(nextSchedule.last_run_task_id, "task_success");
  assert.equal(nextSchedule.failure_count, 0);
  assert.equal(nextSchedule.consecutive_failure_count, 0);
  assert.equal(nextSchedule.run_count, 1);
});

test("fresh triggered schedule run is not recovered early", () => {
  const runtime = runtimeFixture();
  const schedule = insertSchedule(runtime, { schedule_id: "sched_fresh" });
  const run = createScheduleRunRecord({
    scheduleId: schedule.schedule_id,
    triggerReason: "due",
    triggeredAt: "2026-05-14T09:00:00.000Z"
  });
  run.run_id = "run_fresh";
  runtime.store.appendScheduleRun(run);

  const recovered = recoverStaleScheduleRuns({
    runtime,
    now: "2026-05-14T09:00:30.000Z"
  });

  assert.equal(recovered.length, 0);
  assert.equal(runtime.store.getScheduleRun(run.run_id).status, "triggered");
  assert.equal(runtime.store.getSchedule(schedule.schedule_id).last_run_status, null);
});

test("scheduler list methods repair stale triggered runs before returning UI data", () => {
  const runtime = runtimeFixture();
  const schedule = insertSchedule(runtime, {
    schedule_id: "sched_ui",
    maxRuntimeSeconds: 1
  });
  const run = createScheduleRunRecord({
    scheduleId: schedule.schedule_id,
    triggerReason: "due",
    triggeredAt: "2000-01-01T00:00:00.000Z"
  });
  run.run_id = "run_ui";
  runtime.store.appendScheduleRun(run);

  const schedules = runtime.scheduler.listSchedules();
  const runs = runtime.scheduler.listScheduleRuns(schedule.schedule_id);

  assert.equal(schedules[0].last_run_status, "failed");
  assert.equal(runs[0].status, "failed");
});
