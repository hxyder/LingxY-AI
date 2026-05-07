#!/usr/bin/env node
/**
 * verify-schedule-name-priority.mjs — B1 in UPGRADE_PLAN.md
 *
 * Regression: task_f62f95d0 surfaced "send to A and B" as the schedule
 * title but the actual run only mailed A. Title was driven by the
 * LLM-emitted `args.name`, which had drifted away from the residual
 * command (`action.params.userCommand`) that plan-executor crafted.
 *
 * Fix (B1): in createSchedule(input, ...) the name decision must:
 *   1. prefer action.params.userCommand (faithful to actual action),
 *   2. fall back to input.name only when userCommand is absent,
 *   3. fall back to action.target / trigger.natural_language after that.
 * The schedule.metadata.naming_audit must record the unselected
 * candidates so drift is debuggable post-hoc.
 *
 * Frozen-name invariant scope (codex round-1 narrowed):
 *   - schedule.name is set once via pickScheduleName() at createSchedule
 *     time and never *re-derived* afterwards.
 *   - rescheduleSchedule() and other scheduler-engine methods MUST NOT
 *     touch schedule.name.
 *   - **Out of scope**: explicit user rename via
 *     `PATCH /schedule/{id} { name }` in scheduler-template-routes.mjs
 *     IS allowed. That path is intentional UI-driven editing and is
 *     guarded separately by the desktop_actor gate.
 */

import { createSchedulerRuntime } from "../src/service/scheduler/engine.mjs";

let passed = 0;
let failed = 0;
function check(label, condition) {
  if (condition) {
    console.log(`PASS  ${label}`);
    passed += 1;
  } else {
    console.log(`FAIL  ${label}`);
    failed += 1;
  }
}

function createMinimalRuntime() {
  const schedules = new Map();
  const auditLog = [];
  return {
    store: {
      listSchedules() { return Array.from(schedules.values()); },
      insertSchedule(schedule) { schedules.set(schedule.schedule_id, schedule); return schedule; },
      getSchedule(id) { return schedules.get(id) ?? null; },
      updateSchedule(id, patch) {
        const next = { ...(schedules.get(id) ?? {}), ...patch };
        schedules.set(id, next);
        return next;
      },
      deleteSchedule(id) { return schedules.delete(id); },
      appendAuditLog(entry) { auditLog.push(entry); }
    },
    eventBus: { emit() {}, on() {}, off() {} }
  };
}

const runtime = createMinimalRuntime();
const scheduler = createSchedulerRuntime({ runtime });

// ----------------------------------------------------------------------
// 1. params.userCommand wins over a misleading args.name.
// ----------------------------------------------------------------------
{
  const schedule = scheduler.createSchedule({
    name: "send to A and B",
    trigger: { type: "at", run_at: "2030-01-01T00:00:00Z" },
    action: {
      type: "task",
      target: "draft email",
      params: { userCommand: "Send the daily summary to A only" }
    }
  });
  check(
    "userCommand wins over LLM-emitted name (regression: drift on recipient count)",
    schedule.name === "Send the daily summary to A only"
  );
  check(
    "naming_audit selected_source = params.userCommand",
    schedule.metadata.naming_audit.selected_source === "params.userCommand"
  );
  check(
    "naming_audit records LLM-emitted name as unselected drift candidate",
    schedule.metadata.naming_audit.unselected_candidates.some(
      (entry) => entry.source === "input.name" && entry.value === "send to A and B"
    )
  );
}

// ----------------------------------------------------------------------
// 2. input.name is used only when params.userCommand is absent.
// ----------------------------------------------------------------------
{
  const schedule = scheduler.createSchedule({
    name: "Morning brief",
    trigger: { type: "at", run_at: "2030-01-01T00:00:00Z" },
    action: { type: "task", target: "summarise news" }
  });
  check(
    "input.name fallback fires when userCommand is absent",
    schedule.name === "Morning brief"
  );
  check(
    "naming_audit selected_source = input.name in fallback case",
    schedule.metadata.naming_audit.selected_source === "input.name"
  );
}

// ----------------------------------------------------------------------
// 3. action.target fallback when neither userCommand nor name set.
// ----------------------------------------------------------------------
{
  const schedule = scheduler.createSchedule({
    trigger: { type: "at", run_at: "2030-01-01T00:00:00Z" },
    action: { type: "task", target: "weekly review" }
  });
  check(
    "action.target fallback fires when name + userCommand absent",
    schedule.name === "Scheduled weekly review"
  );
}

// ----------------------------------------------------------------------
// 4. Long userCommand is truncated to 80 chars with ellipsis.
// ----------------------------------------------------------------------
{
  const longCommand = "A".repeat(100);
  const schedule = scheduler.createSchedule({
    trigger: { type: "at", run_at: "2030-01-01T00:00:00Z" },
    action: { type: "task", target: "x", params: { userCommand: longCommand } }
  });
  check(
    "long userCommand truncated to 80 chars with ellipsis",
    schedule.name.length === 78 && schedule.name.endsWith("…")
  );
}

// ----------------------------------------------------------------------
// 5. naming_audit preserves all rejected candidates.
// ----------------------------------------------------------------------
{
  const schedule = scheduler.createSchedule({
    name: "Title A",
    trigger: { type: "at", run_at: "2030-01-01T00:00:00Z", natural_language: "every morning" },
    action: {
      type: "task",
      target: "summarise",
      params: { userCommand: "Send daily summary at 09:00 to A only" }
    }
  });
  const audit = schedule.metadata.naming_audit;
  const sources = audit.unselected_candidates.map((c) => c.source);
  check(
    "naming_audit captures input.name + action.target + trigger.natural_language as unselected",
    sources.includes("input.name")
      && sources.includes("action.target")
      && sources.includes("trigger.natural_language")
  );
}

// ----------------------------------------------------------------------
// 6. Frozen invariant — schedule.name is set once at create time and
//    never changes from re-derivation later (rescheduleSchedule must
//    only touch trigger/next_run_at, never name).
// ----------------------------------------------------------------------
{
  const created = scheduler.createSchedule({
    name: "Frozen Title",
    trigger: { type: "at", run_at: "2030-01-01T00:00:00Z" },
    action: { type: "task", target: "x", params: { userCommand: "different command" } }
  });
  const refetched = scheduler.getSchedule(created.schedule_id);
  check(
    "schedule.name is preferred from userCommand at create-time and stays put",
    created.name === "different command" && refetched.name === created.name
  );
  scheduler.rescheduleSchedule(created.schedule_id, { type: "at", run_at: "2031-01-01T00:00:00Z" });
  const after = scheduler.getSchedule(created.schedule_id);
  check(
    "rescheduleSchedule must not re-derive or change name",
    after.name === created.name
  );
}

// ----------------------------------------------------------------------
// 7. Inherited metadata is preserved alongside naming_audit.
// ----------------------------------------------------------------------
{
  const schedule = scheduler.createSchedule({
    trigger: { type: "at", run_at: "2030-01-01T00:00:00Z" },
    action: { type: "task", target: "x", params: { userCommand: "something" } },
    metadata: { side_effect_contract: { kind: "preauthorized" } }
  });
  check(
    "createSchedule preserves caller-provided metadata",
    schedule.metadata.side_effect_contract?.kind === "preauthorized"
  );
  check(
    "naming_audit attached even when caller passes other metadata",
    Boolean(schedule.metadata.naming_audit)
  );
}

console.log(`\n${passed} pass / ${failed} fail`);
if (failed > 0) process.exit(1);
