#!/usr/bin/env node
/**
 * P6 PT2 invariant: tool-using executor paths cannot mark a synthesis-
 * required task DONE without going through validateAnswerSynthesis.
 *
 * This is a SOURCE-LEVEL audit, not a runtime gate. It walks the three
 * tool-using executors (tool_using/agent-loop, agentic/planner,
 * fast-executor) and asserts:
 *
 *   1. Each imports buildSynthesisGuidance (so the system prompt
 *      surfaces user_goal / expected_output / "transform, don't dump").
 *
 *   2. tool_using and agentic — both of which can reach tool
 *      observations — import validateAnswerSynthesis and call it
 *      against the final text BEFORE returning success.
 *
 *   3. fast-executor's check exemption is justified: it has no tools
 *      and no transcript, so validateAnswerSynthesis would no-op.
 *      It still surfaces buildSynthesisGuidance in the system prompt.
 *
 *   4. No executor still contains the legacy raw-dump fallback
 *      `transcript.filter(...).map(observation).join` pattern.
 *
 *   5. The bigram + per-kind shape check returns the structured
 *      fields { isLikelyRawDump, missingExpectedTransformation,
 *      checkerReason } — caller sites must read by name (no positional
 *      access on a single string), so future heuristic upgrades stay
 *      compatible.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  validateAnswerSynthesis
} from "../src/service/core/policy/success-contract-validator.mjs";
import { SYNTHESIS_REQUIRED_OUTPUTS } from "../src/service/core/intent/semantic-router.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

let pass = 0;
let fail = 0;
async function it(label, fn) {
  try { await fn(); process.stdout.write(`PASS  ${label}\n`); pass += 1; }
  catch (err) { process.stdout.write(`FAIL  ${label}\n  ${err.message}\n`); fail += 1; }
}
async function read(p) { return readFile(path.join(repoRoot, p), "utf8"); }

const toolUsing = await read("src/service/executors/tool_using/agent-loop.mjs");
const agentic   = await read("src/service/executors/agentic/planner.mjs");
const agenticPB = await read("src/service/executors/agentic/prompt-builder.mjs");
const fastExec  = await read("src/service/executors/fast/fast-executor.mjs");

await it("tool_using imports buildSynthesisGuidance + validateAnswerSynthesis", () => {
  assert.match(toolUsing, /buildSynthesisGuidance/);
  assert.match(toolUsing, /validateAnswerSynthesis/);
});

await it("agentic prompt-builder imports + uses buildSynthesisGuidance", () => {
  assert.match(agenticPB, /buildSynthesisGuidance/);
  assert.match(agenticPB, /buildSynthesisGuidance\(task\?\.task_spec\)/);
});

await it("agentic planner imports validateAnswerSynthesis", () => {
  assert.match(agentic, /validateAnswerSynthesis/);
});

await it("agentic finalize calls validateAnswerSynthesis on the final text", () => {
  assert.match(
    agentic,
    /validateAnswerSynthesis\([\s\S]{0,160}finalText/,
    "agentic must run validateAnswerSynthesis with the final text before returning"
  );
});

await it("fast-executor uses buildSynthesisGuidance in its system prompt", () => {
  assert.match(fastExec, /buildSynthesisGuidance/);
  assert.match(fastExec, /synthesisGuidance/);
});

await it("fast-executor justifiably skips the runtime check (no transcript, no tools)", () => {
  // Guard against accidentally adding a check that would always no-op
  // and confuse future readers — fast-executor has no synthesis check
  // because validateAnswerSynthesis returns [] for zero tool results.
  assert.ok(!/validateAnswerSynthesis\(/.test(fastExec),
    "fast-executor must not invoke validateAnswerSynthesis (it has no tool transcript; the check would always be a no-op)");
});

await it("no executor still contains the legacy raw-dump fallback pattern", () => {
  const pattern = /transcript\.filter\(\(e\) => e\.type === "tool_result"\)\.map\(\(e\) => e\.observation\)\.join/;
  assert.ok(!pattern.test(toolUsing));
  assert.ok(!pattern.test(agentic));
  assert.ok(!pattern.test(fastExec));
});

await it("validateAnswerSynthesis returns structured fields, not just a string message", () => {
  const observation = "Email 1: subject A from a@x.com\nEmail 2: subject B from b@y.com\nEmail 3: subject C from c@z.com\nEmail 4: subject D from d@x.com";
  const violations = validateAnswerSynthesis(
    { synthesis: { expected_output: "summary" } },
    [{ type: "tool_result", tool: "x", success: true, observation: observation.repeat(4) }],
    observation.repeat(4)
  );
  assert.equal(violations.length, 1);
  const v = violations[0];
  assert.equal(typeof v.isLikelyRawDump, "boolean");
  assert.equal(typeof v.missingExpectedTransformation, "boolean");
  assert.equal(typeof v.checkerReason, "string");
  assert.equal(typeof v.expected_output, "string");
});

await it("validateAnswerSynthesis: per-kind shape check fires when overlap is low but shape is wrong", () => {
  // Final text has zero shared tokens with the observation and no
  // comparison marker (none of: 相比/对比/比较/相对/优于/劣于/区别/不同点/相同点
  // /compared/vs/versus/better/worse/difference/similar/markdown table).
  const observation = "我读取了产品 A、产品 B、产品 C 的规格书内容（一大段）。".repeat(10);
  const finalText = "用户提到了三个项目，每个都有自身的卖点和定位。我们已经看到了它们的资料。我们已经看到了它们的资料。";
  const violations = validateAnswerSynthesis(
    { synthesis: { expected_output: "comparison" } },
    [{ type: "tool_result", tool: "fetch_url_content", success: true, observation }],
    finalText
  );
  assert.equal(violations.length, 1);
  assert.equal(violations[0].missingExpectedTransformation, true);
  assert.match(violations[0].checkerReason, /missing_comparison_shape_markers/);
});

await it("validateAnswerSynthesis: passes when shape marker is present and overlap is low", () => {
  const observation = "Product A: feature x. Product B: feature y. Product C: feature z.".repeat(20);
  const finalText = "总结来看，A 因为 X 略优于 B，C 在 Y 维度上最弱。建议优先选 A。";
  const violations = validateAnswerSynthesis(
    { synthesis: { expected_output: "comparison" } },
    [{ type: "tool_result", tool: "fetch_url_content", success: true, observation }],
    finalText
  );
  assert.equal(violations.length, 0);
});

await it("validateAnswerSynthesis: action_items requires action/priority markers", () => {
  const obs = "Inbox row 1\nInbox row 2\nInbox row 3\nInbox row 4\nInbox row 5\nInbox row 6\nInbox row 7\nInbox row 8".repeat(4);
  // bare numbered list with no priority / next-step markers
  const finalText = "1. 邮件 X\n2. 邮件 Y\n3. 邮件 Z";
  const violations = validateAnswerSynthesis(
    { synthesis: { expected_output: "action_items" } },
    [{ type: "tool_result", tool: "account_list_emails", success: true, observation: obs }],
    finalText
  );
  assert.equal(violations.length, 1);
  assert.equal(violations[0].missingExpectedTransformation, true);
});

await it("SYNTHESIS_REQUIRED_OUTPUTS is read by callers, not duplicated", async () => {
  const semantic = await read("src/service/core/intent/semantic-router.mjs");
  const validator = await read("src/service/core/policy/success-contract-validator.mjs");
  const synthesisPrompt = await read("src/service/executors/shared/synthesis-prompt.mjs");
  // exactly one EXPORT
  const exportMatches = semantic.match(/export const SYNTHESIS_REQUIRED_OUTPUTS/g) ?? [];
  assert.equal(exportMatches.length, 1);
  // imports in caller files
  assert.match(validator, /SYNTHESIS_REQUIRED_OUTPUTS/);
  assert.match(synthesisPrompt, /SYNTHESIS_REQUIRED_OUTPUTS/);
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
