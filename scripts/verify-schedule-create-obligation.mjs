// Phase B verifier: schedule_create as a first-class side-effect
// obligation. The four older obligations (email_send / calendar_create /
// file_upload, plus external_web_read) already line up across
// POLICY_GROUPS, the SR enum, task-spec's filter, the obligation
// evaluator, and the action-claim guard; this verifier asserts that
// schedule_create lands in all five places consistently and that the
// claim guard catches "已设置好提醒" / "scheduled successfully" without
// a real `create_scheduled_task` call.

import assert from "node:assert/strict";

import {
  POLICY_GROUPS,
  toolsInGroup,
  groupsOfTool
} from "../src/service/core/policy/policy-groups.mjs";
import {
  ACTION_OBLIGATION_GROUPS,
  evaluateActionObligations,
  buildActionObligationGuidance,
  formatWaitingActionFinal
} from "../src/service/core/policy/obligation-evaluator.mjs";
import {
  detectUnbackedActionClaims
} from "../src/service/core/policy/success-contract-validator.mjs";
import { REQUIRED_POLICY_GROUPS } from "../src/service/core/intent/semantic-router.mjs";

let pass = 0;
let fail = 0;
function check(label, condition) {
  if (condition) { pass += 1; console.log(`PASS  ${label}`); }
  else { fail += 1; console.log(`FAIL  ${label}`); }
}

// ---------------------------------------------------------------------
// 1. Alignment across the 5 layers.
// ---------------------------------------------------------------------
check("alignment: POLICY_GROUPS.schedule_create exists", Array.isArray(POLICY_GROUPS.schedule_create));
check("alignment: POLICY_GROUPS.schedule_create includes create_scheduled_task",
  POLICY_GROUPS.schedule_create?.includes("create_scheduled_task"));
check("alignment: toolsInGroup('schedule_create') is non-empty",
  toolsInGroup("schedule_create").length > 0);
check("alignment: groupsOfTool('create_scheduled_task') includes schedule_create",
  groupsOfTool("create_scheduled_task").includes("schedule_create"));
check("alignment: SR enum includes schedule_create",
  REQUIRED_POLICY_GROUPS.includes("schedule_create"));
check("alignment: ACTION_OBLIGATION_GROUPS includes schedule_create",
  ACTION_OBLIGATION_GROUPS.includes("schedule_create"));

// ---------------------------------------------------------------------
// 2. Claim guard catches "已设置好提醒" without a real tool call.
// ---------------------------------------------------------------------
{
  const finalText = "已为你设置好每天早上 8 点的提醒。";
  const violations = detectUnbackedActionClaims([], finalText);
  check("claim: '已设置好提醒' with empty transcript → schedule_create_claim_unsupported",
    violations.some((v) => v.kind === "schedule_create_claim_unsupported"));
}

{
  const finalText = "I've scheduled the reminder for tomorrow at 9am.";
  const violations = detectUnbackedActionClaims([], finalText);
  check("claim: 'I've scheduled the reminder' with empty transcript → schedule_create_claim_unsupported",
    violations.some((v) => v.kind === "schedule_create_claim_unsupported"));
}

// ---------------------------------------------------------------------
// 3. Successful create_scheduled_task call satisfies the claim.
// ---------------------------------------------------------------------
{
  const finalText = "已为你设置好每天 8 点的提醒。";
  const transcript = [
    {
      type: "tool_result",
      tool: "create_scheduled_task",
      success: true,
      observation: "Created schedule sched_xyz",
      metadata: { tool_id: "create_scheduled_task" }
    }
  ];
  const violations = detectUnbackedActionClaims(transcript, finalText);
  check("claim: real create_scheduled_task success satisfies the claim",
    violations.length === 0);
}

// ---------------------------------------------------------------------
// 4. Negation form ("提醒还没设置好") does not trigger.
// ---------------------------------------------------------------------
{
  const finalText = "我无法设置提醒：缺少触发时间。";
  const violations = detectUnbackedActionClaims([], finalText);
  check("negation: '无法设置提醒' is recognised as a negation",
    violations.length === 0);
}

// ---------------------------------------------------------------------
// 5. Obligation evaluator: required group with no successful call → pending.
// ---------------------------------------------------------------------
{
  const taskSpec = {
    success_contract: {
      required_policy_groups: ["schedule_create"]
    }
  };
  const obligations = evaluateActionObligations(taskSpec, []);
  check("evaluator: schedule_create with empty transcript → pending",
    obligations.length === 1
    && obligations[0].group === "schedule_create"
    && obligations[0].status === "pending");
}

// ---------------------------------------------------------------------
// 6. Successful tool call → satisfied.
// ---------------------------------------------------------------------
{
  const taskSpec = {
    success_contract: {
      required_policy_groups: ["schedule_create"]
    }
  };
  const transcript = [
    {
      type: "tool_result",
      tool: "create_scheduled_task",
      success: true,
      observation: "Created schedule sched_xyz",
      metadata: {}
    }
  ];
  const obligations = evaluateActionObligations(taskSpec, transcript);
  check("evaluator: schedule_create with successful tool call → satisfied",
    obligations[0]?.status === "satisfied");
}

// ---------------------------------------------------------------------
// 7. Pending approval → waiting_approval.
// ---------------------------------------------------------------------
{
  const taskSpec = {
    success_contract: {
      required_policy_groups: ["schedule_create"]
    }
  };
  const transcript = [
    {
      type: "pending_approval",
      tool: "create_scheduled_task",
      approval_id: "appr_sched_001",
      metadata: { approval: { approval_id: "appr_sched_001" } }
    }
  ];
  const obligations = evaluateActionObligations(taskSpec, transcript);
  check("evaluator: pending_approval → waiting_approval",
    obligations[0]?.status === "waiting_approval"
    && obligations[0]?.tool === "create_scheduled_task");
}

// ---------------------------------------------------------------------
// 8. Planner guidance + waiting-final messaging mention schedule_create.
// ---------------------------------------------------------------------
{
  const guidance = buildActionObligationGuidance([
    { group: "schedule_create", status: "pending", members: toolsInGroup("schedule_create") }
  ]);
  check("guidance: planner hint mentions create_scheduled_task",
    /create_scheduled_task/.test(guidance));
  check("guidance: planner hint mentions trigger / cron / natural_language",
    /trigger|cron|natural_language/i.test(guidance));
}

{
  const finalText = formatWaitingActionFinal({
    task: { user_command: "提醒我每天 8 点喝水" },
    obligation: {
      group: "schedule_create",
      status: "waiting_approval",
      approval: { approval_id: "appr_sched_002" }
    }
  });
  check("waiting-final: Chinese task → 定时任务创建 noun",
    /定时任务创建/.test(finalText));
  check("waiting-final: includes approval id",
    /appr_sched_002/.test(finalText));
}

// ---------------------------------------------------------------------
// 9. workflowMatchesActionGroup: connector_workflow_run does NOT
//    accidentally satisfy schedule_create.
// ---------------------------------------------------------------------
{
  const taskSpec = {
    success_contract: {
      required_policy_groups: ["schedule_create"]
    }
  };
  const transcript = [
    {
      type: "tool_result",
      tool: "connector_workflow_run",
      success: true,
      metadata: { connector_status: "success", workflow_id: "google.gmail.draft_confirm_send" }
    }
  ];
  const obligations = evaluateActionObligations(taskSpec, transcript);
  check("evaluator: a successful gmail workflow does NOT satisfy schedule_create",
    obligations[0]?.status === "pending");
}

console.log(`\n${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
