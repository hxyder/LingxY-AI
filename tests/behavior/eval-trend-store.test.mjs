import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  appendEvalTrendRun,
  buildEvalTrendRun,
  compareEvalTrendRuns,
  readEvalTrendRuns
} from "../../scripts/real-llm-test/trend-store.mjs";

function summary(overrides = {}) {
  return {
    total: 3,
    passed: 2,
    passRate: 2 / 3,
    tokenUsage: { total_tokens: 9000, cases_with_usage: 3 },
    qualityMetrics: {
      total: 3,
      pass_rate: 2 / 3,
      blocked_rate: 1 / 3,
      partial_rate: 0,
      quality_score_percent: 73.3,
      efficiency_score_percent: 88.1,
      outcome_counts: { passed: 2, blocked: 1 },
      timing: {
        elapsed_ms_avg: 1000,
        elapsed_ms_p95: 2000,
        first_visible_ms_avg: 100,
        first_visible_ms_p95: 300
      },
      tokens: {
        cases_with_usage: 3,
        total_tokens_avg: 3000,
        total_tokens_p95: 5000
      },
      top_failure_kinds: [["blocked_by_policy", 1]],
      top_attention_flags: [["missing_token_usage", 1]]
    },
    ...overrides
  };
}

test("eval trend store builds a compact deterministic run record", () => {
  const run = buildEvalTrendRun({
    summary: summary(),
    runStartedAt: "2026-05-12T12:00:00.000Z",
    commit: "abc123",
    corpus: "./corpus.mjs"
  });

  assert.equal(run.schema_version, 1);
  assert.equal(run.commit, "abc123");
  assert.equal(run.total, 3);
  assert.equal(run.pass_rate, 0.6667);
  assert.equal(run.blocked_rate, 0.3333);
  assert.equal(run.tokens.total_tokens, 9000);
  assert.deepEqual(run.top_failure_classes, [["blocked_by_policy", 1]]);
  assert.ok(!JSON.stringify(run).includes("user_command"));
});

test("eval trend store appends JSONL and compares against the previous run", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "linxi-eval-trend-"));
  const file = path.join(dir, "eval-trends.jsonl");
  try {
    const first = buildEvalTrendRun({
      summary: summary(),
      runStartedAt: "2026-05-12T12:00:00.000Z",
      commit: "old"
    });
    const second = buildEvalTrendRun({
      summary: summary({
        passRate: 1,
        tokenUsage: { total_tokens: 12000 },
        qualityMetrics: {
          ...summary().qualityMetrics,
          pass_rate: 1,
          blocked_rate: 0,
          top_failure_kinds: [["new_failure", 1]]
        }
      }),
      runStartedAt: "2026-05-12T13:00:00.000Z",
      commit: "new"
    });

    appendEvalTrendRun(file, first);
    appendEvalTrendRun(file, second);

    const runs = readEvalTrendRuns(file);
    assert.equal(runs.length, 2);
    const comparison = compareEvalTrendRuns(runs[1], runs[0]);
    assert.equal(comparison.pass_rate_delta, 0.3333);
    assert.equal(comparison.blocked_rate_delta, -0.3333);
    assert.equal(comparison.total_tokens_delta, 3000);
    assert.deepEqual(comparison.top_failure_classes_added, ["new_failure"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
