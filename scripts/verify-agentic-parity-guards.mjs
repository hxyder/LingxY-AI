// UCA-181 follow-up: bring agentic/planner.mjs to parity with
// tool_using/agent-loop.mjs on three protective guards. The agentic
// path used to have only a soft prompt-banner for scheduled-fire
// recursion; this verifier asserts the hard equivalents are now in
// place.
//
// Tests:
//   1. Schedule-registry filter in agentic's tool list when the task
//      is a scheduler fire — LLM literally cannot see the ids.
//   2. Defense-in-depth: executeToolCall refuses fast (no approval
//      popup) when a hallucinated create_scheduled_task lands in
//      a scheduler-fire context.
//   3. Redundant side-effect block: a side-effect tool that already
//      succeeded in this run cannot be re-fired.

import assert from "node:assert/strict";

import { runAgenticPlanner } from "../src/service/executors/agentic/planner.mjs";

let pass = 0;
let fail = 0;
function check(label, condition) {
  if (condition) { pass += 1; console.log(`PASS  ${label}`); }
  else { fail += 1; console.log(`FAIL  ${label}`); }
}

// ---------------------------------------------------------------------
// A captured-prompt adapter — record the prompt + return a single
// final answer so the planner exits without a real LLM call.
// ---------------------------------------------------------------------
function makeCapturingAdapter() {
  const captured = { prompts: [], toolSchemas: [] };
  return {
    captured,
    adapter: {
      async generate({ messages, tools }) {
        captured.prompts.push(messages.map((m) => m.content).join("\n----\n"));
        captured.toolSchemas.push((tools ?? []).map((t) => t.name));
        return { text: "(stub final)", tool_calls: [], usage: {} };
      },
      streamGenerate: undefined
    }
  };
}

const fakeNotify = {
  id: "notify",
  name: "notify",
  description: "push toast",
  parameters: { type: "object", properties: {} },
  policy_group: null,
  risk_level: "low",
  requires_confirmation: false,
  async execute() { return { success: true, observation: "ok", metadata: {} }; }
};
const fakeCreateSchedule = {
  id: "create_scheduled_task",
  name: "create_scheduled_task",
  description: "schedule for later",
  parameters: { type: "object", properties: {} },
  policy_group: "schedule_create",
  risk_level: "high",
  requires_confirmation: true,
  async execute() { return { success: true, observation: "scheduled", metadata: {} }; }
};
const fakeMcpCreateSchedule = {
  id: "mcp_scheduler__create_scheduled_task",
  name: "[MCP] Scheduler: create_scheduled_task",
  description: "MCP schedule creation tool",
  parameters: { type: "object", properties: {} },
  risk_level: "medium",
  requires_confirmation: false,
  _mcpToolName: "create_scheduled_task",
  async execute() { return { success: true, observation: "mcp scheduled", metadata: {} }; }
};

function makeRegistry(tools) {
  const map = new Map(tools.map((t) => [t.id, t]));
  return {
    list: () => [...tools],
    get: (id) => map.get(id) ?? null
  };
}

function makeFireTask(command = "提醒用户交 timecard") {
  return {
    task_id: "task_fire_test",
    user_command: command,
    context_packet: {
      source_app: "uca.scheduler",
      capture_mode: "event",
      text: command,
      selection_metadata: { scheduled_task_fire: true }
    },
    task_spec: { user_goal_text: command, success_contract: { required_policy_groups: [] } },
    execution_mode: "interactive",
    executor_history: [],
    status: "running"
  };
}

function makeNonFireTask(command = "请提醒我每天 8 点喝水") {
  return {
    ...makeFireTask(command),
    context_packet: {
      source_app: "uca.console",
      capture_mode: "manual",
      text: command,
      selection_metadata: {}
    }
  };
}

// ---------------------------------------------------------------------
// 1. Scheduler-fire context: tool catalogue does NOT advertise
//    create_scheduled_task / delete_scheduled_task / pause_scheduled_task.
// ---------------------------------------------------------------------
{
  const { adapter, captured } = makeCapturingAdapter();
  const runtime = {
    actionToolRegistry: makeRegistry([fakeNotify, fakeCreateSchedule, fakeMcpCreateSchedule]),
    toolContext: {},
    pendingApprovals: { create: () => ({ approval_id: "appr_test" }) },
    eventBus: { publish: () => {} },
    store: { appendAuditLog: () => {}, appendEvent: () => {}, getTask: () => null, updateTask: () => {} }
  };
  await runAgenticPlanner({
    task: makeFireTask(),
    runtime,
    adapterOverride: adapter,
    maxIterations: 1
  });
  const promptText = captured.prompts[0] ?? "";
  // The banner legitimately mentions the tool name in prose ("Do NOT
  // call create_scheduled_task"), so checking for the bare token would
  // be a false negative. The hard signal is the tool catalogue block:
  // when the tool is filtered out, no `<tool id="create_scheduled_task">`
  // is rendered.
  check("scheduler-fire: prompt does NOT include the create_scheduled_task tool block",
    !/<tool id="create_scheduled_task">/.test(promptText));
  check("scheduler-fire: prompt still advertises notify tool block",
    /<tool id="notify">/.test(promptText));
  // Tool schema list passed to the adapter mirrors the same.
  const schemaIds = captured.toolSchemas[0] ?? [];
  check("scheduler-fire: tool schema list omits create_scheduled_task",
    !schemaIds.includes("create_scheduled_task"));
  check("scheduler-fire: prompt does NOT include MCP schedule-registry tool block",
    !/<tool id="mcp_scheduler__create_scheduled_task">/.test(promptText));
  check("scheduler-fire: tool schema list omits MCP schedule-registry tool",
    !schemaIds.includes("mcp_scheduler__create_scheduled_task"));
}

// ---------------------------------------------------------------------
// 2. Non-fire task: catalogue still INCLUDES create_scheduled_task.
// ---------------------------------------------------------------------
{
  const { adapter, captured } = makeCapturingAdapter();
  const runtime = {
    actionToolRegistry: makeRegistry([fakeNotify, fakeCreateSchedule]),
    toolContext: {},
    pendingApprovals: { create: () => ({ approval_id: "appr_test" }) },
    eventBus: { publish: () => {} },
    store: { appendAuditLog: () => {}, appendEvent: () => {}, getTask: () => null, updateTask: () => {} }
  };
  await runAgenticPlanner({
    task: makeNonFireTask(),
    runtime,
    adapterOverride: adapter,
    maxIterations: 1
  });
  const promptText = captured.prompts[0] ?? "";
  check("non-fire: prompt includes the create_scheduled_task tool block",
    /<tool id="create_scheduled_task">/.test(promptText));
}

// ---------------------------------------------------------------------
// 3. Defense-in-depth: hallucinated create_scheduled_task in a
//    scheduler-fire context is refused FAST without creating a
//    pending approval.
// ---------------------------------------------------------------------
{
  let approvalCreated = false;
  let toolExecuted = false;
  const fakeCreateScheduleTracking = {
    ...fakeCreateSchedule,
    async execute() {
      toolExecuted = true;
      return { success: true, observation: "should not run", metadata: {} };
    }
  };
  let plannerStep = 0;
  const adapter = {
    async generate() {
      plannerStep += 1;
      if (plannerStep === 1) {
        return {
          text: "",
          tool_calls: [{
            id: "call_1",
            name: "create_scheduled_task",
            arguments: { name: "x", trigger: {}, action: {} }
          }],
          usage: {}
        };
      }
      return { text: "(give up)", tool_calls: [], usage: {} };
    },
    streamGenerate: undefined
  };
  const runtime = {
    actionToolRegistry: makeRegistry([fakeNotify, fakeCreateScheduleTracking]),
    toolContext: {},
    pendingApprovals: {
      create: () => {
        approvalCreated = true;
        return { approval_id: "appr_test" };
      }
    },
    eventBus: { publish: () => {} },
    store: { appendAuditLog: () => {}, appendEvent: () => {}, getTask: () => null, updateTask: () => {} }
  };
  await runAgenticPlanner({
    task: makeFireTask(),
    runtime,
    adapterOverride: adapter,
    maxIterations: 3
  });
  check("hallucinated: tool.execute was NOT called", !toolExecuted);
  check("hallucinated: NO pending_approval was created", !approvalCreated);
}

// ---------------------------------------------------------------------
// 4. Redundant side-effect block: agentic refuses re-fires of a
//    side-effect tool that already succeeded.
// ---------------------------------------------------------------------
{
  const sideEffectTool = {
    id: "account_create_event",
    name: "account_create_event",
    description: "create event",
    parameters: { type: "object", properties: {} },
    // Real connector write tools rely on POLICY_GROUPS membership;
    // account_create_event currently has no local policy_group field
    // and is only medium risk, so this catches the real regression.
    risk_level: "medium",
    requires_confirmation: false, // skip approval gate in this test
    async execute(args) {
      sideEffectTool.__calls = (sideEffectTool.__calls ?? 0) + 1;
      return {
        success: true,
        observation: `event_${sideEffectTool.__calls}`,
        metadata: { tool_id: "account_create_event" }
      };
    }
  };
  let plannerStep = 0;
  const adapter = {
    async generate() {
      plannerStep += 1;
      if (plannerStep <= 3) {
        // Vary args slightly to bypass args-based dedupe.
        return {
          text: "",
          tool_calls: [{
            id: `c${plannerStep}`,
            name: "account_create_event",
            arguments: { title: "Lunch", description: `version ${plannerStep}` }
          }],
          usage: {}
        };
      }
      return { text: "done", tool_calls: [], usage: {} };
    },
    streamGenerate: undefined
  };
  const runtime = {
    actionToolRegistry: makeRegistry([sideEffectTool]),
    toolContext: {},
    pendingApprovals: { create: () => ({ approval_id: "appr_x" }) },
    eventBus: { publish: () => {} },
    store: { appendAuditLog: () => {}, appendEvent: () => {}, getTask: () => null, updateTask: () => {} }
  };
  await runAgenticPlanner({
    task: makeNonFireTask("create one calendar event"),
    runtime,
    adapterOverride: adapter,
    maxIterations: 6
  });
  check("redundant-block: side-effect tool ran exactly ONCE despite 3 planner attempts",
    sideEffectTool.__calls === 1);
}

console.log(`\n${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
