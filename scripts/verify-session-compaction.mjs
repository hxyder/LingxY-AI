import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

function read(path) {
  assert.ok(existsSync(path), `Missing required file: ${path}`);
  return readFileSync(path, "utf8");
}

const schema = read("src/service/core/store/sqlite-schema.mjs");
const memoryStore = read("src/service/core/store/memory-store.mjs");
const sqliteStore = read("src/service/core/store/sqlite-store.mjs");
const service = read("src/service/core/session/session-compaction-service.mjs");
const runtimeServices = read("src/service/core/task-runtime/runtime-services.mjs");
const contextCompiler = read("src/service/core/context/context-compiler.mjs");
const tests = read("tests/behavior/session-compaction-service.test.mjs")
  + read("tests/behavior/context-compiler.test.mjs");
const docs = read("docs/architecture/agent-runtime-spine.md");

assert.match(schema, /session_compactions/, "sqlite schema must include session_compactions");
assert.match(schema, /idx_session_compactions_session/, "sqlite schema must index session compactions by session");
assert.match(schema, /idx_session_compactions_conversation/, "sqlite schema must index session compactions by conversation");

for (const [name, source] of [
  ["memory-store", memoryStore],
  ["sqlite-store", sqliteStore]
]) {
  assert.match(source, /appendSessionCompaction/, `${name} must append session compactions`);
  assert.match(source, /listSessionCompactions/, `${name} must list session compactions`);
  assert.match(source, /getLatestSessionCompaction/, `${name} must expose latest session compaction`);
}

assert.match(service, /buildDeterministicSessionCompaction/, "service must expose deterministic compaction builder");
assert.match(service, /SESSION_COMPACTION_SCHEMA_VERSION/, "service must version compaction records");
assert.doesNotMatch(service, /chat\.completions|responses\.create|completePrompt|model/i,
  "session compaction must not call a model or prompt-only summarizer");

assert.match(runtimeServices, /createSessionCompactionService/, "runtime services must wire session compaction service");
assert.match(contextCompiler, /session_compaction/, "context compiler must select session compaction candidates");
assert.match(contextCompiler, /getLatestSessionCompaction/, "context compiler must read latest session compaction");

assert.match(tests, /compacts typed session items into a deterministic session_compaction record/,
  "tests must cover deterministic compaction record creation");
assert.match(tests, /advances incrementally and skips when no new range meets the gate/,
  "tests must cover incremental compaction gates");
assert.match(tests, /context compiler includes latest session compaction/,
  "tests must cover compiler inclusion of compaction");
assert.match(docs, /MX-002[\s\S]{0,80}\| Done \|/, "docs must mark MX-002 done");
assert.match(docs, /session_compactions/, "docs must describe session compaction storage");

console.log("[verify-session-compaction] session compaction contracts verified");
