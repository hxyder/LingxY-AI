#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  computeCaseEvalMetrics,
  summariseEvalMetrics
} from "./real-llm-test/eval-metrics.mjs";
import { CHECK_COMMANDS, FAST_CHECK_COMMANDS } from "./check-manifest.mjs";

const runner = readFileSync("scripts/real-llm-test/run-corpus.mjs", "utf8");
assert.match(runner, /eval-metrics\.mjs/u, "run-corpus must import deterministic eval metrics");
assert.match(runner, /qualityMetrics:\s*summariseEvalMetrics\(results\)/u, "summary must include qualityMetrics");
assert.match(runner, /## Quality metrics/u, "Markdown report must render a Quality metrics section");
assert.doesNotMatch(runner, /llm[-_ ]as[-_ ]judge|judge_model|JUDGE_API_KEY/iu, "FW-023 deterministic metrics must not require an LLM judge");

const sample = summariseEvalMetrics([
  {
    id: "ok",
    category: "sample",
    grade: { passed: true, status: "success", reasons: [], warnings: [] },
    metrics: {
      elapsed_ms: 1000,
      failed_tool_count: 0,
      tool_count: 1,
      text_delta_count: 2,
      phase_timing: { executor_first_visible_output: 100 },
      token_usage_source: "llm_usage",
      token_usage: { total_tokens: 1000 }
    }
  },
  {
    id: "bad",
    category: "sample",
    grade: { passed: false, status: "failed", reasons: ["missing_external_web_read_call"], warnings: [] },
    metrics: {
      elapsed_ms: 200_000,
      failed_tool_count: 1,
      tool_count: 1,
      text_delta_count: 0,
      phase_timing: { executor_first_visible_output: 20_000 },
      token_usage_source: null,
      token_usage: null
    }
  }
]);

assert.equal(sample.total, 2);
assert.equal(sample.outcome_counts.passed, 1);
assert.equal(sample.outcome_counts.failed, 1);
assert.equal(sample.tokens.cases_with_usage, 1);
assert.ok(sample.top_attention_flags.some(([flag]) => flag === "very_slow_elapsed"));
assert.ok(sample.top_failure_kinds.some(([kind]) => kind === "missing_external_web_read_call"));

const one = computeCaseEvalMetrics({
  grade: { passed: true, status: "success", reasons: [], warnings: ["soft drift"] },
  metrics: { elapsed_ms: 1, phase_timing: {}, token_usage_source: null }
});
assert.equal(one.outcome, "passed_with_warnings");

const command = "node scripts/verify-eval-quality-metrics.mjs";
assert.ok(CHECK_COMMANDS.includes(command), "check manifest must include eval quality verifier");
assert.ok(FAST_CHECK_COMMANDS.includes(command), "fast check manifest must include eval quality verifier");

console.log("[verify-eval-quality-metrics] deterministic eval quality metrics contract OK");
