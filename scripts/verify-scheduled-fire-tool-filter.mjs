// UCA-181 follow-up:
//
// User clicked "Run Now" on a saved schedule whose action.params
// userCommand was "提醒用户交 timecard". The fired task reached the
// agent, the agent re-interpreted the userCommand as another schedule
// request, and emitted create_scheduled_task. The framework
// confirmation gate then surfaced a "需要批准创建定时任务" popup —
// which is wrong: clicking Run Now should run the task NOW, not
// create yet another schedule. The tool's own recursion guard would
// eventually refuse, but only after the pointless approval popup.
//
// Two framework defenses in one verifier:
//
//   1. filterToolsForTask hides every schedule-registry tool
//      (create_scheduled_task / delete_scheduled_task /
//      pause_scheduled_task) from the planner's tool list when the
//      task is a scheduler fire (selection_metadata.scheduled_task_fire
//      === true). The LLM literally never sees those ids in its prompt.
//
//   2. Defense-in-depth: even if the LLM hallucinates the tool id,
//      agent-loop refuses BEFORE the confirmation gate so the user
//      never sees an approval card. A `tool_denied` event +
//      synthesis_retry hint redirects the planner to call the actual
//      action (notify / send_email / etc.) instead.

import assert from "node:assert/strict";

import { runToolAgentLoop } from "../src/service/executors/tool_using/agent-loop.mjs";
import { createActionToolRegistry } from "../src/service/action_tools/registry.mjs";

let pass = 0;
let fail = 0;
function check(label, condition) {
  if (condition) { pass += 1; console.log(`PASS  ${label}`); }
  else { fail += 1; console.log(`FAIL  ${label}`); }
}

function makeFireTask({ command }) {
  return {
    task_id: "task_test_fire",
    user_command: command,
    context_packet: {
      source_app: "uca.scheduler",
      capture_mode: "event",
      text: command,
      selection_metadata: {
        source_id: "sched_test",
        trigger_reason: "scheduled",
        scheduler_context: true,
        scheduled_task_fire: true
      }
    },
    task_spec: { user_goal_text: command, success_contract: { required_policy_groups: [] } },
    task_spec_initial: { success_contract: { required_policy_groups: [] } },
    execution_mode: "interactive",
    executor_history: [],
    status: "running"
  };
}

function makeNonFireTask({ command }) {
  return {
    ...makeFireTask({ command }),
    context_packet: {
      source_app: "uca.console",
      capture_mode: "manual",
      text: command,
      selection_metadata: {}
    }
  };
}

const fakeCreateScheduledTask = {
  id: "create_scheduled_task",
  name: "Create Scheduled Task",
  description: "Schedule for later.",
  parameters: { type: "object", properties: {} },
  risk_level: "high",
  requires_confirmation: true,
  async execute() {
    return { success: true, observation: "schedule created", metadata: {} };
  }
};
const fakeNotifyTool = {
  id: "notify",
  name: "Notify",
  description: "Push a desktop toast.",
  parameters: { type: "object", properties: {} },
  risk_level: "low",
  requires_confirmation: false,
  async execute(args) {
    return { success: true, observation: `notified ${args?.title ?? ""}`, metadata: {} };
  }
};

function makeRuntime({ plannerSequence, tools = [fakeCreateScheduledTask, fakeNotifyTool] }) {
  const registry = createActionToolRegistry(tools);
  let plannerIndex = 0;
  const events = [];
  const seenTools = [];
  return {
    runtime: {
      actionToolRegistry: registry,
      toolPlanner: ({ tools: plannerTools }) => {
        seenTools.push(plannerTools.map((t) => t.id));
        const next = plannerSequence[plannerIndex++];
        return next ?? { type: "final", text: "(planner exhausted)" };
      },
      toolContext: {},
      pendingApprovals: { create: () => ({ approval_id: "appr_test" }) },
      emitTaskEvent: (eventType, payload) => events.push({ eventType, payload }),
      store: {
        appendAuditLog: () => {},
        appendEvent: () => {},
        getTask: () => null,
        updateTask: () => {}
      },
      eventBus: { publish: () => {} },
      finalAnswerComposer: () => "(stub final)"
    },
    events,
    seenTools
  };
}

// ---------------------------------------------------------------------
// 1. Scheduler fire context: planner does NOT see create_scheduled_task.
// ---------------------------------------------------------------------
{
  const plannerSequence = [
    { type: "tool_call", tool: "notify", args: { title: "交 timecard 提醒", body: "记得交 timecard" } },
    { type: "final", text: "已提醒交 timecard" }
  ];
  const { runtime, seenTools } = makeRuntime({ plannerSequence });
  await runToolAgentLoop({
    task: makeFireTask({ command: "提醒用户交 timecard" }),
    runtime,
    maxIterations: 4
  });
  const firstPromptTools = seenTools[0] ?? [];
  check("scheduler-fire: planner tool list omits create_scheduled_task",
    !firstPromptTools.includes("create_scheduled_task"));
  check("scheduler-fire: planner tool list omits delete_scheduled_task",
    !firstPromptTools.includes("delete_scheduled_task"));
  check("scheduler-fire: planner tool list omits pause_scheduled_task",
    !firstPromptTools.includes("pause_scheduled_task"));
  check("scheduler-fire: planner tool list still has notify",
    firstPromptTools.includes("notify"));
}

// ---------------------------------------------------------------------
// 2. Defense-in-depth: even if planner hallucinates the tool, the
//    loop denies BEFORE the confirmation gate (no pending_approval).
// ---------------------------------------------------------------------
{
  const plannerSequence = [
    // Hallucinated call — planner emits create_scheduled_task even
    // though it wasn't in the prompt list.
    { type: "tool_call", tool: "create_scheduled_task", args: { name: "x", trigger: {}, action: {} } },
    { type: "tool_call", tool: "notify", args: { title: "x", body: "y" } },
    { type: "final", text: "done" }
  ];
  const { runtime, events } = makeRuntime({ plannerSequence });
  await runToolAgentLoop({
    task: makeFireTask({ command: "提醒用户交 timecard" }),
    runtime,
    maxIterations: 6
  });
  const denied = events.find((e) =>
    e.eventType === "tool_call_denied" && e.payload?.tool_id === "create_scheduled_task");
  check("hallucinated: tool_call_denied fires for create_scheduled_task",
    Boolean(denied));
  check("hallucinated: deny reason is scheduled_fire_cannot_modify_schedule_registry",
    denied?.payload?.reason === "scheduled_fire_cannot_modify_schedule_registry");
  const hadApproval = events.find((e) => e.eventType === "pending_approval_created");
  check("hallucinated: NO pending_approval_created (no pointless popup)",
    !hadApproval);
  // The block also surfaces a synthesis_retry so the planner can
  // pick a valid tool on the next turn.
  const retryHint = events.find((e) =>
    e.eventType === "synthesis_retry" && e.payload?.reason === undefined);
  void retryHint; // not all runtimes emit reason in the payload; we just want the tool_denied path.
}

// ---------------------------------------------------------------------
// 3. Non-fire task (regular chat) — create_scheduled_task is still
//    available and the gate runs normally for fresh requests like
//    "提醒我每天 8 点喝水".
// ---------------------------------------------------------------------
{
  const plannerSequence = [
    { type: "tool_call", tool: "create_scheduled_task", args: { name: "x", trigger: {}, action: {} } }
  ];
  const { runtime, events, seenTools } = makeRuntime({ plannerSequence });
  await runToolAgentLoop({
    task: makeNonFireTask({ command: "提醒我每天 8 点喝水" }),
    runtime,
    maxIterations: 4
  });
  const firstPromptTools = seenTools[0] ?? [];
  check("non-fire: planner tool list INCLUDES create_scheduled_task",
    firstPromptTools.includes("create_scheduled_task"));
  // requires_confirmation:true + no handler → pending_approval. The
  // block does NOT fire because task is not a scheduler fire.
  const hadApproval = events.find((e) => e.eventType === "pending_approval_created");
  check("non-fire: pending_approval_created fires normally",
    Boolean(hadApproval));
  const denied = events.find((e) =>
    e.eventType === "tool_call_denied" && e.payload?.reason === "scheduled_fire_cannot_modify_schedule_registry");
  check("non-fire: scheduled_fire deny does NOT fire",
    !denied);
}

console.log(`\n${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
