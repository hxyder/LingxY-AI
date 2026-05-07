/**
 * evidence-axes-grid.test.mjs — C18 #C' round-6 (codex round-5 #D)
 *
 * Property/grid test over the full evidence-axis space:
 *   web_policy ∈ {required, optional, forbidden}
 *   source_mode ∈ {no_external, provided_context, single_lookup,
 *                  multi_source_research, deep_research}
 *   needs_current_information ∈ {true, false}
 *
 * This is 3 × 5 × 2 = 30 states. The test asserts the ALGEBRAIC
 * invariants hold on every state — invariants live in
 * `evidence-axes.mjs` and consumed by both verifier and
 * EvidencePolicy. New corner cases should be expressible as new
 * invariants over this grid, not new hand-crafted samples.
 *
 * The user's `feedback_no_test_case_patches.md` memory: "When fixing
 * a reproduction, the commit message must say WHICH layer changed
 * and WHY that's the right level. Adding a sibling pattern is the
 * last resort." A grid test is the framework-level oracle that
 * makes "another sibling pattern" unnecessary — adding a 40th
 * sample test is a smell; adding a new invariant over the grid is
 * the right move.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  EXTERNAL_SOURCE_MODES,
  LOCAL_SOURCE_MODES,
  isExternalSourceMode,
  isLocalSourceMode,
  deriveNeedsExternalInfo,
  normalizeEvidenceAxes,
  detectEvidenceInconsistency
} from "../../src/service/core/intent/evidence-axes.mjs";

const WEB_POLICIES = ["required", "optional", "forbidden"];
const SOURCE_MODES = [...EXTERNAL_SOURCE_MODES, ...LOCAL_SOURCE_MODES];
const NEEDS_CURRENT = [true, false];

function* gridStates() {
  for (const web_policy of WEB_POLICIES) {
    for (const source_mode of SOURCE_MODES) {
      for (const needs_current_information of NEEDS_CURRENT) {
        yield { web_policy, source_mode, needs_current_information };
      }
    }
  }
}

test("source_mode partition covers all enum values exactly once", () => {
  // Every value is in exactly one of EXTERNAL / LOCAL — no overlaps,
  // no missing entries. If a new source_mode is added later, it
  // must be classified explicitly.
  for (const m of SOURCE_MODES) {
    const ext = isExternalSourceMode(m);
    const loc = isLocalSourceMode(m);
    assert.ok(ext !== loc, `source_mode '${m}' must be exactly one of external/local; got external=${ext} local=${loc}`);
  }
  // 5 enum values total (3 external + 2 local).
  assert.equal(EXTERNAL_SOURCE_MODES.size + LOCAL_SOURCE_MODES.size, 5);
});

test("invariant: deriveNeedsExternalInfo(s) === true iff any of the three triggers", () => {
  for (const state of gridStates()) {
    const expected = state.needs_current_information === true
      || state.web_policy === "required"
      || isExternalSourceMode(state.source_mode);
    assert.equal(
      deriveNeedsExternalInfo(state),
      expected,
      `derive mismatch for ${JSON.stringify(state)}`
    );
  }
});

test("invariant: normalizeEvidenceAxes is idempotent", () => {
  // Applying normalize twice == applying it once.
  for (const state of gridStates()) {
    const decision = { ...state, needs_external_info: false /* stale */ };
    const once = normalizeEvidenceAxes(decision);
    const twice = normalizeEvidenceAxes(once);
    assert.deepEqual(twice, once,
      `normalize should be idempotent for ${JSON.stringify(state)}`);
  }
});

test("invariant: a normalized decision has consistent needs_external_info", () => {
  // After normalization, decision.needs_external_info equals the
  // derived value — no stale raw field can survive.
  for (const state of gridStates()) {
    const decision = { ...state, needs_external_info: !deriveNeedsExternalInfo(state) /* deliberately wrong */ };
    const normalized = normalizeEvidenceAxes(decision);
    assert.equal(
      normalized.needs_external_info,
      deriveNeedsExternalInfo(state),
      `normalize must overwrite stale needs_external_info for ${JSON.stringify(state)}`
    );
  }
});

test("invariant: detectEvidenceInconsistency surfaces all three forbidden combos and only those", () => {
  // Build a state intentionally and check whether it's flagged.
  for (const state of gridStates()) {
    const violations = detectEvidenceInconsistency(state);
    const expectedViolations = [];

    if (state.web_policy === "forbidden" && isExternalSourceMode(state.source_mode)) {
      expectedViolations.push("forbidden_with_external_source_mode");
    }
    if (state.web_policy === "required" && isLocalSourceMode(state.source_mode)) {
      expectedViolations.push("required_with_local_source_mode");
    }
    if (state.needs_current_information === true && state.web_policy === "forbidden") {
      expectedViolations.push("needs_current_with_forbidden");
    }

    assert.deepEqual(violations.sort(), expectedViolations.sort(),
      `inconsistency mismatch for ${JSON.stringify(state)}`);
  }
});

test("invariant: a self-consistent state never has detectEvidenceInconsistency violations", () => {
  // For every state where we've MANUALLY constructed a coherent
  // (web_policy, source_mode, needs_current_information) triple,
  // detectEvidenceInconsistency should be empty.
  const coherent = [
    { web_policy: "required",  source_mode: "single_lookup",        needs_current_information: true  },
    { web_policy: "required",  source_mode: "multi_source_research", needs_current_information: true  },
    { web_policy: "required",  source_mode: "deep_research",         needs_current_information: false },
    { web_policy: "optional",  source_mode: "single_lookup",         needs_current_information: false },
    { web_policy: "optional",  source_mode: "no_external",           needs_current_information: false },
    { web_policy: "optional",  source_mode: "provided_context",      needs_current_information: false },
    { web_policy: "forbidden", source_mode: "no_external",           needs_current_information: false },
    { web_policy: "forbidden", source_mode: "provided_context",      needs_current_information: false }
  ];
  for (const state of coherent) {
    assert.deepEqual(
      detectEvidenceInconsistency(state),
      [],
      `coherent state should have no inconsistencies: ${JSON.stringify(state)}`
    );
  }
});

test("invariant: needs_external_info=false implies a fully local route", () => {
  // Contrapositive of derive: if derive returns false, none of the
  // three external triggers fired.
  for (const state of gridStates()) {
    if (deriveNeedsExternalInfo(state) === false) {
      assert.notEqual(state.web_policy, "required",
        `derive=false but web_policy=required: ${JSON.stringify(state)}`);
      assert.equal(isExternalSourceMode(state.source_mode), false,
        `derive=false but source_mode=external: ${JSON.stringify(state)}`);
      assert.notEqual(state.needs_current_information, true,
        `derive=false but needs_current=true: ${JSON.stringify(state)}`);
    }
  }
});

test("invariant: normalizeEvidenceAxes preserves all non-axis fields", () => {
  const decision = {
    web_policy: "required",
    source_mode: "single_lookup",
    needs_current_information: true,
    needs_external_info: false,
    primary_intent: "research",
    rationale_summary: "user asked for current info",
    confidence: 0.9,
    needs_tool_use: true
  };
  const normalized = normalizeEvidenceAxes(decision);
  for (const key of ["primary_intent", "rationale_summary", "confidence", "needs_tool_use"]) {
    assert.equal(normalized[key], decision[key],
      `normalize must not touch field '${key}'`);
  }
});
