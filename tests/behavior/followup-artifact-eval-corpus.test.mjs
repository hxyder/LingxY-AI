import test from "node:test";
import assert from "node:assert/strict";

import {
  FOLLOWUP_ARTIFACT_EVAL_CASES,
  FOLLOWUP_ARTIFACT_EVAL_MINIMUMS
} from "../../src/service/core/evals/followup-artifact-corpus.mjs";
import {
  assertFollowupArtifactEvalReport,
  runFollowupArtifactEvalCorpus
} from "../../src/service/core/evals/followup-artifact-evaluator.mjs";
import { looksLikeFollowUpSignal } from "../../src/service/core/session/follow-up-resolver.mjs";

test("follow-up artifact eval corpus meets category minimums", () => {
  assert.ok(FOLLOWUP_ARTIFACT_EVAL_CASES.length >= 50);
  const counts = {};
  for (const item of FOLLOWUP_ARTIFACT_EVAL_CASES) {
    counts[item.category] = (counts[item.category] ?? 0) + 1;
  }
  for (const [category, minimum] of Object.entries(FOLLOWUP_ARTIFACT_EVAL_MINIMUMS)) {
    assert.ok(counts[category] >= minimum, `${category} has ${counts[category] ?? 0}, expected ${minimum}`);
  }
});

test("follow-up artifact eval corpus keeps hard semantic metrics at zero", () => {
  const report = runFollowupArtifactEvalCorpus();

  assertFollowupArtifactEvalReport(report);
  assert.equal(report.metrics.wrong_parent_rate, 0);
  assert.equal(report.metrics.stale_artifact_rate, 0);
  assert.equal(report.metrics.unrelated_artifact_success, 0);
  assert.equal(report.metrics.missing_clarification_on_ambiguity, 0);
  assert.equal(report.metrics.ignored_correction, 0);
  assert.equal(report.metrics.fake_artifact_success, 0);
  assert.ok(Number.isFinite(report.performance.max_followup_resolve_ms));
  assert.ok(Number.isFinite(report.performance.max_context_compile_ms));
});

test("follow-up resolver recognizes CJK referential phrases without whitespace boundaries", () => {
  assert.equal(looksLikeFollowUpSignal("把这个转成 PPT"), true);
  assert.equal(looksLikeFollowUpSignal("把它里面的数字格式统一"), true);
  assert.equal(looksLikeFollowUpSignal("给这个补一段摘要"), true);
});
