#!/usr/bin/env node
/**
 * UCA-077 P4-RQ C4: scheduler-residual regression barrier.
 *
 * The user called out a specific risk: a scheduled news/research task
 * (`source_app: "uca.scheduler"`) should NOT be treated differently
 * by the routing pipeline than the same userCommand typed by hand.
 * No "scheduler特判" — same TaskSpec, same tool_policy, same prompt
 * principles.
 *
 * Today nothing in tool-policy-resolver.mjs branches on
 * source_app === "uca.scheduler", so the invariant already holds.
 * This verifier is a barrier against a future regression: if someone
 * adds a "downgrade scheduler tasks" branch the test will fail.
 *
 * Asserts:
 *   1. createTaskSpec for "每天早上汇报 AI 新闻" with
 *      source_app="uca.scheduler" yields the SAME
 *      tool_policy.policy_groups.external_web_read.mode as the same
 *      userCommand without scheduler stamp.
 *   2. The C1 research-principles helper would render for the
 *      scheduler-fired task (mode != forbidden, no local anchor).
 *   3. context_sources classifier on the scheduler-built packet
 *      reports no real_selection / file_text — title-as-text is
 *      the user's command echoed back, not a content anchor.
 *
 * Run: node scripts/verify-scheduler-residual.mjs
 */

import assert from "node:assert/strict";

import { createTaskSpec } from "../src/service/core/task-spec.mjs";
import { renderResearchPrinciples } from "../src/service/executors/shared/research-principles.mjs";
import { classifyContextSources, hasLocalAnchor } from "../src/service/core/intent/context-sources.mjs";

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

// Mirror the shape of what scheduler/execute-action.mjs builds.
function makeSchedulerPacket({ title }) {
  return {
    schema_version: "1.0",
    source_type: "window",
    source_app: "uca.scheduler",
    capture_mode: "event",
    security_level: "internal",
    redaction_applied: false,
    text: title,                  // scheduler echoes the userCommand into text
    file_paths: [],
    image_paths: [],
    selection_metadata: {
      source_id: "test-source",
      trigger_reason: "scheduled"
    }
  };
}

function makeUserTypedPacket() {
  return {
    schema_version: "1.0",
    source_type: "window",
    source_app: "uca.app",       // typical user-typed source
    text: "",
    file_paths: [],
    image_paths: []
  };
}

const COMMANDS = [
  "每天早上汇报 AI 新闻",
  "查一下有没有类似的开源项目",
  "research today's tech news"
];

for (const cmd of COMMANDS) {
  it(`scheduler residual: "${cmd}" — web policy matches user-typed equivalent`, () => {
    const schedSpec = createTaskSpec(cmd, makeSchedulerPacket({ title: cmd }), {});
    const userSpec  = createTaskSpec(cmd, makeUserTypedPacket(), {});
    const schedMode = schedSpec.tool_policy?.policy_groups?.external_web_read?.mode;
    const userMode  = userSpec.tool_policy?.policy_groups?.external_web_read?.mode;
    assert.equal(schedMode, userMode,
      `mode diverges between scheduler-fired (${schedMode}) and user-typed (${userMode}) for "${cmd}"`);
  });
}

it("scheduler residual: principles helper renders for scheduler-fired research task", () => {
  const cmd = "每天早上汇报 AI 新闻";
  const spec = createTaskSpec(cmd, makeSchedulerPacket({ title: cmd }), {});
  const sources = spec.context_packet?.context_sources
    ?? classifyContextSources({ text: cmd, contextPacket: makeSchedulerPacket({ title: cmd }) });
  const block = renderResearchPrinciples(spec.tool_policy, sources);
  // The principles block MUST render: web is at least optional
  // (research class), there's no local anchor, scheduler stamp does
  // not suppress.
  assert.ok(block != null,
    "principles block must render for scheduler-fired research task — got null");
  assert.match(block, /Multiple independent sources/);
});

it("scheduler residual: classifier sees no local anchor when title echoes the userCommand", () => {
  const cmd = "每天早上汇报 AI 新闻";
  const sources = classifyContextSources({
    text: cmd,
    contextPacket: makeSchedulerPacket({ title: cmd })
  });
  // The scheduler stamps the userCommand into context_packet.text,
  // but that's NOT a real selection — it's a residual command echo.
  // hasLocalAnchor must report false so the principles block renders
  // and the model treats it as research, not a "summarize this text"
  // task.
  assert.equal(hasLocalAnchor(sources), false,
    "scheduler-fired task with title echoing userCommand must not be flagged as local anchor");
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
