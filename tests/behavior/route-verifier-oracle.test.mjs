/**
 * route-verifier-oracle.test.mjs — C18 #C' round-7 (codex round-6 #6)
 *
 * Apply-level oracle test for `applyJudgeVerdict`. The grid test
 * (evidence-axes-grid.test.mjs) covers the algebra; this one covers
 * the *apply semantics* — the framework-level invariants that hold
 * for any (decision, signals, judgePayload, mode) combination.
 *
 * The user's `feedback_no_test_case_patches.md` calls for invariant
 * oracles instead of growing case-by-case sample tests. New apply-
 * level rules should land here as new invariants over the
 * representative input matrix below, not as 50th hand-crafted
 * sample.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  applyJudgeVerdict,
  detectHardStructuralSignals
} from "../../src/service/core/intent/route-verifier.mjs";
import {
  isExternalSourceMode,
  isLocalSourceMode,
  detectEvidenceInconsistency,
  deriveNeedsExternalInfo
} from "../../src/service/core/intent/evidence-axes.mjs";

// Representative inputs. Not exhaustive — that would be 3 (verdicts)
// × 3 (web_policies)² × 5 (source_modes)² × 2 (current)² × … ≈ 1000s.
// We pick the cells that exercise each apply-level invariant.
function* inputs() {
  const decisions = [
    { web_policy: "required",  source_mode: "single_lookup",   needs_current_information: true,  needs_external_info: true  },
    { web_policy: "required",  source_mode: "single_lookup",   needs_current_information: true,  needs_external_info: false /* stale */ },
    { web_policy: "forbidden", source_mode: "no_external",     needs_current_information: false, needs_external_info: false },
    { web_policy: "optional",  source_mode: "provided_context", needs_current_information: false, needs_external_info: false }
  ];
  const signalSets = [
    {},
    { explicit_search: { matched: true } },
    { local_only_constraint: { matched: true } },
    { weak_freshness: { matched: true } }
  ];
  const verdicts = [
    null,                                    // judge unavailable
    { verdict: "accept", confidence: 0.9, reason: "agreed", evidence_basis: [] },
    { verdict: "abstain", confidence: 0.4, reason: "ambiguous", evidence_basis: [] },
    { verdict: "reject", corrected_web_policy: "forbidden", corrected_source_mode: "no_external", corrected_needs_current_information: false, confidence: 0.9, reason: "stable", evidence_basis: [] },
    { verdict: "reject", corrected_web_policy: "required",  corrected_source_mode: "single_lookup", corrected_needs_current_information: true,  confidence: 0.9, reason: "fresh", evidence_basis: [] }
  ];
  for (const decision of decisions) {
    for (const signals of signalSets) {
      for (const judgePayload of verdicts) {
        for (const mode of ["shadow", "enforce"]) {
          yield { decision, signals, judgePayload, mode };
        }
      }
    }
  }
}

test("apply oracle: shadow mode never changes the decision", () => {
  for (const args of inputs()) {
    if (args.mode !== "shadow") continue;
    const judgeError = args.judgePayload === null ? new Error("test_unavailable") : null;
    const result = applyJudgeVerdict({
      ...args,
      judgePayload: judgeError ? null : args.judgePayload,
      judgeError
    });
    assert.equal(result.applied, false,
      `shadow must never apply: ${JSON.stringify(args)}`);
    assert.equal(result.decision, args.decision,
      `shadow must return the same decision reference: ${JSON.stringify(args)}`);
  }
});

test("apply oracle: every applied enforce result is axis-consistent", () => {
  for (const args of inputs()) {
    if (args.mode !== "enforce") continue;
    if (args.judgePayload === null) continue;
    const result = applyJudgeVerdict(args);
    if (!result.applied) continue;
    const violations = detectEvidenceInconsistency(result.decision);
    assert.deepEqual(violations, [],
      `applied decision violated axis invariant: ${JSON.stringify(args)} → ${JSON.stringify(result.decision)} (${violations.join(",")})`);
  }
});

test("apply oracle: enforce-applied decision has needs_external_info derived from final state", () => {
  for (const args of inputs()) {
    if (args.mode !== "enforce") continue;
    if (args.judgePayload === null) continue;
    const result = applyJudgeVerdict(args);
    if (!result.applied) continue;
    const expected = deriveNeedsExternalInfo({
      web_policy: result.decision.web_policy,
      source_mode: result.decision.source_mode,
      needs_current_information: result.decision.needs_current_information
    });
    assert.equal(result.decision.needs_external_info, expected,
      `enforce-applied decision must have derived needs_external_info: ${JSON.stringify(args)} → ${JSON.stringify(result.decision)}`);
  }
});

test("apply oracle: judge_status enumeration is closed", () => {
  // Only known status codes can come out. New ones force a deliberate
  // test update — protects against silent state-machine drift.
  const allowed = new Set([
    "ok",
    "abstain",
    "unavailable",
    "invalid_payload",
    "hard_signal_override",
    "inconsistent_correction"
  ]);
  for (const args of inputs()) {
    const judgeError = args.judgePayload === null ? new Error("test_unavailable") : null;
    const result = applyJudgeVerdict({
      ...args,
      judgePayload: judgeError ? null : args.judgePayload,
      judgeError
    });
    assert.ok(allowed.has(result.judge_status),
      `unknown judge_status '${result.judge_status}' for ${JSON.stringify(args)}`);
  }
});

test("apply oracle: floor fires before veto when both conditions hold", () => {
  // Construct a case where the correction is BOTH inconsistent AND
  // would trip a hard signal. Floor must win.
  const result = applyJudgeVerdict({
    decision: { web_policy: "optional", source_mode: "provided_context" },
    signals: { explicit_search: { matched: true } },
    judgePayload: {
      verdict: "reject",
      corrected_web_policy: "required",       // hard upgrade
      corrected_source_mode: "no_external",   // inconsistent (required + no_external)
      confidence: 0.9,
      reason: "broken",
      evidence_basis: []
    },
    mode: "enforce"
  });
  assert.equal(result.judge_status, "inconsistent_correction",
    "floor must win when both floor and veto would fire");
});

test("apply oracle: shadow diff is shape-equivalent to enforce diff", () => {
  // For inputs that reach the apply path, shadow and enforce should
  // produce the same `diff` (key set + values), differing only in
  // `applied` and `decision` reference. Codex round-6 #A: this is
  // the "what enforce would do" signal corpus telemetry needs.
  for (const args of inputs()) {
    if (args.judgePayload === null) continue;
    const shadowResult = applyJudgeVerdict({ ...args, mode: "shadow" });
    const enforceResult = applyJudgeVerdict({ ...args, mode: "enforce" });
    if (!shadowResult.diff && !enforceResult.diff) continue;
    if (shadowResult.judge_status !== "ok" && enforceResult.judge_status !== "ok") continue;
    // Both ok: diffs should match (modulo which is applied).
    if (shadowResult.judge_status === "ok" && enforceResult.judge_status === "ok") {
      assert.deepEqual(
        shadowResult.diff,
        enforceResult.diff,
        `shadow/enforce diff mismatch for ${JSON.stringify(args)}: shadow=${JSON.stringify(shadowResult.diff)} enforce=${JSON.stringify(enforceResult.diff)}`
      );
    }
  }
});

test("apply oracle: hard_signal_override carries the correct direction tag", () => {
  // For each veto we construct, the reason string must indicate the
  // direction (upgrade/downgrade) and which field tripped.
  const result = applyJudgeVerdict({
    decision: { web_policy: "forbidden", source_mode: "no_external" },
    signals: { local_only_constraint: { matched: true } },
    judgePayload: {
      verdict: "reject",
      corrected_web_policy: "required",
      corrected_source_mode: "single_lookup",  // consistent triple
      confidence: 0.9,
      reason: "judge wants external",
      evidence_basis: []
    },
    mode: "enforce"
  });
  assert.equal(result.judge_status, "hard_signal_override");
  assert.match(result.reason, /hard_signals_block_(web_policy|source_mode)_upgrade/);
});

test("apply oracle: judge_unavailable in shadow never changes anything", () => {
  for (const args of inputs()) {
    if (args.mode !== "shadow") continue;
    const result = applyJudgeVerdict({
      decision: args.decision,
      signals: args.signals,
      judgeError: new Error("network down"),
      mode: "shadow"
    });
    assert.equal(result.applied, false);
    assert.equal(result.judge_status, "unavailable");
  }
});

// ── Round-8 oracle additions (codex round-7 #5) ─────────────────────────

test("apply oracle: invalid payload is no-op with status invalid_payload across the matrix", () => {
  // A judge response that misses verdict / has bad confidence /
  // rejects without corrections must be a no-op for every input
  // shape — no field of the decision changes.
  const invalidPayloads = [
    null,                                                    // null is also invalid (but goes through judgeError path; skip)
    { confidence: 0.9, reason: "missing verdict" },
    { verdict: "bogus", confidence: 0.9, reason: "bad" },
    { verdict: "reject", confidence: 0.9, reason: "no corrected_*", evidence_basis: [] },
    { verdict: "accept", confidence: 1.5, reason: "out of range" }
  ];
  for (const args of inputs()) {
    for (const payload of invalidPayloads) {
      if (payload === null) continue;  // null payload routes through judgeError, separate test
      const result = applyJudgeVerdict({ ...args, judgePayload: payload });
      assert.equal(result.applied, false,
        `invalid payload must be no-op: ${JSON.stringify(args)} | payload=${JSON.stringify(payload)}`);
      assert.equal(result.judge_status, "invalid_payload",
        `invalid payload must surface status=invalid_payload: ${JSON.stringify(payload)}`);
    }
  }
});

test("apply oracle: source_mode-only correction satisfies axis + derived needs_external_info on apply", () => {
  // A judge that only changes source_mode (no web_policy /
  // needs_current change) must still produce a consistent enforce
  // decision — otherwise the apply path is doing the wrong thing.
  const decision = { web_policy: "optional", source_mode: "no_external", needs_current_information: false, needs_external_info: false };
  const result = applyJudgeVerdict({
    decision,
    signals: {},
    judgePayload: {
      verdict: "reject",
      corrected_source_mode: "single_lookup",  // optional + single_lookup is consistent
      confidence: 0.9,
      reason: "needs single lookup",
      evidence_basis: []
    },
    mode: "enforce"
  });
  assert.equal(result.applied, true);
  assert.equal(result.decision.source_mode, "single_lookup");
  assert.equal(result.decision.web_policy, "optional", "web_policy untouched by source_mode-only correction");
  // Round-6 invariant: derived needs_external_info reflects final state.
  assert.equal(result.decision.needs_external_info, deriveNeedsExternalInfo(result.decision));
});

test("apply oracle: needs_current-only correction satisfies axis + derive on apply", () => {
  const decision = { web_policy: "optional", source_mode: "single_lookup", needs_current_information: false, needs_external_info: true };
  const result = applyJudgeVerdict({
    decision,
    signals: {},
    judgePayload: {
      verdict: "reject",
      corrected_needs_current_information: true,  // bumps needs_current up; web/source already external
      confidence: 0.9,
      reason: "fresh signal",
      evidence_basis: []
    },
    mode: "enforce"
  });
  assert.equal(result.applied, true);
  assert.equal(result.decision.needs_current_information, true);
});

test("apply oracle: reject with no actual diff is normalized to ok no-op", () => {
  // Codex round-7 #5: a reject that doesn't actually change any
  // field must NOT count as a valid correction. The verifier
  // should normalize it to a no-op with judge_status=ok rather
  // than letting it sit in invalid_payload land (it parsed fine).
  const decision = { web_policy: "required", source_mode: "single_lookup", needs_current_information: true };
  const result = applyJudgeVerdict({
    decision,
    judgePayload: {
      verdict: "reject",
      corrected_web_policy: "required",         // same as decision
      corrected_source_mode: "single_lookup",   // same as decision
      corrected_needs_current_information: true, // same as decision
      confidence: 0.9,
      reason: "actually I agree",
      evidence_basis: []
    },
    mode: "enforce"
  });
  assert.equal(result.applied, false, "no-diff reject must be no-op");
  assert.equal(result.judge_status, "ok", "no-diff reject must be normalized to ok (not invalid_payload)");
});
