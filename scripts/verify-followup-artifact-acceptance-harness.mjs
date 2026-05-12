#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHECK_COMMANDS, FAST_CHECK_COMMANDS } from "./check-manifest.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const file = (rel) => path.join(root, rel);
const read = (rel) => readFileSync(file(rel), "utf8");

const runnerPath = "scripts/real-llm-test/run-followup-artifact-acceptance.mjs";
assert.ok(existsSync(file(runnerPath)), `missing ${runnerPath}`);

const runner = read(runnerPath);
const packageJson = JSON.parse(read("package.json"));
const roadmap = read("docs/architecture/post-runtime-upgrade-roadmap.md");

for (const required of [
  "LINGXY_FOLLOWUP_ARTIFACT_ACCEPTANCE",
  "--live",
  "html_artifact_created",
  "followup_html_from_artifact",
  "followup_execute_generated_artifact_check",
  "generated_script_file_content_consistency",
  "same_conversation_topic_switch",
  "new_topic_followup_isolation",
  "run_script",
  "artifactPaths",
  "pathCandidates",
  "console.log",
  "parent_task_id",
  "conversation_id",
  "cache_hit_tokens",
  "cache_miss_tokens",
  "not_displayed_token_trace_only",
  "redactLiveProviderAcceptanceReport"
]) {
  assert.ok(runner.includes(required), `runner missing ${required}`);
}

assert.match(runner, /readTextIfSmall/u, "runner must inspect generated artifact file contents");
assert.match(runner, /existsSync/u, "runner must verify generated artifact paths exist");
assert.match(runner, /generated_script_file_content_consistency/u,
  "runner must verify generated script file content before accepting execution claims");
assert.match(runner, /换个完全无关的问题/u, "runner must exercise same-conversation topic switching");
assert.match(runner, /把刚才那个数字乘以 4/u, "runner must verify new-topic follow-up isolation");
assert.match(runner, /读取上一个生成的 HTML 文件/u, "runner must validate generated artifact contents");

assert.equal(
  packageJson.scripts["real-llm:followup-artifact"],
  "node scripts/real-llm-test/run-followup-artifact-acceptance.mjs",
  "package.json must expose the follow-up artifact live runner"
);

const command = "node scripts/verify-followup-artifact-acceptance-harness.mjs";
assert.ok(CHECK_COMMANDS.includes(command), "check manifest must include follow-up artifact verifier");
assert.ok(FAST_CHECK_COMMANDS.includes(command), "fast check manifest must include follow-up artifact verifier");

for (const required of [
  "Follow-up artifact generation and execution acceptance",
  "real-llm:followup-artifact",
  "run-followup-artifact-acceptance.mjs",
  "topic switch",
  "generated artifact"
]) {
  assert.ok(roadmap.includes(required), `roadmap missing ${required}`);
}

console.log("[followup-artifact-acceptance] harness contract verified");
