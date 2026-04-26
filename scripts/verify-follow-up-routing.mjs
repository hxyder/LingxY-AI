#!/usr/bin/env node
/**
 * UCA-077 P4-02.x C4 (plan p4-03-p4-02-goofy-forest): short follow-up
 * routing regression.
 *
 * Drives `createTaskSpec` against `tests/routing/follow-up-cases.jsonl`
 * and asserts:
 *
 *   - "需要" / "继续" / "是的" / "yes" after an assistant offer that
 *     mentions a high-freshness entity (weather / news / stock / flight /
 *     etc.) → `web_search_fetch.mode === "required"`,
 *     `suggested_executor === "tool_using"`.
 *   - The same short affirmatives WITHOUT an offer in conversation_turns
 *     → unchanged (web=forbidden, executor=fast).
 *   - Non-affirmative replies (e.g. "新建一个文档吧") even with an offer
 *     → unchanged.
 *   - Affirmatives after a non-external offer (e.g. "修改文档") → unchanged.
 *
 * Bug 2 reproduction: pre-fix, "需要" after the weather offer routed to
 * `fast` (Rule 5: qa+forbidden→fast) because the 2-char command matched
 * no signal of its own; assistant's offer was lost. The pending-offer
 * detector + resolver short-circuit close that gap.
 *
 * Run: node scripts/verify-follow-up-routing.mjs
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createTaskSpec } from "../src/service/core/task-spec.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.resolve(__dirname, "..", "tests", "routing", "follow-up-cases.jsonl");

function loadCases() {
  const raw = readFileSync(CASES_PATH, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//"))
    .map((line, idx) => {
      try { return JSON.parse(line); }
      catch (err) { throw new Error(`parse line ${idx + 1}: ${err.message}\n${line}`); }
    });
}

function runCase(testCase) {
  const text = testCase.input ?? "";
  const ctx = testCase.context ?? {};
  const spec = createTaskSpec(text, ctx, {});
  return {
    web: spec.tool_policy?.web_search_fetch?.mode ?? "(missing)",
    executor: spec.suggested_executor,
    pending_offer_matched: spec.contract?.evidence?.some((e) => e.source === "pending_offer") ?? false
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
  for (const testCase of cases) {
    const id = testCase.id ?? "(unnamed)";
    const actual = runCase(testCase);
    const diff = compare(actual, testCase.expected ?? {});
    if (diff.length === 0) {
      pass += 1;
      process.stdout.write(`PASS ${id.padEnd(40)} ${JSON.stringify(testCase.input)}\n`);
    } else {
      fail += 1;
      process.stdout.write(`FAIL ${id.padEnd(40)} ${diff.join(" / ")}\n`);
    }
  }
  process.stdout.write(`\n${pass} pass / ${fail} fail / ${cases.length} total\n`);
  if (fail > 0) process.exit(1);
}

main();
