// UCA-181 follow-up verifier:
//
// Wild bug: user typed "明天早上10点提醒我交timecard" in the chat
// console. Agent picked create_scheduled_task; the framework gate
// suspended on a pending approval; user clicked 通过. The resumed
// task then ran the tool, which IMMEDIATELY refused with "Cannot
// create a schedule from inside a scheduled task fire" — even
// though the user was at a desktop console, NOT inside a real
// scheduler fire.
//
// Root cause: two layers conspired:
//   1. scheduler/execute-action.mjs::executeActionTool defaulted
//      sourceApp to "uca.scheduler" when the caller (the approval
//      resume path) didn't pass one.
//   2. action_tools/tools/index.mjs::create_scheduled_task's
//      recursion guard checked only `source_app === "uca.scheduler"`.
//      That made every approval-resumed schedule-create look like a
//      scheduler-fired clone and got rejected.
//
// Framework fix:
//   - The recursion guard now keys off
//     `selection_metadata.scheduled_task_fire === true`, the precise
//     signal that buildSchedulerContextPacket sets only on true
//     fires.
//   - executeActionTool's default sourceApp is now "uca.approval"
//     so approval-resumed tasks no longer self-label as scheduler
//     fires. Scheduler dispatch still passes "uca.scheduler"
//     explicitly together with scheduled_task_fire metadata.

import assert from "node:assert/strict";

import { CREATE_SCHEDULED_TASK_TOOL } from "../src/service/action_tools/tools/index.mjs";

let pass = 0;
let fail = 0;
function check(label, condition) {
  if (condition) { pass += 1; console.log(`PASS  ${label}`); }
  else { fail += 1; console.log(`FAIL  ${label}`); }
}

function makeRuntimeWithSchedulerStub() {
  let lastCreated = null;
  return {
    runtime: {
      scheduler: {
        createSchedule(input) {
          lastCreated = input;
          return {
            schedule_id: `sched_test_${Math.random().toString(36).slice(2, 8)}`,
            next_run_at: input.trigger.run_at ?? null
          };
        }
      },
      paths: {}
    },
    getLastCreated: () => lastCreated
  };
}

const validArgs = {
  name: "提醒交 timecard",
  description: "明早10点提醒",
  trigger: { natural_language: "明天上午10:00" },
  action: {
    type: "task",
    target: "提醒交timecard",
    params: { userCommand: "提醒用户交 timecard" }
  },
  execution_mode: "single",
  catchup_policy: "skip"
};

// ---------------------------------------------------------------------
// 1. Real scheduler fire (selection_metadata.scheduled_task_fire=true)
//    → guard fires, schedule NOT created.
// ---------------------------------------------------------------------
{
  const { runtime, getLastCreated } = makeRuntimeWithSchedulerStub();
  const ctx = {
    runtime,
    task: {
      task_id: "task_real_fire",
      context_packet: {
        source_app: "uca.scheduler",
        selection_metadata: {
          source_id: "sched_real",
          trigger_reason: "scheduled",
          scheduler_context: true,
          scheduled_task_fire: true
        }
      }
    }
  };
  const result = await CREATE_SCHEDULED_TASK_TOOL.execute(validArgs, ctx);
  check("real-fire: guard rejects with success:false", result.success === false);
  check("real-fire: error code is scheduled_fire_cannot_reschedule",
    result.error === "scheduled_fire_cannot_reschedule");
  check("real-fire: scheduler.createSchedule was NOT called",
    getLastCreated() === null);
}

// ---------------------------------------------------------------------
// 2. Approval-resumed task (sourceApp could be anything but
//    scheduled_task_fire is NOT set) → guard does NOT fire,
//    schedule actually created. This is the user's chat-console flow.
// ---------------------------------------------------------------------
{
  const { runtime, getLastCreated } = makeRuntimeWithSchedulerStub();
  const ctx = {
    runtime,
    task: {
      task_id: "task_approval_resumed",
      context_packet: {
        // Even if sourceApp ends up as "uca.scheduler" through some
        // legacy code path, the absence of scheduled_task_fire keeps
        // the guard quiet.
        source_app: "uca.scheduler",
        selection_metadata: { source_id: "appr_xyz" }
      }
    }
  };
  const result = await CREATE_SCHEDULED_TASK_TOOL.execute(validArgs, ctx);
  check("approval-resumed: guard does NOT reject", result.success === true);
  check("approval-resumed: scheduler.createSchedule was called",
    getLastCreated() !== null);
  check("approval-resumed: createSchedule received our trigger",
    getLastCreated()?.trigger?.natural_language === "明天上午10:00");
}

// ---------------------------------------------------------------------
// 3. Fresh chat task (sourceApp="uca.console") → schedule created.
// ---------------------------------------------------------------------
{
  const { runtime, getLastCreated } = makeRuntimeWithSchedulerStub();
  const ctx = {
    runtime,
    task: {
      task_id: "task_fresh_chat",
      context_packet: {
        source_app: "uca.console",
        selection_metadata: {}
      }
    }
  };
  const result = await CREATE_SCHEDULED_TASK_TOOL.execute(validArgs, ctx);
  check("chat: console-originated task creates the schedule",
    result.success === true && getLastCreated() !== null);
}

// ---------------------------------------------------------------------
// 4. No selection_metadata at all → guard quiet.
// ---------------------------------------------------------------------
{
  const { runtime, getLastCreated } = makeRuntimeWithSchedulerStub();
  const ctx = {
    runtime,
    task: {
      task_id: "task_no_metadata",
      context_packet: {}
    }
  };
  const result = await CREATE_SCHEDULED_TASK_TOOL.execute(validArgs, ctx);
  check("no-metadata: missing selection_metadata does not falsely trigger guard",
    result.success === true && getLastCreated() !== null);
}

console.log(`\n${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
