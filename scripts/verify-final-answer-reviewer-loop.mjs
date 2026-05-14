import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const reviewer = readFileSync("src/service/executors/tool_using/final-reviewer.mjs", "utf8");
const composer = readFileSync("src/service/executors/tool_using/final-composer.mjs", "utf8");
const tests = readFileSync("tests/behavior/agent-loop-final-composer.test.mjs", "utf8");
const manifest = readFileSync("scripts/check-manifest.mjs", "utf8");
const roadmap = readFileSync("docs/architecture/post-runtime-upgrade-roadmap.md", "utf8");

assert.match(reviewer, /isFinalAnswerReviewerEnabled/u, "reviewer loop must expose an explicit feature gate");
assert.match(reviewer, /reviewer_loop/u, "reviewer loop must be gated by reviewer_loop task/config data");
assert.match(reviewer, /buildFinalAnswerReviewRiskProfile/u, "reviewer loop must classify artifact/connector/research risk");
assert.match(reviewer, /artifact_required/u, "reviewer loop must include artifact-required risk");
assert.match(reviewer, /research_quality/u, "reviewer loop must include research-quality risk");
assert.match(reviewer, /connector_or_side_effect/u, "reviewer loop must include connector/side-effect risk");
assert.match(reviewer, /resolveProviderForModelRole\("reviewer",\s*"reviewer"/u, "reviewer loop must bind to the reviewer model role");
assert.match(reviewer, /tool_using\.final_reviewer/u, "reviewer loop must emit llm_usage with a dedicated call site");
assert.match(reviewer, /review_budget_exceeded/u, "reviewer loop must enforce candidate/transcript budget gates");
assert.match(reviewer, /FINAL_REVIEW_TIMEOUT/u, "reviewer loop must enforce timeout gates");
assert.match(reviewer, /Accuracy check:/u, "reviewer loop must surface user-facing accuracy checks instead of raw reviewer notes");
assert.doesNotMatch(reviewer, /Reviewer note:/u, "reviewer loop must not leak raw reviewer-note labels into final answers");
assert.match(composer, /reviewFinalAnswer/u, "final composer must route candidate answers through the reviewer seam");

assert.match(tests, /stays disabled by default/u, "behavior tests must prove default reviewer loop is disabled");
assert.match(tests, /user-facing accuracy check instead of leaking reviewer internals/u, "behavior tests must prove no raw reviewer-note leak");
assert.match(tests, /degrades gracefully on reviewer failure/u, "behavior tests must prove reviewer failure degradation");

assert.match(manifest, /node scripts\/verify-final-answer-reviewer-loop\.mjs/u, "fast/full check manifest must include reviewer-loop verifier");
assert.match(roadmap, /MM-002: Reviewer And Voting Loops/u, "roadmap must keep MM-002 section");
assert.match(roadmap, /final-answer reviewer pass/u, "roadmap must document the implemented reviewer pass");

console.log("[verify-final-answer-reviewer-loop] MM-002 final-answer reviewer loop contract OK");
