#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { CHECK_COMMANDS, FAST_CHECK_COMMANDS } from "./check-manifest.mjs";
import {
  appendEvalTrendRun,
  buildEvalTrendRun,
  compareEvalTrendRuns,
  readEvalTrendRuns
} from "./real-llm-test/trend-store.mjs";

const trendStore = readFileSync("scripts/real-llm-test/trend-store.mjs", "utf8");
const runner = readFileSync("scripts/real-llm-test/run-corpus.mjs", "utf8");
const tests = readFileSync("tests/behavior/eval-trend-store.test.mjs", "utf8");
const roadmap = readFileSync("docs/architecture/post-runtime-upgrade-roadmap.md", "utf8");

for (const required of [
  "EVAL_TREND_SCHEMA_VERSION",
  "buildEvalTrendRun",
  "appendEvalTrendRun",
  "readEvalTrendRuns",
  "compareEvalTrendRuns",
  "pass_rate",
  "blocked_rate",
  "total_tokens",
  "elapsed_ms_p95",
  "top_failure_classes"
]) {
  assert.match(trendStore, new RegExp(required), `trend store missing ${required}`);
}

for (const required of [
  "eval-trends.jsonl",
  "buildEvalTrendRun",
  "compareEvalTrendRuns",
  "## Trend"
]) {
  assert.match(runner, new RegExp(required), `run-corpus must wire trend store: ${required}`);
}

for (const required of [
  "compact deterministic run record",
  "appends JSONL",
  "compares against the previous run"
]) {
  assert.match(tests, new RegExp(required), `trend store tests missing: ${required}`);
}

const dir = mkdtempSync(path.join(tmpdir(), "linxi-verify-eval-trend-"));
try {
  const file = path.join(dir, "eval-trends.jsonl");
  const base = {
    total: 2,
    passRate: 0.5,
    tokenUsage: { total_tokens: 1000 },
    qualityMetrics: {
      total: 2,
      pass_rate: 0.5,
      blocked_rate: 0.5,
      partial_rate: 0,
      timing: { elapsed_ms_p95: 2000 },
      tokens: { total_tokens_avg: 500, total_tokens_p95: 900, cases_with_usage: 2 },
      outcome_counts: { passed: 1, blocked: 1 },
      top_failure_kinds: [["blocked_by_policy", 1]],
      top_attention_flags: []
    }
  };
  const first = buildEvalTrendRun({ summary: base, runStartedAt: "2026-05-12T01:00:00.000Z" });
  const second = buildEvalTrendRun({
    summary: {
      ...base,
      passRate: 1,
      tokenUsage: { total_tokens: 1500 },
      qualityMetrics: {
        ...base.qualityMetrics,
        pass_rate: 1,
        blocked_rate: 0,
        top_failure_kinds: [["new_failure", 1]]
      }
    },
    runStartedAt: "2026-05-12T02:00:00.000Z"
  });
  appendEvalTrendRun(file, first);
  appendEvalTrendRun(file, second);
  const runs = readEvalTrendRuns(file);
  assert.equal(runs.length, 2);
  const diff = compareEvalTrendRuns(runs[1], runs[0]);
  assert.equal(diff.pass_rate_delta, 0.5);
  assert.equal(diff.blocked_rate_delta, -0.5);
  assert.deepEqual(diff.top_failure_classes_added, ["new_failure"]);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

assert.match(roadmap, /OQ-001: Eval Trend Store/u, "roadmap must keep OQ-001 section");
assert.match(roadmap, /scripts\/real-llm-test\/trend-store\.mjs/u,
  "roadmap must document trend store implementation");

const command = "node scripts/verify-eval-trend-store.mjs";
assert.ok(CHECK_COMMANDS.includes(command), "check manifest must include eval trend verifier");
assert.ok(FAST_CHECK_COMMANDS.includes(command), "fast check manifest must include eval trend verifier");

console.log("[verify-eval-trend-store] eval trend store contract OK");
