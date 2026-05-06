import assert from "node:assert/strict";
import test from "node:test";

import { createTaskSpec } from "../../src/service/core/task-spec.mjs";

// Regression: task_c7f592f0 (2026-05-03). SR LLM (deepseek-v4-flash) emitted
// `required_policy_groups: ["email_send"]` for a "美股今天行情" research query
// → phase-gate `email_send_required_not_called` → action-only handoff blocked
// every web tool → partial_success. Fix: side-effect groups (email_send /
// calendar_create / file_upload) must be regex-confirmed before they enter
// the success contract.

function specWithSrDecision(text, srDecisionOverrides = {}) {
  const contextPacket = {
    semantic_router_decision: {
      web_policy: "required",
      source_scope: "external_world",
      output_kind: "conversation",
      artifact_required: false,
      executor: "tool_using",
      research_depth: "multi_source",
      file_read_depth: "shallow",
      primary_intent: "research",
      domain: "finance",
      user_goal: "市场行情查询",
      expected_output: "summary",
      needs_external_info: true,
      needs_current_information: true,
      needs_user_files: false,
      needs_tool_use: true,
      needed_capabilities: ["external_web_read"],
      required_policy_groups: ["external_web_read", "email_send"],
      source_mode: "multi_source_research",
      complexity: "medium",
      risk_level: "low",
      confidence: 0.85,
      rationale_summary: "stub",
      reason: "stub",
      ...srDecisionOverrides
    }
  };
  return createTaskSpec(text, contextPacket);
}

test("SR-claimed email_send is dropped when user text has no email entity", () => {
  const spec = specWithSrDecision("美股今天行情");
  const groups = spec.success_contract.required_policy_groups;
  assert.ok(!groups.includes("email_send"),
    `email_send should be dropped without an email entity, got groups=${JSON.stringify(groups)}`);
  // external_web_read is unrelated and must stay
  assert.ok(groups.includes("external_web_read"),
    `external_web_read should remain, got groups=${JSON.stringify(groups)}`);
});

test("SR-claimed email_send IS kept when user text has an email recipient", () => {
  const spec = specWithSrDecision("把美股今天总结发送到 trader@example.com");
  const groups = spec.success_contract.required_policy_groups;
  assert.ok(groups.includes("email_send"),
    `email_send should survive when an email entity exists, got groups=${JSON.stringify(groups)}`);
});

test("SR-claimed calendar_create is dropped without attendee/time evidence", () => {
  const spec = specWithSrDecision("帮我看下市场动态", {
    required_policy_groups: ["external_web_read", "calendar_create"],
    domain: "calendar"
  });
  const groups = spec.success_contract.required_policy_groups;
  assert.ok(!groups.includes("calendar_create"),
    `calendar_create should be dropped without an attendee/scheduling entity, got groups=${JSON.stringify(groups)}`);
});

test("SR-claimed file_upload is dropped without a file path entity", () => {
  const spec = specWithSrDecision("查询当前热点", {
    required_policy_groups: ["external_web_read", "file_upload"]
  });
  const groups = spec.success_contract.required_policy_groups;
  assert.ok(!groups.includes("file_upload"),
    `file_upload should be dropped without a file-path entity, got groups=${JSON.stringify(groups)}`);
});

test("schedule_create remains SR-only (no regex entity layer for it)", () => {
  const spec = specWithSrDecision("提醒我明天上午 9 点喝水", {
    required_policy_groups: ["schedule_create"],
    primary_intent: "schedule",
    domain: "schedule"
  });
  const groups = spec.success_contract.required_policy_groups;
  assert.ok(groups.includes("schedule_create"),
    `schedule_create should pass through SR judgement, got groups=${JSON.stringify(groups)}`);
});
