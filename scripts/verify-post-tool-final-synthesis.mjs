#!/usr/bin/env node
/**
 * P6-PT framework lock: post-tool final answer synthesis.
 *
 * Asserts the framework rule (NOT a phrase or tool patch):
 *   - IntentRoute exposes synthesis kinds in expected_output enum
 *   - TaskSpec carries the synthesis intent forward
 *   - The synthesis-prompt helper renders the right block per intent
 *   - The synthesis completeness check fires on raw dumps and stays
 *     silent when the user wants raw_results
 *   - Executors use the helper + check at the source level
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXPECTED_OUTPUTS,
  SYNTHESIS_REQUIRED_OUTPUTS
} from "../src/service/core/intent/semantic-router.mjs";
import { buildSynthesisGuidance } from "../src/service/executors/shared/synthesis-prompt.mjs";
import { validateAnswerSynthesis } from "../src/service/core/policy/success-contract-validator.mjs";
import { createTaskSpec } from "../src/service/core/task-spec.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

let pass = 0;
let fail = 0;
function it(label, fn) {
  try { fn(); process.stdout.write(`PASS  ${label}\n`); pass += 1; }
  catch (err) { process.stdout.write(`FAIL  ${label}\n  ${err.message}\n`); fail += 1; }
}
async function ait(label, fn) {
  try { await fn(); process.stdout.write(`PASS  ${label}\n`); pass += 1; }
  catch (err) { process.stdout.write(`FAIL  ${label}\n  ${err.message}\n`); fail += 1; }
}

it("EXPECTED_OUTPUTS extends with synthesis kinds (no parallel enum)", () => {
  for (const kind of ["summary", "comparison", "recommendation", "analysis", "action_items", "raw_results"]) {
    assert.ok(EXPECTED_OUTPUTS.includes(kind), `EXPECTED_OUTPUTS must include ${kind}`);
  }
  for (const kept of ["direct_answer", "code", "table", "artifact"]) {
    assert.ok(EXPECTED_OUTPUTS.includes(kept), `legacy value ${kept} must remain`);
  }
});

it("SYNTHESIS_REQUIRED_OUTPUTS does NOT include raw_results, direct_answer, code, table, artifact", () => {
  for (const v of ["raw_results", "direct_answer", "code", "table", "artifact"]) {
    assert.equal(SYNTHESIS_REQUIRED_OUTPUTS.has(v), false, `${v} must NOT be in synthesis-required set`);
  }
  for (const v of ["summary", "comparison", "recommendation", "analysis", "action_items"]) {
    assert.equal(SYNTHESIS_REQUIRED_OUTPUTS.has(v), true, `${v} must be in synthesis-required set`);
  }
});

it("TaskSpec.synthesis carries user_goal + expected_output from SR decision", () => {
  const spec = createTaskSpec("帮我总结今天的邮件", {
    semantic_router_decision: {
      source_scope: "external_world", web_policy: "forbidden", output_kind: "conversation",
      artifact_required: false, executor: "tool_using", research_depth: "unknown",
      primary_intent: "email_calendar_action", domain: "general",
      user_goal: "summarize today's email", expected_output: "summary",
      needs_external_info: false, needs_current_information: false, needs_user_files: false,
      needs_tool_use: true, needed_capabilities: ["email_calendar_action"],
      source_mode: "no_external", complexity: "medium", risk_level: "low",
      confidence: 0.9, rationale_summary: "test", reason: "test"
    }
  });
  assert.ok(spec.synthesis);
  assert.equal(spec.synthesis.expected_output, "summary");
  assert.equal(spec.synthesis.user_goal, "summarize today's email");
});

it("TaskSpec.synthesis falls back to user_goal_text when SR did not run", () => {
  const spec = createTaskSpec("just a request", {});
  assert.ok(spec.synthesis);
  assert.equal(spec.synthesis.expected_output, null);
  assert.equal(spec.synthesis.user_goal, "just a request");
});

it("buildSynthesisGuidance: synthesis kinds get the strong 'transform, do not dump' rule", () => {
  for (const kind of SYNTHESIS_REQUIRED_OUTPUTS) {
    const block = buildSynthesisGuidance({ synthesis: { user_goal: "g", expected_output: kind } });
    assert.match(block, /Synthesis guidance/);
    assert.match(block, /Tool observations are intermediate data/);
    assert.match(block, /Do not list raw records/);
  }
});

it("buildSynthesisGuidance: raw_results gets the explicit raw-allowed line", () => {
  const block = buildSynthesisGuidance({ synthesis: { user_goal: "show me", expected_output: "raw_results" } });
  assert.match(block, /raw \/ unmodified/);
  assert.ok(!/Do not list raw records/.test(block));
});

it("buildSynthesisGuidance: empty when synthesis is missing", () => {
  assert.equal(buildSynthesisGuidance({}), "");
  assert.equal(buildSynthesisGuidance(null), "");
  assert.equal(buildSynthesisGuidance({ synthesis: null }), "");
});

it("validateAnswerSynthesis: no-op when expected_output is not a synthesis kind", () => {
  const transcript = [{ type: "tool_result", tool: "x", success: true, observation: "a".repeat(500) }];
  for (const kind of ["direct_answer", "code", "table", "artifact", "raw_results"]) {
    const violations = validateAnswerSynthesis(
      { synthesis: { expected_output: kind } },
      transcript,
      "a".repeat(500)
    );
    assert.equal(violations.length, 0, `${kind} must NOT trigger the synthesis check`);
  }
});

it("validateAnswerSynthesis: fires when answer is a near-verbatim echo of an observation under a synthesis intent", () => {
  const observation = "Email 1: subject A from a@x.com\nEmail 2: subject B from b@y.com\nEmail 3: subject C";
  const violations = validateAnswerSynthesis(
    { synthesis: { expected_output: "summary" } },
    [{ type: "tool_result", tool: "account_list_emails", success: true, observation: observation.repeat(4) }],
    observation.repeat(4)
  );
  assert.equal(violations.length, 1);
  assert.equal(violations[0].kind, "answer_not_synthesized");
});

it("validateAnswerSynthesis: passes when the answer is genuinely a transformed summary", () => {
  const observation = "Email 1: subject A from a@x.com\nEmail 2: subject B from b@y.com\nEmail 3: subject C from c@z.com";
  const summary = "今天收到三封邮件，主要围绕项目进度和会议安排。建议优先回复来自 a@x.com 的请求。";
  const violations = validateAnswerSynthesis(
    { synthesis: { expected_output: "summary" } },
    [{ type: "tool_result", tool: "account_list_emails", success: true, observation }],
    summary
  );
  assert.equal(violations.length, 0);
});

it("validateAnswerSynthesis: short observations (<80 chars) are not used to detect dumps", () => {
  const violations = validateAnswerSynthesis(
    { synthesis: { expected_output: "summary" } },
    [{ type: "tool_result", tool: "x", success: true, observation: "tiny" }],
    "tiny"
  );
  assert.equal(violations.length, 0);
});

it("validateAnswerSynthesis: failed tool results are ignored", () => {
  const obs = "raw rows raw rows raw rows raw rows raw rows raw rows raw rows raw rows raw rows raw rows";
  const violations = validateAnswerSynthesis(
    { synthesis: { expected_output: "analysis" } },
    [{ type: "tool_result", tool: "x", success: false, error: "boom", observation: obs.repeat(3) }],
    obs.repeat(3)
  );
  assert.equal(violations.length, 0);
});

await ait("agent-loop: imports buildSynthesisGuidance and validateAnswerSynthesis", async () => {
  const src = await readFile(path.join(repoRoot, "src/service/executors/tool_using/agent-loop.mjs"), "utf8");
  assert.match(src, /from\s+"\.\.\/shared\/synthesis-prompt\.mjs"/);
  assert.match(src, /validateAnswerSynthesis[\s\S]{0,80}from\s+"\.\.\/\.\.\/core\/policy\/success-contract-validator\.mjs"/);
});

await ait("agent-loop: synthesisBlock is spliced into the system prompt", async () => {
  const src = await readFile(path.join(repoRoot, "src/service/executors/tool_using/agent-loop.mjs"), "utf8");
  assert.match(src, /synthesisBlock/);
  assert.match(src, /\$\{synthesisBlock\}/);
});

await ait("agent-loop: dedupe path NO LONGER dumps `transcript.filter…map\\(observation\\)\\.join`", async () => {
  const src = await readFile(path.join(repoRoot, "src/service/executors/tool_using/agent-loop.mjs"), "utf8");
  assert.ok(!/transcript\.filter\(\(e\) => e\.type === "tool_result"\)\.map\(\(e\) => e\.observation\)\.join/.test(src),
    "the legacy raw-dump fallback must be removed");
});

await ait("agent-loop: dedupe path emits a synthesis_retry transcript entry", async () => {
  const src = await readFile(path.join(repoRoot, "src/service/executors/tool_using/agent-loop.mjs"), "utf8");
  assert.match(src, /type:\s*"synthesis_retry"/);
  assert.match(src, /repeated_tool_call/);
});

await ait("agent-loop: final-text path runs validateAnswerSynthesis before returning", async () => {
  const src = await readFile(path.join(repoRoot, "src/service/executors/tool_using/agent-loop.mjs"), "utf8");
  assert.match(src, /validateAnswerSynthesis\(task\.task_spec/);
  assert.match(src, /MAX_SYNTHESIS_RETRIES/);
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
