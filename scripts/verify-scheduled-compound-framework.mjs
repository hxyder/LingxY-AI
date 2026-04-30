#!/usr/bin/env node
/**
 * Verifies the framework-level fix for scheduled compound tasks:
 * - scheduler context text is not treated as a local selection
 * - connector intent does not automatically forbid open-web research
 * - SemanticRouter can express execution contracts such as email_send
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { createTaskSpec } from "../src/service/core/task-spec.mjs";
import { classifyContextSources } from "../src/service/core/intent/context-sources.mjs";
import { validateSuccessContract } from "../src/service/core/policy/success-contract-validator.mjs";
import { shouldInjectRequiredActionGuidance } from "../src/service/executors/tool_using/agent-loop.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

const marketEmailDecision = {
  source_scope: "external_world",
  web_policy: "required",
  output_kind: "conversation",
  artifact_required: false,
  executor: "tool_using",
  research_depth: "multi_source",
  primary_intent: "email_calendar_action",
  domain: "finance",
  user_goal: "Collect a current market summary and send it by email.",
  expected_output: "execution",
  needs_external_info: true,
  needs_current_information: true,
  needs_user_files: false,
  needs_tool_use: true,
  needed_capabilities: ["external_web_read", "email_calendar_action"],
  required_policy_groups: ["external_web_read", "email_send"],
  source_mode: "multi_source_research",
  complexity: "medium",
  risk_level: "high",
  confidence: 0.91,
  rationale_summary: "Needs current external market evidence, then an email send action.",
  reason: "Compound research plus connector action."
};

const scheduledContext = {
  text: "5 分钟后给我发美股汇总到 user-a@example.com",
  source_app: "uca.scheduler",
  selection_metadata: {
    source_id: "sched_test",
    trigger_reason: "scheduled",
    scheduler_context: true
  },
  semantic_router_decision: marketEmailDecision
};

{
  const sources = classifyContextSources({
    text: "发美股汇总到 user-a@example.com",
    contextPacket: scheduledContext
  });
  assert.equal(sources.real_selection, false, "scheduled contextText must not become a local selection");
}

{
  const spec = createTaskSpec("发美股汇总到 user-a@example.com", scheduledContext, {});
  assert.equal(spec.connector_domain, true, "SR capability should keep connector tools in scope");
  assert.equal(spec.tool_policy.policy_groups.external_web_read.mode, "required");
  assert.deepEqual(spec.success_contract.required_policy_groups.sort(), ["email_send", "external_web_read"]);
  assert.equal(spec.research_quality.profile, "multi_source_research");
  assert.equal(spec.constraints.must_use_tools, true);
}

{
  const spec = createTaskSpec("整理今天新闻后发送邮件到 user-a@example.com和user-b@example.com", {
    source_app: "uca.scheduler",
    selection_metadata: {
      source_id: "sched_sr_timeout",
      trigger_reason: "scheduled",
      scheduler_context: true
    },
    semantic_router_rejection: { kind: "rejection", code: "timeout", reason: "test timeout" }
  }, {});
  assert.equal(spec.routing_status, "sr_timeout");
  assert.equal(spec.routing_degraded, true);
  assert.ok(
    spec.success_contract.required_policy_groups.includes("email_send"),
    "SR timeout fallback must still stamp clear side-effect obligations"
  );
  assert.equal(spec.synthesis.expected_output, "execution");
  assert.equal(spec.constraints.must_use_tools, true);
}

{
  const conflictedContext = {
    ...scheduledContext,
    semantic_router_decision: {
      ...marketEmailDecision,
      expected_output: "email_draft",
      required_policy_groups: ["email_send"]
    }
  };
  const spec = createTaskSpec("发一封总结邮件", conflictedContext, {});
  assert.equal(
    spec.synthesis.expected_output,
    "execution",
    "email_send contract must not leave task synthesis in draft-only mode"
  );
}

{
  const spec = createTaskSpec("查一下我最近的邮件", {}, {});
  assert.equal(spec.connector_domain, true);
  assert.equal(
    spec.tool_policy.policy_groups.external_web_read.mode,
    "optional",
    "connector-domain search should not be misread as required open-web search"
  );
}

{
  const contractSpec = {
    success_contract: {
      required_policy_groups: ["email_send"],
      required_tool_names: []
    }
  };
  const waitingValidation = validateSuccessContract(contractSpec, [{
    type: "tool_result",
    tool: "connector_workflow_run",
    success: true,
    metadata: { connector_status: "waiting_external_decision" }
  }]);
  assert.equal(waitingValidation.satisfied, false, "waiting approval is not a completed email send");
  assert.equal(
    waitingValidation.violations[0]?.kind,
    "email_send_required_waiting_confirmation",
    "waiting approval should explain that confirmation is pending"
  );

  assert.equal(validateSuccessContract(contractSpec, [{
    type: "tool_result",
    tool: "connector_workflow_run",
    success: true,
    metadata: { connector_status: "success" }
  }]).satisfied, true, "successful connector workflow satisfies email_send");
}

{
  const groups = shouldInjectRequiredActionGuidance(
    {
      next_action: "continue",
      satisfied: false,
      violations: [{
        kind: "email_send_required_not_called",
        message: "email_send is still missing"
      }]
    },
    [{
      type: "tool_result",
      tool: "web_search_fetch",
      success: true,
      observation: "Evidence collected from independent sources."
    }]
  );
  assert.deepEqual(groups, ["email_send"], "loop should hand off from evidence collection to required action");
}

{
  const schedulerExecutor = read("src/service/scheduler/execute-action.mjs");
  assert.match(
    schedulerExecutor,
    /const commandRequestsOwnNotification = [\s\S]{0,120}send\\s\+email[\s\S]{0,280}if \(actionParams\.notifyOnComplete !== false[\s\S]{0,180}&& captureMode === "event"\) \{/,
    "scheduled approval notifications must not be skipped just because the command mentions email"
  );
  assert.match(
    schedulerExecutor,
    /if \(pendingApprovalEvent && !agentAlreadyNotified\)[\s\S]*else if \(!commandRequestsOwnNotification && taskReallyRan && !agentAlreadyNotified\)/,
    "email/notify command suppression must apply only to the generic success toast"
  );
}

console.log("ok verify-scheduled-compound-framework");
