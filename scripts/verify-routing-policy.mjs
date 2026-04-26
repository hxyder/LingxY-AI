#!/usr/bin/env node
/**
 * UCA-077 P1-09: Routing-policy regression runner.
 *
 * Reads tests/routing/web-search-policy-cases.jsonl and runs each case
 * through createTaskSpec(). Compares the resulting tool_policy and
 * suggested_executor against the expected values.
 *
 * This is the regression net for the Phase 1 work. It must stay green;
 * future signal/regex changes that break a case must justify the change
 * (i.e. add a new case explaining the new behaviour, not silently flip
 * an existing one).
 *
 * Run: node scripts/verify-routing-policy.mjs
 *      or `npm run verify:routing-policy`
 */

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createTaskSpec } from "../src/service/core/task-spec.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CASES_PATH = resolve(join(__dirname, "..", "tests", "routing", "web-search-policy-cases.jsonl"));

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
  const spec = createTaskSpec(text, ctx, {});
  return {
    web: spec.tool_policy?.web_search_fetch?.mode ?? "(missing)",
    executor: spec.suggested_executor,
    goal: spec.goal,
    reason: spec.tool_policy?.web_search_fetch?.reason ?? "",
    evidence: spec.tool_policy?.web_search_fetch?.evidence ?? []
  };
}

function compare(actual, expected) {
  const failures = [];
  if (expected.web && actual.web !== expected.web) {
    failures.push(`web=${actual.web} (expected ${expected.web})`);
  }
  if (expected.executor && actual.executor !== expected.executor) {
    failures.push(`executor=${actual.executor} (expected ${expected.executor})`);
  }
  return failures;
}

function main() {
  const cases = loadCases();
  let pass = 0;
  let fail = 0;
  const failures = [];

  for (const testCase of cases) {
    const id = testCase.id ?? "(unnamed)";
    const actual = runCase(testCase);
    const diff = compare(actual, testCase.expected ?? {});
    if (diff.length === 0) {
      pass++;
      process.stdout.write(`PASS ${id.padEnd(36)} ${JSON.stringify(testCase.input)}\n`);
    } else {
      fail++;
      failures.push({ id, input: testCase.input, actual, diff });
      process.stdout.write(
        `FAIL ${id.padEnd(36)} ${JSON.stringify(testCase.input)}\n   ${diff.join(" | ")}\n   reason: ${actual.reason}\n`
      );
    }
  }

  process.stdout.write(`\n${pass} pass / ${fail} fail / ${cases.length} total\n`);

  if (fail > 0) {
    process.stdout.write("\nFailing cases:\n");
    for (const f of failures) {
      process.stdout.write(`  ${f.id}: input=${JSON.stringify(f.input)}\n`);
      for (const d of f.diff) process.stdout.write(`    - ${d}\n`);
    }
    process.exit(1);
  }
}

main();
