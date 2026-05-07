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

test("detectHardStructuralSignals returns directional buckets — block-upgrade vs block-downgrade", () => {
  // Local-only constraints block upgrades to required.
  const localOnly = detectHardStructuralSignals({ local_only_constraint: { matched: true } });
  assert.ok(localOnly.blockUpgrade.includes("local_only_constraint"));
  assert.equal(localOnly.blockDowngrade.length, 0);

  const noSearch = detectHardStructuralSignals({ explicit_no_search: { matched: true } });
  assert.ok(noSearch.blockUpgrade.includes("explicit_no_search"));
  assert.equal(noSearch.blockDowngrade.length, 0);

  // Search/URL/freshness signals block downgrades to forbidden.
  const search = detectHardStructuralSignals({ explicit_search: { matched: true } });
  assert.ok(search.blockDowngrade.includes("explicit_search"));
  assert.equal(search.blockUpgrade.length, 0);

  const fresh = detectHardStructuralSignals({ weak_freshness: { matched: true } });
  assert.ok(fresh.blockDowngrade.includes("weak_freshness"));
  assert.equal(fresh.blockUpgrade.length, 0);

  // Use of stale name `explicit_local_only` (caught in round-2)
  // should NOT surface — the canonical name is local_only_constraint.
  const stale = detectHardStructuralSignals({ explicit_local_only: { matched: true } });
  assert.equal(stale.blockUpgrade.length, 0);
  assert.equal(stale.blockDowngrade.length, 0);
});

test("hard signal block — local_only_constraint vetoes forbidden→required upgrade only", () => {
  const decision = { web_policy: "forbidden", source_mode: "no_external" };
  const upgrade = applyJudgeVerdict({
    decision,
    signals: { local_only_constraint: { matched: true } },
    judgePayload: {
      verdict: "reject",
      corrected_web_policy: "required",
      confidence: 0.9,
      reason: "judge wants external",
      evidence_basis: []
    },
    mode: "enforce"
  });
  assert.equal(upgrade.applied, false);
  assert.equal(upgrade.judge_status, "hard_signal_override");
  assert.ok(upgrade.reason.includes("hard_signals_block_web_policy_upgrade"));
});

test("hard signal block — explicit_search vetoes required→forbidden downgrade only", () => {
  const decision = { web_policy: "required", source_mode: "single_lookup" };
  const downgrade = applyJudgeVerdict({
    decision,
    signals: { explicit_search: { matched: true } },
    judgePayload: {
      verdict: "reject",
      corrected_web_policy: "forbidden",
      corrected_source_mode: "no_external",
      confidence: 0.9,
      reason: "judge thinks stable QA",
      evidence_basis: []
    },
    mode: "enforce"
  });
  assert.equal(downgrade.applied, false);
  assert.ok(downgrade.reason.includes("hard_signals_block_web_policy_downgrade"));
});

test("hard signal does NOT block correction in the other direction", () => {
  // local_only_constraint should NOT block a (correct) downgrade.
  const decision = { web_policy: "required", source_mode: "single_lookup" };
  const result = applyJudgeVerdict({
    decision,
    signals: { local_only_constraint: { matched: true } },
    judgePayload: {
      verdict: "reject",
      corrected_web_policy: "forbidden",
      corrected_source_mode: "no_external",
      confidence: 0.9,
      reason: "user said local-only and judge agrees",
      evidence_basis: []
    },
    mode: "enforce"
  });
  assert.equal(result.applied, true, "downgrade is consistent with local_only_constraint, must apply");
  assert.equal(result.decision.web_policy, "forbidden");
});

test("corrected_needs_current_information is a valid corrected field on its own", () => {
  const decision = { web_policy: "optional", source_mode: "no_external", needs_current_information: true };
  const result = applyJudgeVerdict({
    decision,
    judgePayload: {
      verdict: "reject",
      corrected_needs_current_information: false,
      confidence: 0.85,
      reason: "stable concept; needs_current is wrong",
      evidence_basis: []
    },
    mode: "enforce"
  });
  assert.equal(result.applied, true);
  assert.equal(result.decision.needs_current_information, false);
  assert.equal(result.decision.web_policy, "optional", "other fields untouched");
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

test("buildJudgePrompt schema mentions all three corrected_* fields (round-4 alignment)", () => {
  // Codex round-3 caught: code accepted corrected_needs_current_
  // information but the prompt didn't mention it, so judges in the
  // wild would never emit it. The prompt must reflect the schema.
  const prompt = buildJudgePrompt({
    text: "test",
    decision: { web_policy: "optional", source_mode: "provided_context" },
    signals: {}
  });
  assert.ok(prompt.includes("corrected_web_policy"), "prompt must list corrected_web_policy");
  assert.ok(prompt.includes("corrected_source_mode"), "prompt must list corrected_source_mode");
  assert.ok(prompt.includes("corrected_needs_current_information"), "prompt must list corrected_needs_current_information");
  // Consistency rule must be in the prompt so the judge avoids
  // emitting impossible combos that the consistency floor would
  // bounce.
  assert.ok(/consistent|inconsistent|never propose web_policy=forbidden/i.test(prompt),
    "prompt must instruct the judge about evidence-axis consistency");
});

test("source_mode directional veto — explicit_search blocks downgrade to no_external", () => {
  // Round-4 fix (codex round-3 #1): without source_mode in the
  // veto axis, judge could leave web_policy alone but flip
  // source_mode to no_external while explicit_search is set →
  // inconsistent state.
  const decision = { web_policy: "required", source_mode: "single_lookup" };
  const result = applyJudgeVerdict({
    decision,
    signals: { explicit_search: { matched: true } },
    judgePayload: {
      verdict: "reject",
      corrected_source_mode: "no_external",
      confidence: 0.9,
      reason: "judge thinks no source needed",
      evidence_basis: []
    },
    mode: "enforce"
  });
  assert.equal(result.applied, false);
  assert.equal(result.judge_status, "hard_signal_override");
  assert.ok(result.reason.includes("source_mode_downgrade"));
});

test("source_mode directional veto — local_only_constraint blocks upgrade to single_lookup", () => {
  const decision = { web_policy: "forbidden", source_mode: "no_external" };
  const result = applyJudgeVerdict({
    decision,
    signals: { local_only_constraint: { matched: true } },
    judgePayload: {
      verdict: "reject",
      corrected_source_mode: "single_lookup",
      corrected_web_policy: "required",
      confidence: 0.9,
      reason: "judge wants external",
      evidence_basis: []
    },
    mode: "enforce"
  });
  assert.equal(result.applied, false);
  assert.equal(result.judge_status, "hard_signal_override");
});

test("evidence-axis consistency floor — rejects required + no_external (correction creates inconsistency)", () => {
  // Round-4 (codex round-3 #3): final/corrected route must be
  // self-consistent across web_policy / source_mode / needs_current.
  const decision = { web_policy: "required", source_mode: "single_lookup" };
  const result = applyJudgeVerdict({
    decision,
    judgePayload: {
      verdict: "reject",
      corrected_source_mode: "no_external",  // would leave web_policy=required + source_mode=no_external
      confidence: 0.9,
      reason: "broken correction",
      evidence_basis: []
    },
    mode: "enforce"
  });
  assert.equal(result.applied, false);
  assert.equal(result.judge_status, "inconsistent_correction");
  assert.ok(result.reason.includes("required_with_no_external"));
});

test("evidence-axis consistency floor — rejects forbidden + single_lookup", () => {
  const decision = { web_policy: "optional", source_mode: "provided_context" };
  const result = applyJudgeVerdict({
    decision,
    judgePayload: {
      verdict: "reject",
      corrected_web_policy: "forbidden",
      corrected_source_mode: "single_lookup",  // contradictory
      confidence: 0.9,
      reason: "broken correction",
      evidence_basis: []
    },
    mode: "enforce"
  });
  assert.equal(result.applied, false);
  assert.equal(result.judge_status, "inconsistent_correction");
});

test("evidence-axis consistency floor — rejects needs_current=true + forbidden", () => {
  const decision = { web_policy: "optional", source_mode: "provided_context", needs_current_information: false };
  const result = applyJudgeVerdict({
    decision,
    judgePayload: {
      verdict: "reject",
      corrected_web_policy: "forbidden",
      corrected_needs_current_information: true,
      confidence: 0.9,
      reason: "broken",
      evidence_basis: []
    },
    mode: "enforce"
  });
  assert.equal(result.applied, false);
  assert.equal(result.judge_status, "inconsistent_correction");
});

test("evidence-axis consistency floor — accepts coherent triple change", () => {
  // Verifies the floor doesn't reject *valid* corrections.
  const decision = { web_policy: "required", source_mode: "single_lookup", needs_current_information: true };
  const result = applyJudgeVerdict({
    decision,
    judgePayload: {
      verdict: "reject",
      corrected_web_policy: "forbidden",
      corrected_source_mode: "no_external",
      corrected_needs_current_information: false,
      confidence: 0.9,
      reason: "stable QA",
      evidence_basis: []
    },
    mode: "enforce"
  });
  assert.equal(result.applied, true, "coherent triple change must apply");
  assert.equal(result.decision.web_policy, "forbidden");
  assert.equal(result.decision.source_mode, "no_external");
  assert.equal(result.decision.needs_current_information, false);
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
