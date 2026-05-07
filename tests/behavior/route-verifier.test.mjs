/**
 * Behavior tests for route-verifier.mjs (C18 #C').
 *
 * The verifier replaces topic-regex-driven `stable-qa-override.mjs`
 * with a structured judge. These tests stub the judge with hand-
 * crafted payloads and assert the framework-level rules:
 *   - Schema validation rejects malformed judge payloads
 *   - Hard structural signals dominate (judge cannot override URL /
 *     explicit search etc.)
 *   - Shadow mode logs diff but never changes the decision
 *   - Enforce mode applies corrected fields
 *   - Judge unavailable → conservative fallback (degrade required→optional)
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  applyJudgeVerdict,
  buildJudgePrompt,
  detectHardStructuralSignals,
  runRouteVerifier,
  VERIFIER_MODES,
  DEFAULT_VERIFIER_MODE
} from "../../src/service/core/intent/route-verifier.mjs";

test("VERIFIER_MODES enumerates off/shadow/enforce; default is shadow", () => {
  assert.deepEqual(VERIFIER_MODES, ["off", "shadow", "enforce"]);
  assert.equal(DEFAULT_VERIFIER_MODE, "shadow");
});

test("mode=off short-circuits — decision is untouched", () => {
  const decision = { web_policy: "required", source_mode: "single_lookup" };
  const result = applyJudgeVerdict({ decision, mode: "off" });
  assert.equal(result.applied, false);
  assert.equal(result.decision, decision);
  assert.equal(result.judge_status, "ok");
});

test("invalid mode throws — caller bug surface", () => {
  const decision = { web_policy: "required" };
  assert.throws(
    () => applyJudgeVerdict({ decision, mode: "yolo" }),
    /invalid mode 'yolo'/
  );
});

test("hard structural signals dominate even when judge says reject", () => {
  const decision = { web_policy: "required", source_mode: "single_lookup" };
  const signals = { explicit_search: { matched: true } };
  const result = applyJudgeVerdict({
    decision,
    signals,
    judgePayload: {
      verdict: "reject",
      corrected_web_policy: "forbidden",
      corrected_source_mode: "no_external",
      confidence: 0.9,
      reason: "stable QA",
      evidence_basis: []
    },
    mode: "enforce"
  });
  assert.equal(result.applied, false);
  assert.equal(result.judge_status, "hard_signal_override");
  assert.equal(result.decision.web_policy, "required");
});

test("detectHardStructuralSignals enumerates all 8 categories", () => {
  // Spot-check each signal flag flips into the result.
  const cases = [
    ["explicit_search", "explicit_search"],
    ["explicit_external", "explicit_external"],
    ["explicit_no_search", "explicit_no_search"],
    ["explicit_single_url", "explicit_single_url"],
    ["explicit_local_only", "explicit_local_only"],
    ["attachment_present", "attachment_present"],
    ["destructive_action", "destructive_action"],
    ["external_side_effect", "external_side_effect"]
  ];
  for (const [input, expected] of cases) {
    const result = detectHardStructuralSignals({ [input]: { matched: true } });
    assert.ok(result.includes(expected), `signal '${input}' must surface`);
  }
});

test("shadow mode — judge says reject + corrected web_policy → diff logged but decision unchanged", () => {
  const decision = { web_policy: "required", source_mode: "single_lookup" };
  const result = applyJudgeVerdict({
    decision,
    signals: {},
    judgePayload: {
      verdict: "reject",
      corrected_web_policy: "forbidden",
      corrected_source_mode: "no_external",
      confidence: 0.85,
      reason: "stable concept Q&A — no freshness markers",
      evidence_basis: ["learning verb pattern"]
    },
    mode: "shadow"
  });
  assert.equal(result.applied, false, "shadow must NOT change the decision");
  assert.equal(result.decision.web_policy, "required");
  assert.deepEqual(result.diff, {
    web_policy: { from: "required", to: "forbidden" },
    source_mode: { from: "single_lookup", to: "no_external" }
  });
  assert.equal(result.mode, "shadow");
});

test("enforce mode — judge says reject → decision actually patched", () => {
  const decision = { web_policy: "required", source_mode: "single_lookup" };
  const result = applyJudgeVerdict({
    decision,
    signals: {},
    judgePayload: {
      verdict: "reject",
      corrected_web_policy: "forbidden",
      corrected_source_mode: "no_external",
      confidence: 0.9,
      reason: "stable concept Q&A",
      evidence_basis: []
    },
    mode: "enforce"
  });
  assert.equal(result.applied, true);
  assert.equal(result.decision.web_policy, "forbidden");
  assert.equal(result.decision.source_mode, "no_external");
  assert.deepEqual(result.diff.web_policy, { from: "required", to: "forbidden" });
});

test("judge says accept — decision unchanged, no diff, ok status", () => {
  const decision = { web_policy: "required" };
  const result = applyJudgeVerdict({
    decision,
    judgePayload: {
      verdict: "accept",
      confidence: 0.95,
      reason: "agreed: freshness signal present",
      evidence_basis: ["今日"]
    },
    mode: "enforce"
  });
  assert.equal(result.applied, false);
  assert.equal(result.diff, null);
  assert.equal(result.judge_status, "ok");
});

test("judge says abstain — decision unchanged, status abstain", () => {
  const decision = { web_policy: "optional" };
  const result = applyJudgeVerdict({
    decision,
    judgePayload: {
      verdict: "abstain",
      confidence: 0.4,
      reason: "ambiguous request",
      evidence_basis: []
    },
    mode: "enforce"
  });
  assert.equal(result.applied, false);
  assert.equal(result.judge_status, "abstain");
});

test("judge unavailable in shadow mode → no change", () => {
  const decision = { web_policy: "required", source_mode: "single_lookup" };
  const result = applyJudgeVerdict({
    decision,
    signals: {},
    judgeError: new Error("network timeout"),
    mode: "shadow"
  });
  assert.equal(result.applied, false);
  assert.equal(result.decision.web_policy, "required");
  assert.equal(result.judge_status, "unavailable");
});

test("judge unavailable in enforce mode + SR=required + no hard signal → degrade to optional", () => {
  const decision = { web_policy: "required", source_mode: "single_lookup" };
  const result = applyJudgeVerdict({
    decision,
    signals: {},
    judgeError: new Error("api key missing"),
    mode: "enforce"
  });
  assert.equal(result.applied, true, "fallback rule must degrade required → optional");
  assert.equal(result.decision.web_policy, "optional");
  assert.equal(result.judge_status, "unavailable");
});

test("judge unavailable in enforce mode + SR=required + URL hard signal → keep required", () => {
  const decision = { web_policy: "required", source_mode: "single_lookup" };
  const result = applyJudgeVerdict({
    decision,
    signals: { explicit_single_url: { matched: true } },
    judgeError: new Error("network"),
    mode: "enforce"
  });
  assert.equal(result.applied, false);
  assert.equal(result.decision.web_policy, "required");
});

test("judge unavailable in enforce mode + SR=forbidden → kept (no degrade)", () => {
  const decision = { web_policy: "forbidden", source_mode: "no_external" };
  const result = applyJudgeVerdict({
    decision,
    signals: {},
    judgeError: new Error("schema invalid"),
    mode: "enforce"
  });
  assert.equal(result.applied, false);
  assert.equal(result.decision.web_policy, "forbidden");
});

test("invalid judge payload (missing verdict) → judge_status invalid_payload, no change", () => {
  const decision = { web_policy: "required" };
  const result = applyJudgeVerdict({
    decision,
    judgePayload: { confidence: 0.9, reason: "some text" },
    mode: "enforce"
  });
  assert.equal(result.applied, false);
  assert.equal(result.judge_status, "invalid_payload");
});

test("reject without corrected_* fields is invalid (must change something)", () => {
  const decision = { web_policy: "required" };
  const result = applyJudgeVerdict({
    decision,
    judgePayload: {
      verdict: "reject",
      confidence: 0.8,
      reason: "I disagree",
      evidence_basis: []
    },
    mode: "enforce"
  });
  assert.equal(result.judge_status, "invalid_payload");
});

test("reject with no actual diff (same web_policy proposed) is treated as accept", () => {
  const decision = { web_policy: "required", source_mode: "single_lookup" };
  const result = applyJudgeVerdict({
    decision,
    judgePayload: {
      verdict: "reject",
      corrected_web_policy: "required",  // same as SR
      corrected_source_mode: "single_lookup",
      confidence: 0.9,
      reason: "actually I agree",
      evidence_basis: []
    },
    mode: "enforce"
  });
  assert.equal(result.applied, false);
  assert.equal(result.diff, null);
});

test("buildJudgePrompt includes user_command + SR decision subset + structural signals", () => {
  const prompt = buildJudgePrompt({
    text: "什么是 RAG",
    decision: { web_policy: "required", source_mode: "single_lookup" },
    signals: { explicit_search: { matched: false } }
  });
  assert.ok(prompt.includes("什么是 RAG"));
  assert.ok(prompt.includes('"web_policy":"required"'));
  assert.ok(prompt.includes("structural_signals_present"));
  // Must NOT leak any topic-regex / dictionary into the prompt.
  assert.ok(!prompt.includes("LEARNING_VERB_RE"));
  assert.ok(!prompt.includes("FRESHNESS_TOPIC_WORD_RE"));
});

test("runRouteVerifier integration — invokeJudge stub returns reject → shadow logs diff", async () => {
  const decision = { web_policy: "required", source_mode: "single_lookup" };
  const result = await runRouteVerifier({
    text: "什么是 RAG",
    decision,
    signals: {},
    invokeJudge: async () => ({
      verdict: "reject",
      corrected_web_policy: "forbidden",
      corrected_source_mode: "no_external",
      confidence: 0.9,
      reason: "stable QA",
      evidence_basis: ["concept query without freshness"]
    }),
    mode: "shadow"
  });
  assert.equal(result.applied, false);
  assert.deepEqual(result.diff.web_policy, { from: "required", to: "forbidden" });
});

test("runRouteVerifier integration — invokeJudge throws → captured as judgeError", async () => {
  const decision = { web_policy: "required", source_mode: "single_lookup" };
  const result = await runRouteVerifier({
    text: "什么是 RAG",
    decision,
    signals: {},
    invokeJudge: async () => { throw new Error("provider down"); },
    mode: "shadow"
  });
  assert.equal(result.judge_status, "unavailable");
  assert.ok(result.reason.includes("provider down"));
});

test("runRouteVerifier — missing invokeJudge gracefully degrades", async () => {
  const decision = { web_policy: "required" };
  const result = await runRouteVerifier({
    text: "test",
    decision,
    mode: "shadow"
  });
  assert.equal(result.judge_status, "unavailable");
  assert.ok(result.reason.includes("invokeJudge_missing"));
});
