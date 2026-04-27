#!/usr/bin/env node
/**
 * EvidencePolicy bridge tests.
 *
 * These guard the architectural rule that SemanticRouter emits structured
 * IntentRoute judgement while deterministic policy converts that judgement
 * into executable constraints.
 */

import assert from "node:assert/strict";

import {
  deriveExternalWebPolicyFromIntentRoute,
  intentRouteNeedsConnector
} from "../src/service/core/policy/evidence-policy.mjs";
import { createTaskSpec } from "../src/service/core/task-spec.mjs";

let pass = 0;
let fail = 0;
function it(label, fn) {
  try {
    fn();
    process.stdout.write(`PASS  ${label}\n`);
    pass += 1;
  } catch (err) {
    process.stdout.write(`FAIL  ${label}\n  ${err.message}\n`);
    fail += 1;
  }
}

const route = (over = {}) => ({
  source_scope: "external_world",
  web_policy: "forbidden",
  output_kind: "conversation",
  artifact_required: false,
  executor: "tool_using",
  research_depth: "unknown",
  primary_intent: "research",
  domain: "software",
  user_goal: "research",
  expected_output: "direct_answer",
  needs_external_info: false,
  needs_current_information: false,
  needs_user_files: false,
  needs_tool_use: false,
  needed_capabilities: ["none"],
  source_mode: "no_external",
  complexity: "medium",
  risk_level: "low",
  confidence: 0.9,
  rationale_summary: "test",
  reason: "test",
  ...over
});

it("external_web_read capability derives required even if compatibility web_policy is stale", () => {
  const policy = deriveExternalWebPolicyFromIntentRoute(route({
    web_policy: "forbidden",
    needs_external_info: true,
    needed_capabilities: ["external_web_read"],
    source_mode: "multi_source_research"
  }));
  assert.equal(policy?.mode, "required");
});

it("provided_context derives forbidden even if compatibility web_policy says required", () => {
  const policy = deriveExternalWebPolicyFromIntentRoute(route({
    web_policy: "required",
    needs_external_info: false,
    needed_capabilities: ["none"],
    source_mode: "provided_context"
  }));
  assert.equal(policy?.mode, "forbidden");
});

it("email_calendar_action capability is connector intent, not external web", () => {
  assert.equal(intentRouteNeedsConnector(route({
    primary_intent: "email_calendar_action",
    needed_capabilities: ["email_calendar_action"]
  })), true);
});

it("createTaskSpec consumes IntentRoute source_mode for single_lookup research quality", () => {
  const spec = createTaskSpec("summarize this external URL", {
    semantic_router_decision: route({
      web_policy: "required",
      needs_external_info: true,
      needed_capabilities: ["external_web_read"],
      source_mode: "single_lookup",
      research_depth: "unknown"
    })
  }, {});
  assert.equal(spec.tool_policy.policy_groups.external_web_read.mode, "required");
  assert.equal(spec.research_quality?.profile, "single_lookup");
});

it("createTaskSpec consumes IntentRoute deep_research source_mode", () => {
  const spec = createTaskSpec("do a comprehensive review", {
    semantic_router_decision: route({
      web_policy: "optional",
      needs_external_info: true,
      needed_capabilities: ["external_web_read"],
      source_mode: "deep_research",
      research_depth: "unknown"
    })
  }, {});
  assert.equal(spec.tool_policy.policy_groups.external_web_read.mode, "required");
  assert.equal(spec.research_quality?.profile, "deep_research");
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
