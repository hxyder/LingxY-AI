#!/usr/bin/env node
/**
 * UCA-077 P2-06: Executor-selection regression runner.
 *
 * Sister to verify-routing-policy.mjs. Where that runner asserts on
 * `tool_policy.web_search_fetch.mode`, this one asserts on the chosen
 * executor and TaskContract.mode — the Phase 2 outputs of the resolver
 * stack.
 *
 * Each JSONL case may carry a `routeSuggestion` field that becomes the
 * upstream intent-router's `suggested_executor`; the resolver must treat
 * it as evidence only and never let it override the rule outcome.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createTaskSpec } from "../src/service/core/task-spec.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CASES_PATH = resolve(join(__dirname, "..", "tests", "routing", "executor-selection-cases.jsonl"));

function loadCases() {
  const raw = readFileSync(CASES_PATH, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//"))
    .map((line, idx) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        throw new Error(`Failed to parse case at line ${idx + 1}: ${err.message}\n${line}`);
      }
    });
}

function runCase(testCase) {
  const text = testCase.input ?? "";
  const ctx = testCase.context ?? {};
  const route = testCase.routeSuggestion ? { suggested_executor: testCase.routeSuggestion } : {};
  const spec = createTaskSpec(text, ctx, route);
  return {
    executor: spec.suggested_executor,
    mode: spec.contract?.mode,
    goal: spec.goal,
    web: spec.tool_policy?.web_search_fetch?.mode,
    decisionStages: (spec.decision_trace ?? []).map((entry) => entry.stage),
    rejectedExecutors: spec.executor_decision?.rejected?.length ?? 0
  };
}

function compare(actual, expected) {
  const failures = [];
  if (expected.executor && actual.executor !== expected.executor) {
    failures.push(`executor=${actual.executor} (expected ${expected.executor})`);
  }
  if (expected.mode && actual.mode !== expected.mode) {
    failures.push(`mode=${actual.mode} (expected ${expected.mode})`);
  }
  return failures;
}

function main() {
  const cases = loadCases();
  let pass = 0;
  let fail = 0;

  for (const testCase of cases) {
    const id = testCase.id ?? "(unnamed)";
    const actual = runCase(testCase);
    const diff = compare(actual, testCase.expected ?? {});

    // Every case must produce a complete decision trace — three stages by
    // default. A missing stage is a regression no matter what the headline
    // assertion says.
    const expectedStages = ["goal-classification", "tool-policy", "executor-selection"];
    const missingStages = expectedStages.filter((s) => !actual.decisionStages.includes(s));
    for (const stage of missingStages) diff.push(`missing decision-trace stage: ${stage}`);

    if (diff.length === 0) {
      pass++;
      process.stdout.write(`PASS ${id.padEnd(40)} ${JSON.stringify(testCase.input)}\n`);
    } else {
      fail++;
      process.stdout.write(
        `FAIL ${id.padEnd(40)} ${JSON.stringify(testCase.input)}\n   ${diff.join(" | ")}\n   actual: ${JSON.stringify(actual)}\n`
      );
    }
  }

  process.stdout.write(`\n${pass} pass / ${fail} fail / ${cases.length} total\n`);
  if (fail > 0) process.exit(1);
}

main();
