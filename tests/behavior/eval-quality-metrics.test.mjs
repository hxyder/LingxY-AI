import test from "node:test";
import assert from "node:assert/strict";

import {
  computeCaseEvalMetrics,
  summariseEvalMetrics
} from "../../scripts/real-llm-test/eval-metrics.mjs";

function result(overrides = {}) {
  return {
    id: "case",
    category: "demo",
    grade: {
      passed: true,
      status: "success",
      reasons: [],
      warnings: []
    },
    metrics: {
      elapsed_ms: 1200,
      failed_tool_count: 0,
      tool_count: 1,
      artifact_count: 0,
      text_delta_count: 4,
      llm_usage_call_count: 1,
      phase_timing: {
        executor_first_visible_output: 300
      },
      token_usage_source: "llm_usage",
      token_usage: {
        total_tokens: 900,
        input_tokens: 700,
        output_tokens: 200
      }
    },
    ...overrides
  };
}

test("eval metrics score a clean pass without attention flags", () => {
  const metrics = computeCaseEvalMetrics(result());

  assert.equal(metrics.outcome, "passed");
  assert.equal(metrics.quality_score, 1);
  assert.equal(metrics.efficiency_score, 100);
  assert.deepEqual(metrics.attention_flags, []);
});

test("eval metrics distinguish partial, blocked, and inefficient cases", () => {
  const summary = summariseEvalMetrics([
    result({ id: "pass" }),
    result({
      id: "partial",
      grade: { passed: false, status: "partial_success", reasons: ["missing_artifact"], warnings: [] },
      metrics: {
        elapsed_ms: 70_000,
        failed_tool_count: 1,
        tool_count: 2,
        artifact_count: 0,
        text_delta_count: 0,
        phase_timing: { executor_first_visible_output: 16_000 },
        token_usage_source: "llm_usage",
        token_usage: { total_tokens: 160_000 }
      }
    }),
    result({
      id: "blocked",
      grade: { passed: false, blocked: true, status: "blocked", reasons: ["live_write_blocked: guard"], warnings: [] },
      metrics: {
        elapsed_ms: 5,
        failed_tool_count: 0,
        tool_count: 0,
        artifact_count: 0,
        text_delta_count: 0,
        phase_timing: {},
        token_usage_source: null,
        token_usage: null
      }
    })
  ]);

  assert.equal(summary.total, 3);
  assert.equal(summary.outcome_counts.passed, 1);
  assert.equal(summary.outcome_counts.partial, 1);
  assert.equal(summary.outcome_counts.blocked, 1);
  assert.equal(summary.quality_score_percent, 58.3);
  assert.equal(summary.tokens.cases_with_usage, 2);
  assert.deepEqual(summary.top_failure_kinds[0], ["missing_artifact", 1]);
  assert.ok(summary.top_attention_flags.some(([flag]) => flag === "very_slow_first_visible"));
});
