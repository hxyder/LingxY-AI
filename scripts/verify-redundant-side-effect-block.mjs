// UCA-181 follow-up verifier:
//
// Wild bug: a single "create one calendar event" task created FOUR
// duplicate events. The agent's first call had a hallucinated
// accountId and the account-router error told it to retry. Each
// retry varied the description / attendee ordering enough to bypass
// the args-based dedupe (`tool::JSON.stringify(args)`), but each
// call still hit the real Google Calendar API, so 4 events landed.
//
// Framework fix: after a successful side-effect tool call (one that
// belongs to an action-obligation policy group OR has risk_level=high
// / requires_confirmation=true), the agent loop refuses further
// invocations of the SAME tool. The planner sees a `synthesis_retry`
// hint asking it to finalize from the existing result; if it ignores
// the hint past MAX_SYNTHESIS_RETRIES, the loop terminates with
// partial_success.
//
// This verifier exercises:
//   1. Successful create → second create call is blocked.
//   2. Failed first call → second call is allowed (retry on error
//      is legitimate).
//   3. Low-risk tool (e.g. web_search_fetch) is NOT blocked even
//      after a successful call — agents need to chain searches.
//   4. Block surfaces a `synthesis_retry` event with the right kind.

import assert from "node:assert/strict";

import { runToolAgentLoop } from "../src/service/executors/tool_using/agent-loop.mjs";
import { createActionToolRegistry } from "../src/service/action_tools/registry.mjs";

let pass = 0;
let fail = 0;
function check(label, condition) {
  if (condition) { pass += 1; console.log(`PASS  ${label}`); }
  else { fail += 1; console.log(`FAIL  ${label}`); }
}

function makeRuntime({ tool, plannerSequence }) {
  const registry = createActionToolRegistry([tool]);
  let plannerIndex = 0;
  const events = [];
  return {
    runtime: {
      actionToolRegistry: registry,
      toolPlanner: () => {
        const next = plannerSequence[plannerIndex++];
        if (!next) return { type: "final", text: "(planner exhausted)" };
        return next;
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
    callCount: () => tool.__callCount ?? 0
  };
}

function makeSideEffectTool({ id, group, alwaysSucceed = true } = {}) {
  let calls = 0;
  const tool = {
    id,
    name: id,
    description: "test side-effect tool",
    parameters: { type: "object", properties: {} },
    risk_level: "high",
    requires_confirmation: false, // skip approval gate in this harness
    policy_group: group,
    async execute(args) {
      calls += 1;
      tool.__callCount = calls;
      return alwaysSucceed
        ? { success: true, observation: `${id} created event_${calls}`, metadata: { tool_id: id } }
        : { success: false, observation: `${id} failed`, metadata: { tool_id: id } };
    }
  };
  return tool;
}

const baseTask = {
  task_id: "task_test_redundant",
  user_command: "create one calendar event",
  context_packet: { source_app: "uca.console", capture_mode: "manual", text: "create one calendar event" },
  task_spec: { user_goal_text: "create one calendar event", success_contract: { required_policy_groups: [] } },
  task_spec_initial: { success_contract: { required_policy_groups: [] } },
  execution_mode: "interactive",
  executor_history: [],
  status: "running"
};

// ---------------------------------------------------------------------
// 1. Successful side-effect tool → second call blocked, only ONE
//    real execution, synthesis_retry event surfaces.
// ---------------------------------------------------------------------
{
  const tool = makeSideEffectTool({ id: "account_create_event", group: "calendar_create" });
  // Slight arg variation so the args-based dedupe would NOT catch this.
  const plannerSequence = [
    { type: "tool_call", tool: "account_create_event", args: { title: "X", description: "ver1" } },
    { type: "tool_call", tool: "account_create_event", args: { title: "X", description: "ver2" } },
    { type: "tool_call", tool: "account_create_event", args: { title: "X", description: "ver3" } },
    { type: "final", text: "Event created." }
  ];
  const { runtime, events, callCount } = makeRuntime({ tool, plannerSequence });
  await runToolAgentLoop({ task: { ...baseTask }, runtime, maxIterations: 8 });
  check("redundant-block: side-effect tool ran exactly ONCE despite 3 planner attempts",
    callCount() === 1);
  const blockEvents = events.filter((e) => e.eventType === "synthesis_retry"
    && e.payload?.reason === "redundant_side_effect_call");
  check("redundant-block: surfaces a synthesis_retry event with reason=redundant_side_effect_call",
    blockEvents.length >= 1);
  check("redundant-block: synthesis_retry event names the offending tool",
    blockEvents.some((e) => e.payload?.tool_id === "account_create_event"));
}

// ---------------------------------------------------------------------
// 2. First call FAILS → second call is allowed (retry on error is
//    legitimate). The block only triggers on prior SUCCESS.
// ---------------------------------------------------------------------
{
  let calls = 0;
  const tool = {
    id: "account_create_event",
    name: "account_create_event",
    description: "fails first then succeeds",
    parameters: { type: "object", properties: {} },
    risk_level: "high",
    requires_confirmation: false,
    policy_group: "calendar_create",
    async execute() {
      calls += 1;
      tool.__callCount = calls;
      if (calls === 1) {
        return { success: false, observation: "ACCOUNT_NOT_FOUND", metadata: { tool_id: "account_create_event" } };
      }
      return { success: true, observation: `created event_${calls}`, metadata: { tool_id: "account_create_event" } };
    }
  };
  const plannerSequence = [
    { type: "tool_call", tool: "account_create_event", args: { accountId: "wrong" } },
    { type: "tool_call", tool: "account_create_event", args: { title: "X" } },
    { type: "final", text: "done" }
  ];
  const { runtime } = makeRuntime({ tool, plannerSequence });
  await runToolAgentLoop({ task: { ...baseTask }, runtime, maxIterations: 8 });
  check("retry-after-failure: failed first call does NOT block the retry",
    tool.__callCount === 2);
}

// ---------------------------------------------------------------------
// 3. Low-risk non-obligation tool: NOT blocked after success. Agents
//    must be able to chain web_search_fetch / read_clipboard / etc.
// ---------------------------------------------------------------------
{
  let calls = 0;
  const tool = {
    id: "test_low_risk_tool",
    name: "test_low_risk_tool",
    description: "low risk non-obligation tool",
    parameters: { type: "object", properties: {} },
    risk_level: "low",
    requires_confirmation: false,
    async execute() {
      calls += 1;
      tool.__callCount = calls;
      return { success: true, observation: `result_${calls}`, metadata: {} };
    }
  };
  const plannerSequence = [
    { type: "tool_call", tool: "test_low_risk_tool", args: { q: "first" } },
    { type: "tool_call", tool: "test_low_risk_tool", args: { q: "second" } },
    { type: "tool_call", tool: "test_low_risk_tool", args: { q: "third" } },
    { type: "final", text: "done" }
  ];
  const { runtime } = makeRuntime({ tool, plannerSequence });
  await runToolAgentLoop({ task: { ...baseTask }, runtime, maxIterations: 8 });
  check("low-risk: low-risk non-obligation tool is NOT blocked after success",
    tool.__callCount === 3);
}

console.log(`\n${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
