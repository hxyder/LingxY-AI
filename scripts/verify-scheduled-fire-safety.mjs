#!/usr/bin/env node
/**
 * verify-scheduled-fire-safety.mjs — UCA-096 regression coverage.
 *
 * Covers two bugs reported from real desktop usage:
 *
 *  1. `create_scheduled_task` crashed with "NOT NULL constraint failed:
 *     schedules.name" when the LLM omitted `name` from its arguments.
 *     Fix: scheduler engine derives a fallback name from userCommand /
 *     action.target / trigger.natural_language.
 *
 *  2. A scheduled task like "提醒我喝水" would fire, run through the tool-using
 *     agent, and the LLM would re-interpret its own userCommand as a NEW
 *     scheduling request — building an infinite chain of self-clones.
 *     Fix A (prompt): when selection_metadata.scheduled_task_fire === true,
 *     the planner prompt tells the LLM to execute the action directly.
 *     Fix B (defense in depth): the CREATE_SCHEDULED_TASK_TOOL short-circuits
 *     with a failure result when called from inside a scheduler-fire task.
 */

import assert from "node:assert/strict";
import { createServiceBootstrap } from "../src/service/core/service-bootstrap.mjs";
import { CREATE_SCHEDULED_TASK_TOOL } from "../src/service/capabilities/tools/scheduler-tools.mjs";
import { buildAgenticSystemPrompt } from "../src/service/executors/agentic/prompt-builder.mjs";
import { dispatchSchedule, isScheduleInFlight } from "../src/service/scheduler/dispatch.mjs";

const service = createServiceBootstrap();
const { runtime } = service;

// ── Bug 1: name derived when caller omits it ──────────────────────────────
{
  const schedule = runtime.scheduler.createSchedule({
    trigger: { type: "at", run_at: new Date(Date.now() + 60_000).toISOString() },
    action: {
      type: "task",
      target: "create_meeting_event",
      params: { userCommand: "新建日历事件叫例会，持续30分钟" }
    }
  });
  assert.ok(schedule.schedule_id, "scheduler.createSchedule should return a record");
  assert.equal(typeof schedule.name, "string");
  assert.ok(schedule.name.trim().length > 0, "name must not be empty");
  assert.ok(
    schedule.metadata?.naming_audit?.title_policy,
    "name derivation should record the schedule title policy audit"
  );
}

{
  const schedule = runtime.scheduler.createSchedule({
    trigger: { type: "interval", seconds: 120 },
    action: { type: "action_tool", target: "notify", params: { title: "x", body: "y" } }
  });
  assert.ok(schedule.name, "action.target should produce a name");
  assert.ok(
    schedule.metadata?.naming_audit?.title_policy,
    "action.target fallback should still record the schedule title policy audit"
  );
}

// ── Bug 3a: tool refuses to reschedule when called inside scheduler fire ──
{
  const schedulerContextPacket = {
    source_app: "uca.scheduler",
    source_type: "window",
    selection_metadata: { scheduled_task_fire: true }
  };
  const ctx = {
    runtime,
    task: {
      task_id: "task_test_fire",
      context_packet: schedulerContextPacket
    }
  };
  const result = await CREATE_SCHEDULED_TASK_TOOL.execute({
    trigger: { natural_language: "5 分钟后" },
    action: { type: "task", target: "notify", params: { userCommand: "提醒我喝水" } }
  }, ctx);
  assert.equal(result.success, false, "tool must refuse from scheduler fire");
  assert.equal(result.error, "scheduled_fire_cannot_reschedule");
}

// ── Bug 3b: normal (non-fire) calls still work ───────────────────────────
{
  const ctx = {
    runtime,
    task: {
      task_id: "task_user_submitted",
      context_packet: { source_app: "uca.overlay", source_type: "window" }
    }
  };
  const result = await CREATE_SCHEDULED_TASK_TOOL.execute({
    trigger: { natural_language: "10 分钟后" },
    action: { type: "task", target: "notify", params: { userCommand: "test reminder" } }
  }, ctx);
  assert.equal(result.success, true, "user-originated schedule creation should still succeed");
  assert.ok(result.metadata?.schedule_id);
}

// ── Bug 3c: the scheduler-fire instruction fires on the right marker ─────
{
  const { default: fs } = await import("node:fs");
  const source = fs.readFileSync(
    new URL("../src/service/executors/tool_using/agent-loop.mjs", import.meta.url),
    "utf8"
  );
  assert.ok(
    /const scheduledFireInstruction = isScheduledFireTask\(task\)/.test(source),
    "agent-loop must detect the scheduled_task_fire marker, including manual Run Now"
  );
  assert.ok(
    /SCHEDULED-FIRE CONTEXT/.test(source),
    "agent-loop must inject SCHEDULED-FIRE CONTEXT guidance"
  );
  assert.ok(
    /Do NOT call create_scheduled_task/i.test(source),
    "guidance must explicitly forbid create_scheduled_task"
  );
}

// ── Bug B (UCA-098): agentic prompt also carries scheduled-fire banner ──
{
  const scheduledTask = {
    user_command: "提醒我喝水",
    context_packet: {
      source_app: "uca.console.desktop",
      source_type: "window",
      selection_metadata: { scheduled_task_fire: true }
    }
  };
  const promptScheduled = buildAgenticSystemPrompt({
    tools: [], skills: [], task: scheduledTask, requestedFormat: null, language: "auto"
  });
  assert.ok(
    /Scheduled-fire context/i.test(promptScheduled),
    "agentic prompt should include Scheduled-fire banner for uca.scheduler"
  );
  assert.ok(
    /Do NOT call `?create_scheduled_task/i.test(promptScheduled),
    "agentic banner must forbid create_scheduled_task"
  );

  const normalTask = {
    user_command: "hello",
    context_packet: { source_app: "uca.overlay", source_type: "window" }
  };
  const promptNormal = buildAgenticSystemPrompt({
    tools: [], skills: [], task: normalTask, requestedFormat: null, language: "auto"
  });
  assert.ok(
    !/Scheduled-fire context/i.test(promptNormal),
    "non-scheduler tasks must NOT see the scheduled-fire banner"
  );
}

// ── Bug C (Run Now): reminder task fires notify directly, not calendar. ──
{
  const reminderSvc = createServiceBootstrap();
  const reminderRuntime = reminderSvc.runtime;
  const target = reminderRuntime.scheduler.createSchedule({
    name: "Scheduled: 提醒我交timecard",
    trigger: { type: "at", run_at: new Date(Date.now() - 1000).toISOString() },
    action: {
      type: "task",
      target: "提醒我交timecard",
      params: {
        userCommand: "提醒我交timecard",
        contextText: "提醒我明天下午4点交timecard"
      }
    }
  });
  const result = await dispatchSchedule({
    runtime: reminderRuntime,
    scheduleId: target.schedule_id,
    reason: "manual",
    triggerPayload: { source: "desktop_console", bypassDedupe: true }
  });
  assert.equal(result.status, "success", "manual Run Now reminder should complete through notify");
  const events = reminderRuntime.store.getTaskEvents(result.task.task_id);
  assert.ok(
    events.some((event) =>
      event.event_type === "tool_call_completed"
      && event.payload?.tool_id === "notify"
      && event.payload?.success === true
    ),
    "manual Run Now reminder should call notify"
  );
  assert.ok(
    !events.some((event) => event.event_type === "pending_approval_created"),
    "manual Run Now reminder must not create approval"
  );
  assert.ok(
    !events.some((event) =>
      event.event_type === "tool_call_completed"
      && event.payload?.tool_id === "connector_workflow_run"
    ),
    "manual Run Now reminder must not route to connector workflows"
  );
}

{
  const { default: fs } = await import("node:fs");
  const consoleSource = fs.readFileSync(
    new URL("../src/desktop/renderer/console.js", import.meta.url),
    "utf8"
  );
  assert.ok(
    /function taskAlreadyDisplayedNotify\(events = \[\]\)/.test(consoleSource),
    "console Run Now watcher should detect notify-backed reminder runs"
  );
  assert.ok(
    /if \(taskAlreadyDisplayedNotify\(events\)\) return;/.test(consoleSource),
    "console Run Now watcher must not show a generic completion card after notify"
  );
  const fireNoticeStart = consoleSource.indexOf("function fireScheduleRunCompletionNotice");
  const fireNoticeEnd = consoleSource.indexOf("function taskAlreadyDisplayedNotify", fireNoticeStart);
  const fireNoticeSource = consoleSource.slice(fireNoticeStart, fireNoticeEnd);
  const popupIndex = fireNoticeSource.indexOf("showPopupCard?.");
  const notifyIndex = fireNoticeSource.indexOf("notify?.");
  assert.ok(popupIndex >= 0, "schedule Run Now completion should use one direct popup card");
  assert.ok(notifyIndex > popupIndex, "notify must be fallback-only after direct popup card");
  assert.ok(
    /if \(!popupShown\)/.test(fireNoticeSource),
    "schedule Run Now completion notify path must be gated behind popup fallback"
  );
  assert.ok(
    /artifactPath:\s*copy\.artifactPath/.test(fireNoticeSource)
      && /mime:\s*copy\.mime/.test(fireNoticeSource)
      && /inlinePreview:\s*copy\.inlinePreview/.test(fireNoticeSource),
    "schedule Run Now artifact completions must forward artifact metadata to popup/notify actions"
  );
}

// ── Bug A (UCA-098): dispatch locks the schedule in-flight ──
{
  const fireSvc = createServiceBootstrap();
  const fireRuntime = fireSvc.runtime;
  // Stub executeProposedAction inside executeScheduledTask via a fake
  // action_tool schedule that simply resolves after a short delay. We go
  // through scheduler.createSchedule + dispatchSchedule so the lock logic
  // actually runs.
  const target = fireRuntime.scheduler.createSchedule({
    name: "test lock",
    trigger: { type: "at", run_at: new Date(Date.now() + 60_000).toISOString() },
    action: { type: "action_tool", target: "notify", params: { title: "x", body: "y" } }
  });
  const dueTarget = fireRuntime.store.getSchedule(target.schedule_id);
  dueTarget.trigger_config.run_at = new Date(Date.now() - 1000).toISOString();
  dueTarget.next_run_at = dueTarget.trigger_config.run_at;
  dueTarget.enabled = true;
  fireRuntime.store.updateSchedule(dueTarget.schedule_id, dueTarget);
  assert.ok(!isScheduleInFlight(target.schedule_id), "schedule should not be in-flight before dispatch");

  // Kick off first dispatch (don't await yet) — should claim the lock.
  const firstDispatch = dispatchSchedule({
    runtime: fireRuntime,
    scheduleId: target.schedule_id,
    reason: "due"
  });
  assert.ok(isScheduleInFlight(target.schedule_id), "schedule must be in-flight while dispatch awaits");

  // A concurrent second dispatch must be rejected as null.
  const secondDispatch = await dispatchSchedule({
    runtime: fireRuntime,
    scheduleId: target.schedule_id,
    reason: "due"
  });
  assert.equal(secondDispatch, null, "concurrent dispatch for same schedule must no-op");

  await firstDispatch;
  assert.ok(!isScheduleInFlight(target.schedule_id), "lock must release after dispatch finishes");

  // next_run_at should have been advanced synchronously; for a one-shot
  // `at` trigger with past run_at, next is null.
  const after = fireRuntime.store.getSchedule(target.schedule_id);
  assert.equal(after.next_run_at, null, "past at-trigger should have next_run_at cleared");
}

console.log("ok verify-scheduled-fire-safety");
