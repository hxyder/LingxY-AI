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
 *     Fix A (prompt): when context_packet.source_app === "uca.scheduler",
 *     the planner prompt tells the LLM to execute the action directly.
 *     Fix B (defense in depth): the CREATE_SCHEDULED_TASK_TOOL short-circuits
 *     with a failure result when called from inside a scheduler-fire task.
 */

import assert from "node:assert/strict";
import { createServiceBootstrap } from "../src/service/core/service-bootstrap.mjs";
import { CREATE_SCHEDULED_TASK_TOOL } from "../src/service/action_tools/tools/index.mjs";

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
    schedule.name.includes("新建日历事件") || schedule.name.includes("例会"),
    `expected name to carry userCommand, got: ${schedule.name}`
  );
}

{
  const schedule = runtime.scheduler.createSchedule({
    trigger: { type: "interval", seconds: 120 },
    action: { type: "action_tool", target: "notify", params: { title: "x", body: "y" } }
  });
  assert.ok(schedule.name, "action.target should produce a name");
  assert.ok(/notify/i.test(schedule.name), `name should mention target: ${schedule.name}`);
}

// ── Bug 3a: tool refuses to reschedule when called inside scheduler fire ──
{
  const schedulerContextPacket = {
    source_app: "uca.scheduler",
    source_type: "window"
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
    /source_app === "uca\.scheduler"/.test(source),
    "agent-loop must detect uca.scheduler source_app"
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

console.log("ok verify-scheduled-fire-safety");
