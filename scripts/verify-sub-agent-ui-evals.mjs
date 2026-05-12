#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHECK_COMMANDS, FAST_CHECK_COMMANDS } from "./check-manifest.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

const files = [
  "src/shared/sub-agent-timeline-summary.mjs",
  "src/service/core/evals/sub-agent-delegation-corpus.mjs",
  "tests/behavior/sub-agent-timeline-evals.test.mjs"
];

for (const rel of files) {
  assert.ok(existsSync(path.join(root, rel)), `missing SA-002 file: ${rel}`);
}

const summary = read("src/shared/sub-agent-timeline-summary.mjs");
const renderer = read("src/desktop/renderer/console-task-detail.mjs");
const consoleJs = read("src/desktop/renderer/console.js");
const css = read("src/desktop/renderer/shared-tasks.css");
const routes = read("src/service/core/http-routes/task-routes.mjs");
const corpus = read("src/service/core/evals/sub-agent-delegation-corpus.mjs");
const tests = read("tests/behavior/sub-agent-timeline-evals.test.mjs");
const roadmap = read("docs/architecture/post-runtime-upgrade-roadmap.md");

for (const required of [
  "SUB_AGENT_TIMELINE_SCHEMA_VERSION",
  "SUB_AGENT_TIMELINE_EVENT_TYPES",
  "sub_agent_report",
  "buildSubAgentTimelineSummary",
  "has_sub_agents",
  "violation_count",
  "token_total"
]) {
  assert.ok(summary.includes(required), `sub-agent timeline summary missing: ${required}`);
}

assert.ok(
  renderer.includes("buildSubAgentTimelineSummary")
    && renderer.includes("renderSubAgentTimelinePanel")
    && renderer.includes("data-sub-agent-child-task-id"),
  "task detail renderer must expose sub-agent timeline panel"
);
assert.ok(
  consoleJs.includes("renderSubAgentTimelinePanel")
    && consoleJs.includes("children: detail.children ?? []"),
  "console task detail must render sub-agent timeline panel from task detail children"
);
assert.ok(
  routes.includes("children,")
    && routes.includes("task.child_task_ids")
    && routes.includes("runtime.store.getTask(childId)"),
  "task detail route must include child task summaries for sub-agent timeline"
);
assert.ok(css.includes(".sub-agent-timeline-panel") && css.includes(".sub-agent-run-row"),
  "sub-agent timeline panel must have stable CSS");

for (const required of [
  "SUB_AGENT_DELEGATION_EVAL_MINIMUMS",
  "delegate_parallel_research",
  "delegate_isolated_file_review",
  "delegate_bounded_qa",
  "do_not_delegate_simple_task",
  "do_not_delegate_high_risk_mutation",
  "do_not_delegate_private_context",
  "evaluateSubAgentDelegationDecision",
  "forbidden_tool",
  "forbidden_context"
]) {
  assert.ok(corpus.includes(required), `sub-agent eval corpus missing: ${required}`);
}

for (const required of [
  "combines child tasks and structured reports",
  "without raw event JSON",
  "meets category minimums",
  "catches wrong delegation and scope escapes",
  "accepts bounded planner-selected delegation"
]) {
  assert.ok(tests.includes(required), `sub-agent timeline/eval behavior test missing: ${required}`);
}

for (const required of [
  "SA-002: Sub-Agent UI, Trace, And Eval Coverage",
  "Show child runs under the parent task timeline",
  "New sub-agent eval corpus",
  "node scripts/verify-sub-agent-ui-evals.mjs",
  "node --test tests/behavior/sub-agent-timeline-evals.test.mjs"
]) {
  assert.ok(roadmap.includes(required), `roadmap missing SA-002 tracking text: ${required}`);
}

const command = "node scripts/verify-sub-agent-ui-evals.mjs";
assert.ok(CHECK_COMMANDS.includes(command), "full check manifest must include SA-002 verifier");
assert.ok(FAST_CHECK_COMMANDS.includes(command), "fast check manifest must include SA-002 verifier");

console.log("[verify-sub-agent-ui-evals] SA-002 timeline and eval contract OK");
