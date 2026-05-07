/**
 * diff-runs.test.mjs — Plan P1 #1 invariants
 *
 * Tests `diffReports()` from scripts/real-llm-test/diff-runs.mjs.
 * Constructs synthetic baseline/candidate report fixtures and asserts
 * the diff classifies each case correctly.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { diffReports } from "../../scripts/real-llm-test/diff-runs.mjs";

function makeReport(results) {
  return {
    summary: {},
    results
  };
}

function makeResult(id, { passed = true, reasons = [], status = passed ? "success" : "failed", elapsedMs = 1000 } = {}) {
  return {
    id,
    grade: { passed, reasons, status },
    elapsedMs
  };
}

test("diff: pure stable run reports zero deltas", () => {
  const a = makeReport([
    makeResult("X.alpha"),
    makeResult("X.beta", { passed: false, reasons: ["timeout"] })
  ]);
  const b = makeReport([
    makeResult("X.alpha"),
    makeResult("X.beta", { passed: false, reasons: ["timeout"] })
  ]);
  const d = diffReports(a, b);
  assert.equal(d.summary.new_regressions, 0);
  assert.equal(d.summary.new_passes, 0);
  assert.equal(d.summary.reason_changes, 0);
  assert.equal(d.summary.stable_passing, 1);
  assert.equal(d.summary.stable_failing, 1);
});

test("diff: pass→fail surfaces a new regression with the candidate's reason", () => {
  const a = makeReport([makeResult("X.alpha")]);
  const b = makeReport([makeResult("X.alpha", { passed: false, reasons: ["broke"] })]);
  const d = diffReports(a, b);
  assert.equal(d.summary.new_regressions, 1);
  assert.equal(d.new_regressions[0].id, "X.alpha");
  assert.equal(d.new_regressions[0].reason, "broke");
});

test("diff: fail→pass surfaces a newly passing case with the previous reason", () => {
  const a = makeReport([makeResult("X.alpha", { passed: false, reasons: ["was_broken"] })]);
  const b = makeReport([makeResult("X.alpha")]);
  const d = diffReports(a, b);
  assert.equal(d.summary.new_passes, 1);
  assert.equal(d.new_passes[0].id, "X.alpha");
  assert.equal(d.new_passes[0].previousReason, "was_broken");
});

test("diff: still-failing with a different reason is a reason_change, not a regression", () => {
  const a = makeReport([makeResult("X.alpha", { passed: false, reasons: ["timeout"] })]);
  const b = makeReport([makeResult("X.alpha", { passed: false, reasons: ["missing_artifact"] })]);
  const d = diffReports(a, b);
  assert.equal(d.summary.new_regressions, 0);
  assert.equal(d.summary.reason_changes, 1);
  assert.equal(d.reason_changes[0].before, "timeout");
  assert.equal(d.reason_changes[0].after, "missing_artifact");
});

test("diff: cases only in baseline / only in candidate surface as corpus drift", () => {
  const a = makeReport([
    makeResult("X.alpha"),
    makeResult("X.removed")
  ]);
  const b = makeReport([
    makeResult("X.alpha"),
    makeResult("X.added")
  ]);
  const d = diffReports(a, b);
  assert.equal(d.summary.only_in_baseline, 1);
  assert.equal(d.summary.only_in_candidate, 1);
  assert.deepEqual(d.only_in_baseline.map((r) => r.id), ["X.removed"]);
  assert.deepEqual(d.only_in_candidate.map((r) => r.id), ["X.added"]);
});

test("diff: latency drift fires when ratio crosses 2.5x and case is above floor", () => {
  const a = makeReport([
    makeResult("X.slow", { elapsedMs: 1000 }),
    makeResult("X.noisy", { elapsedMs: 100 })  // below floor — must be ignored
  ]);
  const b = makeReport([
    makeResult("X.slow", { elapsedMs: 4000 }),  // 4x slower → flagged
    makeResult("X.noisy", { elapsedMs: 600 })   // 6x ratio but below floor on baseline; max is 600, above floor
  ]);
  const d = diffReports(a, b);
  assert.equal(d.latency_drift.length >= 1, true);
  assert.ok(d.latency_drift.some((r) => r.id === "X.slow" && r.ratio >= 2.5));
});

test("diff: latency drift below floor is suppressed", () => {
  const a = makeReport([makeResult("X.tiny", { elapsedMs: 50 })]);
  const b = makeReport([makeResult("X.tiny", { elapsedMs: 200 })]);  // 4x ratio but max < 500ms floor
  const d = diffReports(a, b);
  assert.equal(d.latency_drift.length, 0);
});

test("diff: results without an id are silently skipped", () => {
  const a = makeReport([makeResult("X.a"), { grade: { passed: true } /* no id */ }]);
  const b = makeReport([makeResult("X.a")]);
  const d = diffReports(a, b);
  assert.equal(d.summary.stable_passing, 1);
  assert.equal(d.summary.only_in_baseline, 0);
});
