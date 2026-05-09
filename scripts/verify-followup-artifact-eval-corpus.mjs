import fs from "node:fs";
import assert from "node:assert/strict";
import {
  FOLLOWUP_ARTIFACT_EVAL_CASES,
  FOLLOWUP_ARTIFACT_EVAL_MINIMUMS
} from "../src/service/core/evals/followup-artifact-corpus.mjs";
import {
  assertFollowupArtifactEvalReport,
  runFollowupArtifactEvalCorpus
} from "../src/service/core/evals/followup-artifact-evaluator.mjs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

const corpusSource = read("src/service/core/evals/followup-artifact-corpus.mjs");
const evaluatorSource = read("src/service/core/evals/followup-artifact-evaluator.mjs");
const resolverSource = read("src/service/core/session/follow-up-resolver.mjs");
const tests = read("tests/behavior/followup-artifact-eval-corpus.test.mjs");
const spine = read("docs/architecture/agent-runtime-spine.md");
const executionPlan = read("lingxy_electron_js_codex_execution_plan.md");
const runtimePlan = read("lingxy_codex_ready_agent_runtime_upgrade_plan.md");
const packageJson = read("package.json");

assert.ok(FOLLOWUP_ARTIFACT_EVAL_CASES.length >= 50,
  `expected at least 50 eval cases, got ${FOLLOWUP_ARTIFACT_EVAL_CASES.length}`);
const counts = {};
for (const item of FOLLOWUP_ARTIFACT_EVAL_CASES) {
  counts[item.category] = (counts[item.category] ?? 0) + 1;
}
for (const [category, minimum] of Object.entries(FOLLOWUP_ARTIFACT_EVAL_MINIMUMS)) {
  assert.ok(counts[category] >= minimum,
    `category ${category} requires ${minimum} cases, got ${counts[category] ?? 0}`);
}

const report = runFollowupArtifactEvalCorpus();
assertFollowupArtifactEvalReport(report);
for (const metric of [
  "wrong_parent_rate",
  "stale_artifact_rate",
  "unrelated_artifact_success",
  "missing_clarification_on_ambiguity",
  "ignored_correction",
  "fake_artifact_success"
]) {
  assert.equal(report.metrics[metric], 0, `${metric} must be zero`);
  assert.match(`${corpusSource}\n${evaluatorSource}`, new RegExp(metric), `corpus/eval contract must mention ${metric}`);
}

for (const category of Object.keys(FOLLOWUP_ARTIFACT_EVAL_MINIMUMS)) {
  assert.match(corpusSource, new RegExp(category), `corpus must include ${category}`);
}
assert.match(evaluatorSource, /resolveFollowUp/, "evaluator must run FollowUpResolver");
assert.match(evaluatorSource, /compileContextForTask/, "evaluator must run ContextCompiler");
assert.match(evaluatorSource, /followup_resolve_ms/, "evaluator must record follow-up timing");
assert.match(evaluatorSource, /context_compile_ms/, "evaluator must record context compiler timing");
assert.match(resolverSource, /\\bthat\\b|把这个转成 PPT|REFERENTIAL_FOLLOWUP/,
  "resolver must keep CJK/English referential follow-up support visible");
assert.match(tests, /keeps hard semantic metrics at zero/,
  "behavior test must enforce zero hard metrics");
assert.match(spine, /EX-001[\s\S]{0,260}Done/,
  "runtime spine must mark EX-001 done");
assert.match(executionPlan, /EX-001/,
  "execution plan must track EX-001 progress");
assert.match(runtimePlan, /FW-044[\s\S]{0,160}DONE/,
  "runtime plan must mark FW-044 done");
assert.match(packageJson, /verify:followup-artifact-eval-corpus/,
  "package.json must expose the eval corpus verifier");

console.log("[verify-followup-artifact-eval-corpus] follow-up/artifact eval corpus verified");
