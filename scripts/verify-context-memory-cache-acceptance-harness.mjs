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

const runnerPath = "scripts/real-llm-test/run-context-memory-cache-acceptance.mjs";
assert.ok(existsSync(file(runnerPath)), `missing ${runnerPath}`);

const runner = read(runnerPath);
const packageJson = JSON.parse(read("package.json"));
const roadmap = read("docs/architecture/post-runtime-upgrade-roadmap.md");

for (const required of [
  "LINGXY_CONTEXT_MEMORY_CACHE_ACCEPTANCE",
  "--live",
  "/config/user-memory",
  "/config/user-memory/proposals",
  "parent_task_id",
  "conversation_id",
  "project_id",
  "collectTokenMetrics",
  "cache_hit_tokens",
  "cache_miss_tokens",
  "not_displayed_token_trace_only",
  "redactLiveProviderAcceptanceReport",
  "detectLiveProviderAcceptanceSecretLeaks"
]) {
  assert.ok(runner.includes(required), `runner missing ${required}`);
}

assert.match(runner, /backupMemory/u, "runner must backup user memory before mutation");
assert.match(runner, /finally\s*\{/u, "runner must restore user memory in a finally block");
assert.match(runner, /POST \/task seed/u, "runner must exercise a seed/follow-up task chain");
assert.match(runner, /Reviewed memory approved by the user|已审核用户记忆/u,
  "runner must ask through the approved-memory path");
assert.match(runner, /Project acceptance marker/u, "runner must exercise project-scoped memory");

assert.equal(
  packageJson.scripts["real-llm:context-memory-cache"],
  "node scripts/real-llm-test/run-context-memory-cache-acceptance.mjs",
  "package.json must expose the context/memory/cache live runner"
);

const command = "node scripts/verify-context-memory-cache-acceptance-harness.mjs";
assert.ok(CHECK_COMMANDS.includes(command), "check manifest must include context/memory/cache verifier");
assert.ok(FAST_CHECK_COMMANDS.includes(command), "fast check manifest must include context/memory/cache verifier");

for (const required of [
  "Context, memory, follow-up, and cache acceptance",
  "real-llm:context-memory-cache",
  "run-context-memory-cache-acceptance.mjs",
  "token/cache",
  "user memory"
]) {
  assert.ok(roadmap.includes(required), `roadmap missing ${required}`);
}

console.log("[context-memory-cache-acceptance] harness contract verified");
