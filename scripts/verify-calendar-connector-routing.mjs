#!/usr/bin/env node
/**
 * Calendar connector capability routing.
 *
 * Guards the framework-level fix for "check whether I am free, then schedule
 * a meeting" requests. These are connector capability intents, not web
 * searches and not fast-mode Q&A: the system must route them to a tool-capable
 * executor where account_list_events / account_create_event can actually run.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  detectConnectorCapabilityIntent,
  inferCalendarTimeWindow,
  isConnectorDomainRequest
} from "../src/service/connectors/core/connector-intent.mjs";
import { classifyGoal, createTaskSpec } from "../src/service/core/task-spec.mjs";
import { planConnectorToolCall } from "../src/service/executors/tool_using/planners/connector.mjs";
import { inferCapabilityFromText } from "../src/service/executors/tool_using/planners/connector-helpers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

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

const HYBRID_REQUESTS = [
  "帮我查一下明天下午我有没有空，如果有空就安排 30 分钟 meeting",
  "明天下午我有没有空，如果有空安排30分钟meeting",
  "Am I free tomorrow afternoon? If yes, schedule a 30 minute meeting"
];

for (const input of HYBRID_REQUESTS) {
  it(`hybrid calendar request routes to connector domain: ${input}`, () => {
    const intent = detectConnectorCapabilityIntent(input);
    assert.equal(intent.matched, true);
    assert.equal(intent.domain, "calendar");
    assert.ok(intent.capabilities.includes("calendarRead"));
    assert.ok(intent.capabilities.includes("calendarWrite"));

    assert.equal(isConnectorDomainRequest(input), true);
    assert.equal(classifyGoal(input), "search_and_answer");

    const spec = createTaskSpec(input);
    assert.equal(spec.connector_domain, true);
    assert.equal(spec.tool_policy.policy_groups.external_web_read.mode, "optional",
      "calendar connector reads external account state; absent IntentRoute, open-web search should not be required");
    assert.equal(spec.suggested_executor, "tool_using");
  });
}

it("availability-only request reads calendar instead of fast-mode Q&A", () => {
  const input = "明天下午我有没有空";
  const intent = detectConnectorCapabilityIntent(input);
  assert.equal(intent.matched, true);
  assert.deepEqual(intent.capabilities, ["calendarRead"]);
  assert.equal(isConnectorDomainRequest(input), true);

  const spec = createTaskSpec(input);
  assert.equal(spec.connector_domain, true);
  assert.equal(spec.suggested_executor, "tool_using");
});

it("connector planner chooses the calendar read tool as the first observable action", () => {
  const input = "帮我查一下明天下午我有没有空，如果有空就安排 30 分钟 meeting";
  assert.equal(inferCapabilityFromText(input), "calendarRead");
  const call = planConnectorToolCall(input, null);
  assert.equal(call?.type, "tool_call");
  assert.equal(call.tool, "account_list_events");
  assert.equal(typeof call.args.startTime, "string");
  assert.equal(typeof call.args.endTime, "string");
});

it("calendar time-window extraction scopes availability reads", () => {
  const window = inferCalendarTimeWindow(
    "明天下午我有没有空",
    new Date("2026-04-27T10:00:00-04:00")
  );
  assert.ok(window);
  assert.equal(window.startTime, "2026-04-28T17:00:00.000Z");
  assert.equal(window.endTime, "2026-04-28T22:00:00.000Z");
});

it("SR timeout does not push calendar connector work to fast", () => {
  const spec = createTaskSpec("帮我查一下明天下午我有没有空，如果有空就安排 30 分钟 meeting", {
    semantic_router_rejection: { kind: "rejection", code: "timeout", reason: "test" }
  }, {});
  assert.equal(spec.routing_status, "sr_timeout");
  assert.equal(spec.routing_degraded, true);
  assert.equal(spec.connector_domain, true);
  assert.equal(spec.suggested_executor, "tool_using");
});

it("IntentRoute email_calendar_action marks connector_domain even without surface words", () => {
  const spec = createTaskSpec("check my availability tomorrow afternoon", {
    semantic_router_decision: {
      source_scope: "external_world",
      web_policy: "forbidden",
      output_kind: "conversation",
      artifact_required: false,
      executor: "tool_using",
      research_depth: "single_lookup",
      primary_intent: "email_calendar_action",
      domain: "general",
      user_goal: "check calendar availability",
      expected_output: "execution",
      needs_external_info: false,
      needs_current_information: true,
      needs_user_files: false,
      needs_tool_use: true,
      needed_capabilities: ["email_calendar_action"],
      required_policy_groups: [],
      source_mode: "single_lookup",
      complexity: "medium",
      risk_level: "medium",
      confidence: 0.9,
      rationale_summary: "Calendar connector action",
      reason: "Calendar connector action"
    }
  }, {});
  assert.equal(spec.connector_domain, true);
  assert.equal(spec.suggested_executor, "tool_using");
});

it("default planner source runs connector preflight before web-search fallback", () => {
  const src = readFileSync(path.join(root, "src/service/executors/tool_using/agent-loop.mjs"), "utf8");
  assert.match(src, /planDeterministicToolCall[\s\S]{0,320}planConnectorToolCall[\s\S]{0,420}tool_policy\?\.web_search_fetch\?\.mode === "required"/,
    "default planner must try connector planning before web-search fallback");
});

it("boundary: assistant availability chat is not a calendar connector request", () => {
  const input = "你有空解释一下这个概念吗";
  assert.equal(detectConnectorCapabilityIntent(input).matched, false);
  assert.equal(isConnectorDomainRequest(input), false);
});

it("boundary: topical news remains non-connector", () => {
  const input = "今天有什么 Google Calendar 新闻";
  assert.equal(isConnectorDomainRequest(input), false);
});

it("boundary: English 'my free software meeting' wording is not availability", () => {
  const input = "my free software meeting notes tomorrow";
  assert.equal(detectConnectorCapabilityIntent(input).matched, false);
  assert.equal(isConnectorDomainRequest(input), false);
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
