#!/usr/bin/env node
/**
 * UCA-077 P6 F3 follow-up: blocking-fix verifier (B / B' / C / A).
 *
 * The bug chain this guards against (task_3ab08e0b regression — user
 * asked "总结一下今天的邮件", LLM raw-dumped 100 emails as the final
 * answer):
 *
 *   1. seedParentTaskContext injected [上一轮任务摘要] into ctx.text
 *      even though the conversation already had structured prior_messages,
 *      creating a parallel history source that violates P6's single-
 *      source-of-truth invariant.
 *   2. context-sources classifier saw the assistant's `---` separator
 *      inside the injected summary, split into multi-block, set BOTH
 *      parent_task_context AND real_selection.
 *   3. real_selection drove source_scope=fact+LOCAL.
 *   4. shouldConsultSemanticRouter used to fact-skip SR.
 *   5. expected_output stayed null.
 *   6. validateAnswerSynthesis early-returned (no expected_output).
 *   7. LLM raw-dumped the email-list observation as the final answer.
 *
 * The four blocking fixes:
 *
 *   B  — seedParentTaskContext: gate the legacy text injection on
 *        whether the conversation already has SQL-backed messages.
 *        Implementation: src/service/core/context-submission.mjs.
 *
 *   B' — context-sources: when ANY producer-sentinel block is present
 *        in ctx.text, do NOT default the unmatched blocks to
 *        real_selection. Implementation:
 *        src/service/core/intent/context-sources.mjs.
 *
 *   C  — shouldConsultSemanticRouter: source_scope=fact+LOCAL is no
 *        longer a skip condition. The gate must consult SR so
 *        IntentRoute can stamp user_goal / expected_output; the merge
 *        layer still keeps local-anchor web policy locked. Implementation:
 *        src/service/core/policy/tool-policy-resolver.mjs.
 *
 *   A  — validateAnswerSynthesis: defensive raw-dump arm runs even
 *        when expected_output is null/unclassified. Closes the case
 *        where SR was unavailable and the LLM raw-dumped without any
 *        IntentRoute classification to drive the existing arms.
 *        Implementation:
 *        src/service/core/policy/success-contract-validator.mjs.
 *
 * The 7 user-listed regression cases tested below cover each fix
 * individually plus the full chain at module level (the actual LLM
 * loop is out of scope — agent-loop.mjs already has its own verifier
 * that exercises the synthesis-retry wiring).
 *
 * Run: node scripts/verify-p6-blocking-fix.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { classifyContextSources } from "../src/service/core/intent/context-sources.mjs";
import {
  shouldConsultSemanticRouter
} from "../src/service/core/policy/tool-policy-resolver.mjs";
import { validateAnswerSynthesis } from "../src/service/core/policy/success-contract-validator.mjs";
import { extractAllSignals } from "../src/service/core/intent/signals/index.mjs";

let pass = 0;
let fail = 0;
async function it(label, fn) {
  try {
    await fn();
    process.stdout.write(`PASS  ${label}\n`);
    pass += 1;
  } catch (err) {
    process.stdout.write(`FAIL  ${label}\n  ${err.message}\n`);
    fail += 1;
  }
}

function probe(text, contextPacket = {}) {
  const contextSources = classifyContextSources({ text, contextPacket });
  const routerContext = { ...contextPacket, context_sources: contextSources };
  const { signals } = extractAllSignals(text, routerContext);
  return { signals, routerContext, contextSources };
}

// ────────────────────────────────────────────────────────────────────
// Case 1 (B): conversation has prior_messages → no [上一轮任务摘要]
//             text injection in the routed contextPacket.
// Source-level lock-in: assert the gate condition is present in
// context-submission.mjs:seedParentTaskContext. The gate is internal
// (not exported), so we verify the structural shape via source grep.
// ────────────────────────────────────────────────────────────────────
await it("Case 1 (B): seedParentTaskContext gates text injection on getConversationMessages", () => {
  const src = readFileSync("src/service/core/context-submission.mjs", "utf8");
  const fnStart = src.indexOf("function seedParentTaskContext");
  assert.notEqual(fnStart, -1, "seedParentTaskContext must exist");
  // Find the function body. Look for the next standalone `function ` or end-of-file.
  const after = src.slice(fnStart);
  const nextFn = after.slice(1).search(/\nfunction |\nasync function |\nexport (async )?function /);
  const body = nextFn === -1 ? after : after.slice(0, nextFn + 1);

  // The gate must read the conversation's existing messages and
  // short-circuit when any exist.
  assert.match(body, /getConversationMessages/,
    "seedParentTaskContext must read getConversationMessages to gate the injection");
  assert.match(body, /existing\s*=\s*runtime\.store\.getConversationMessages/,
    "seedParentTaskContext must call store.getConversationMessages with the conversation_id");
  assert.match(body, /Array\.isArray\(existing\)\s*&&\s*existing\.length\s*>\s*0/,
    "seedParentTaskContext must short-circuit when prior messages exist (length > 0)");
  // The gated branch returns the contextPacket unchanged (no [上一轮任务摘要] added).
  assert.match(body, /return\s+contextPacket\s*;/,
    "the gate must return contextPacket unchanged when prior messages exist");
});

// ────────────────────────────────────────────────────────────────────
// Case 2 (B): when the gate fires, parent_task_summary is NOT a
//             parallel context source — neither in ctx.text nor in
//             selection_metadata.parent_task_id.
// Source-level lock-in: confirm the call site passes conversationId
// through (without it the gate is a no-op).
// ────────────────────────────────────────────────────────────────────
await it("Case 2 (B): seedParentTaskContext call site passes conversationId", () => {
  const src = readFileSync("src/service/core/context-submission.mjs", "utf8");
  // Find the call to seedParentTaskContext({...}) and assert it includes conversationId.
  const callMatch = src.match(/seedParentTaskContext\(\{[\s\S]*?\}\)/);
  assert.ok(callMatch, "seedParentTaskContext must be called");
  assert.match(callMatch[0], /conversationId/,
    "seedParentTaskContext call must thread conversationId so the gate sees it");
});

// ────────────────────────────────────────────────────────────────────
// Case 3 (B'): producer-sentinel block in ctx.text does NOT set
//              real_selection on unrelated content (mutual exclusion).
// ────────────────────────────────────────────────────────────────────
await it("Case 3 (B'): [上一轮任务摘要] sentinel block prevents real_selection on follow-up text", () => {
  // Reproduces the task_3ab08 scenario: the seedParentTaskContext text
  // injection puts a [上一轮任务摘要] header at the top, the assistant's
  // markdown reply contains a `---` separator, and the post-separator
  // text gets misclassified as real_selection. Post-B' the classifier
  // recognises the sentinel-tagged producer block and does NOT default
  // unmatched siblings to real_selection.
  const text = "总结一下今天的邮件";
  const ctx = {
    text: [
      "[上一轮任务摘要 · parent=task_abc1234]",
      "用户上一条指令：列出今天的邮件",
      "助手上一条回复（节选）：\n收到 100 封邮件\n这些是今天的邮件清单"
    ].join("\n\n---\n\n")
  };
  const sources = classifyContextSources({ text, contextPacket: ctx });
  assert.equal(sources.parent_task_context, true,
    "the sentinel block must set parent_task_context");
  assert.equal(sources.real_selection, false,
    "real_selection must NOT be set when a producer sentinel is present (mutual exclusion)");
});

await it("Case 3 (B'): [Editable target artifact] sentinel suppresses real_selection on neighbours", () => {
  const text = "save it";
  const ctx = {
    text: [
      "[Editable target artifact]\nC:/tmp/file.md",
      "Here is some neighbouring assistant text — looks like a selection but isn't."
    ].join("\n\n---\n\n")
  };
  const sources = classifyContextSources({ text, contextPacket: ctx });
  assert.equal(sources.editable_artifact, true);
  assert.equal(sources.real_selection, false,
    "neighbouring blocks under a producer sentinel must not be classified as real_selection");
});

// ────────────────────────────────────────────────────────────────────
// Case 4 (C): local anchors must not fact-skip SR.
// ────────────────────────────────────────────────────────────────────
await it("Case 4 (C): real_selection + summary request → SR IS consulted", () => {
  // The exact regression: ctx.text is non-sentinel content (post-B' it
  // would still classify as real_selection because there's no producer
  // sentinel — this is a legitimate user-pasted passage). SR still
  // needs to classify expected_output; local policy remains locked by
  // mergeSemanticRouterDecision.
  const text = "总结一下这些邮件";
  const ctx = { text: "User pasted a long list of email subject lines and senders, several lines deep." };
  const { signals, routerContext } = probe(text, ctx);
  assert.equal(signals.source_scope?.matched, true);
  assert.equal(signals.source_scope.kind, "fact");
  assert.equal(
    shouldConsultSemanticRouter({ signals, contextPacket: routerContext, text }),
    true,
    "source_scope=fact+LOCAL must not silence SR"
  );
});

await it("Case 4 (C): real_selection + neutral command → SR IS consulted too", () => {
  // No command-side topic/intent regex is allowed here. The framework
  // rule is simpler: local source_scope is a policy lock, not an SR
  // consult blocker.
  const text = "save this for later";
  const ctx = { text: "User pasted a long list of items, several lines deep." };
  const { signals, routerContext } = probe(text, ctx);
  assert.equal(
    shouldConsultSemanticRouter({ signals, contextPacket: routerContext, text }),
    true
  );
});

// ────────────────────────────────────────────────────────────────────
// Case 5 (A): expected_output=null + raw dump → defensive arm fires.
// ────────────────────────────────────────────────────────────────────
await it("Case 5 (A): expected_output=null + answer echoes observation → violation reported", () => {
  // Reproduces the task_3ab08 final state: SR couldn't classify so
  // expected_output stayed null, and the LLM emitted its 'final' text
  // as a near-verbatim echo of the email list observation. Pre-A the
  // validator early-returned on null; post-A the raw-dump arm fires.
  const observation = "Email 1: subject A from a@x.com\nEmail 2: subject B from b@y.com\nEmail 3: subject C from c@z.com\nEmail 4: subject D from d@x.com\nEmail 5: subject E from e@y.com";
  const transcript = [
    { type: "tool_result", tool: "account_list_emails", success: true, observation: observation.repeat(4) }
  ];
  const finalText = observation.repeat(4); // straight echo
  const violations = validateAnswerSynthesis(
    { synthesis: { expected_output: null } },
    transcript,
    finalText
  );
  assert.equal(violations.length, 1, "the raw-dump arm must fire when expected_output is null");
  assert.equal(violations[0].kind, "answer_not_synthesized");
  assert.equal(violations[0].isLikelyRawDump, true);
  assert.equal(violations[0].expected_output, "raw_dump",
    "null expected_output must be tagged 'raw_dump' in the violation for audit clarity");
});

await it("Case 5 (A): expected_output missing entirely (no synthesis key) → violation reported on dump", () => {
  // Defense-in-depth: the validator must not crash or silent-pass when
  // task_spec.synthesis is wholly absent.
  const observation = "Row 1: alpha\nRow 2: beta\nRow 3: gamma\nRow 4: delta\nRow 5: epsilon\nRow 6: zeta\nRow 7: eta\nRow 8: theta";
  const transcript = [
    { type: "tool_result", tool: "x", success: true, observation: observation.repeat(3) }
  ];
  const violations = validateAnswerSynthesis(
    {},  // no synthesis key at all
    transcript,
    observation.repeat(3)
  );
  assert.equal(violations.length, 1);
  assert.equal(violations[0].isLikelyRawDump, true);
});

// ────────────────────────────────────────────────────────────────────
// Case 6 (A): expected_output=null + non-dump answer → no false retry.
// ────────────────────────────────────────────────────────────────────
await it("Case 6 (A): expected_output=null + genuinely synthesised reply → no violation (no false retry)", () => {
  const observation = "Email 1: subject A from a@x.com\nEmail 2: subject B from b@y.com\nEmail 3: subject C from c@z.com";
  const synthesised = "今天收到三封邮件，主要围绕项目进度和会议安排。";
  const transcript = [
    { type: "tool_result", tool: "account_list_emails", success: true, observation: observation.repeat(3) }
  ];
  const violations = validateAnswerSynthesis(
    { synthesis: { expected_output: null } },
    transcript,
    synthesised
  );
  assert.equal(violations.length, 0,
    "low overlap → no raw-dump → no violation, even with null expected_output");
});

await it("Case 6 (A): expected_output=raw_results (explicit non-synthesis) + observation echo → no violation", () => {
  // Sanity check: when SR explicitly classified the request as wanting
  // raw data, the LLM is permitted to echo observations. The defensive
  // arm must NOT fire — the user asked for the data.
  const observation = "Row 1: alpha\nRow 2: beta\nRow 3: gamma\nRow 4: delta";
  const transcript = [
    { type: "tool_result", tool: "x", success: true, observation: observation.repeat(4) }
  ];
  const violations = validateAnswerSynthesis(
    { synthesis: { expected_output: "raw_results" } },
    transcript,
    observation.repeat(4)
  );
  assert.equal(violations.length, 0,
    "explicit raw_results classification must allow observation echo");
});

await it("Case 6 (A): expected_output=null + no tool transcript → no violation (free composition)", () => {
  const violations = validateAnswerSynthesis(
    { synthesis: { expected_output: null } },
    [],  // no tool calls
    "Hello, how can I help you today?"
  );
  assert.equal(violations.length, 0);
});

// ────────────────────────────────────────────────────────────────────
// Case 7: Regression — full chain for "总结一下今天的邮件".
// We can't run an LLM here, but we can verify the BACKBONE of the
// chain: classifier → signals → SR-consult gate → synthesis-validator
// all behave correctly on a reproduction of the task_3ab08 inputs.
// ────────────────────────────────────────────────────────────────────
await it("Case 7 (regression): 总结一下今天的邮件 + injected parent-summary block — full chain", () => {
  const userCommand = "总结一下今天的邮件";

  // Reproduce what context-submission would produce IF B were absent
  // (the worst case): a parent-summary block appended to ctx.text.
  // Post-B'/C/A, even this worst-case input must route correctly:
  //   • B'  : real_selection stays false (sentinel block present)
  //   • C   : source_scope is no longer an SR-skip condition; SR is
  //           available for semantic classification
  //   • A   : if SR fails / stays null, validator's raw-dump arm fires
  //           on a raw observation echo
  const ctxText = [
    "[上一轮任务摘要 · parent=task_xyz0001]",
    "用户上一条指令：列出今天的邮件",
    "助手上一条回复（节选）：\n邮件 1\n邮件 2\n邮件 3"
  ].join("\n\n---\n\n");
  const ctx = { text: ctxText };

  // Step 1: classifier.
  const sources = classifyContextSources({ text: userCommand, contextPacket: ctx });
  assert.equal(sources.parent_task_context, true,
    "step 1: classifier must tag parent_task_context");
  assert.equal(sources.real_selection, false,
    "step 1: real_selection must NOT fire (B' mutual exclusion)");

  // Step 2: signals + SR consult gate.
  const routerContext = { ...ctx, context_sources: sources };
  const { signals } = extractAllSignals(userCommand, routerContext);
  // source_scope wouldn't fire on parent_task_context (not a LOCAL_ANCHOR_KEY),
  // and local source_scope would not be a skip condition anyway.
  const consult = shouldConsultSemanticRouter({
    signals,
    contextPacket: routerContext,
    text: userCommand
  });
  assert.equal(consult, true,
    "step 2: SR must be consulted for semantic classification");

  // Step 3: synthesis validator on the raw-dump worst case.
  // Even if SR failed and expected_output stayed null, the defensive
  // raw-dump arm catches the regression.
  const observation = "Email 1: subject A from a@x.com\nEmail 2: subject B from b@y.com\nEmail 3: subject C from c@z.com\nEmail 4: subject D from d@x.com\nEmail 5: subject E from e@y.com\nEmail 6: subject F from f@z.com";
  const transcript = [
    { type: "tool_result", tool: "account_list_emails", success: true, observation: observation.repeat(8) }
  ];
  const finalText = observation.repeat(8);
  const violations = validateAnswerSynthesis(
    { synthesis: { expected_output: null } },  // SR failed → null
    transcript,
    finalText
  );
  assert.ok(violations.length >= 1,
    "step 3: raw-dump arm must fire on observation echo even with null expected_output");
  assert.equal(violations[0].isLikelyRawDump, true);
});

await it("Case 7 (regression-positive): synthesised reply for the same input → no violation", () => {
  // Symmetric positive: when the LLM ACTUALLY synthesises, no violation.
  const observation = "Email 1: subject A from a@x.com\nEmail 2: subject B from b@y.com\nEmail 3: subject C from c@z.com";
  const synthesised = "你今天共收到 3 封邮件，主要围绕项目进度和外部对接。建议先回复来自 a@x.com 的需求方，其余可稍后处理。";
  const transcript = [
    { type: "tool_result", tool: "account_list_emails", success: true, observation: observation.repeat(3) }
  ];
  const violations = validateAnswerSynthesis(
    { synthesis: { expected_output: "summary" } },  // SR succeeded
    transcript,
    synthesised
  );
  assert.equal(violations.length, 0,
    "synthesised reply with summary shape markers passes the validator");
});

// ────────────────────────────────────────────────────────────────────
// Case 8: Background submissions must ACK/queue before slow LLM
//         preflight. The SemanticRouter still runs, but inside the
//         worker execution path so the UI can attach SSE immediately.
// ────────────────────────────────────────────────────────────────────
await it("Case 8 (latency): background task creation defers SemanticRouter preflight into execute()", () => {
  const src = readFileSync("src/service/core/context-submission.mjs", "utf8");
  assert.match(src, /const\s+deferPreExecutionPlanning\s*=\s*background\s*;/,
    "background submissions must defer pre-execution planning without a skipDecomposition exception");

  const submitIndex = src.indexOf("const { task } = submitTaskWithConversation");
  const executeIndex = src.indexOf("const execute = async () =>");
  assert.ok(submitIndex > 0 && executeIndex > submitIndex,
    "task must be persisted before execute() is declared");

  const beforeSubmit = src.slice(0, submitIndex);
  assert.match(beforeSubmit, /let\s+routerEnrichedContext\s*=\s*deferPreExecutionPlanning\s*\?\s*\{[\s\S]*?context_sources:\s*classifyContextSources[\s\S]*?\}\s*:\s*await\s+applySemanticRouterPreflight/,
    "background pre-submit must use a cheap classified packet; only the non-deferred branch may await SemanticRouter");

  const executeBody = src.slice(executeIndex);
  assert.match(executeBody, /if\s*\(\s*deferPreExecutionPlanning\s*&&\s*inspection\.allowed\s*\)/,
    "execute() must contain the deferred preflight branch");
  assert.match(executeBody, /phase:\s*EXECUTION_PHASES\.SEMANTIC_ROUTER_PATCH/,
    "deferred worker SR must use the semantic_router_patch phase, not the blocking preflight phase");
  assert.match(executeBody, /runExecutionPhase\(\{[\s\S]*step:\s*"semantic_router_patch"/,
    "deferred worker SR must emit a semantic_router_patch step");
  assert.match(executeBody, /fn:\s*\(\)\s*=>\s*applySemanticRouterPreflight/,
    "worker preflight must still call SemanticRouter before executor selection");
  // Phase 1.6 — SR runs in PARALLEL with the executor (fire-and-forget).
  // The patcher refreshes task.task_spec when SR returns, but MUST NOT
  // mutate task.executor (the loop has already locked it in) and MUST
  // NOT touch task.task_spec_initial (validators use it for forward-only
  // policy semantics — late SR upgrades cannot retroactively fail).
  assert.match(executeBody, /srPromise\.then/,
    "SR result must be applied as a fire-and-forget patch, not awaited before executor start");
  assert.match(executeBody, /task\.task_spec\s*=\s*refreshedSpec/,
    "SR patcher must refresh the persisted task spec");
  assert.ok(!/task\.executor\s*=\s*executorOverride\s*\?\?\s*refreshedSpec/.test(executeBody),
    "SR patcher MUST NOT mutate task.executor mid-flight (loop has already locked it in)");
  assert.match(executeBody, /task\.task_spec_source\s*=\s*"semantic_router_patched"/,
    "SR patcher must stamp task_spec_source so audit can distinguish deterministic vs SR-patched runs");
});

await it("Case 8b (latency): browser capture background tasks use the same deferred preflight shape", () => {
  const src = readFileSync("src/service/core/browser-submission.mjs", "utf8");
  assert.match(src, /const\s+deferPreExecutionPlanning\s*=\s*background\s*;/,
    "browser background submissions must defer pre-execution planning");

  const submitIndex = src.indexOf("const { task } = submitTaskWithConversation");
  const executeIndex = src.indexOf("const execute = async () =>");
  assert.ok(submitIndex > 0 && executeIndex > submitIndex,
    "browser task must be persisted before execute() is declared");

  const beforeSubmit = src.slice(0, submitIndex);
  assert.match(beforeSubmit, /let\s+routerEnrichedContext\s*=\s*deferPreExecutionPlanning\s*\?\s*\{[\s\S]*?context_sources:\s*classifyContextSources[\s\S]*?\}\s*:\s*await\s+applySemanticRouterPreflight/,
    "browser pre-submit must use a cheap classified packet; only the non-deferred branch may await SemanticRouter");

  const executeBody = src.slice(executeIndex);
  assert.match(executeBody, /if\s*\(\s*deferPreExecutionPlanning\s*&&\s*inspection\.allowed\s*\)/,
    "browser execute() must contain the deferred preflight branch");
  assert.match(executeBody, /phase:\s*EXECUTION_PHASES\.SEMANTIC_ROUTER_PATCH/,
    "browser deferred worker SR must use the semantic_router_patch phase, not the blocking preflight phase");
  assert.match(executeBody, /runExecutionPhase\(\{[\s\S]*step:\s*"semantic_router_patch"/,
    "browser deferred worker SR must emit a semantic_router_patch step");
  assert.match(executeBody, /fn:\s*\(\)\s*=>\s*applySemanticRouterPreflight/,
    "browser worker preflight must still call SemanticRouter before executor selection");
  assert.match(executeBody, /task\.task_spec\s*=\s*refreshedSpec/,
    "browser worker preflight must refresh the persisted task spec");
});

// ────────────────────────────────────────────────────────────────────
// Case 9: Streaming finalisation should not delete and recreate the
//         assistant answer bubble. It should move the live bubble to the
//         tail and finalise it in place, keeping streamed content stable.
// ────────────────────────────────────────────────────────────────────
await it("Case 9 (streaming): inline_result finalises the streaming bubble in place", () => {
  const src = readFileSync("src/desktop/renderer/overlay.js", "utf8");
  const marker = 'if (frame.event === "inline_result")';
  const start = src.indexOf(marker);
  assert.notEqual(start, -1, "inline_result handler must exist");
  const next = src.indexOf('if (frame.event === "status_changed")', start);
  const body = next === -1 ? src.slice(start) : src.slice(start, next);

  assert.match(body, /bubbleArea\.appendChild\(streamingBubble\)/,
    "inline_result must move the live streaming bubble to the tail");
  assert.match(body, /streamingBubble\.classList\.remove\("streaming"\)/,
    "inline_result must finalise the existing streaming bubble");
  assert.match(body, /streamingBubble\.innerHTML\s*=\s*renderMarkdown\(streamingBubbleRawText\)/,
    "inline_result must render final text into the existing bubble");
  assert.doesNotMatch(body, /streamingBubble\.remove\(\)/,
    "inline_result must not delete the streaming bubble and recreate the answer");
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
