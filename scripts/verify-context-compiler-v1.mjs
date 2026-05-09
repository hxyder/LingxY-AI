import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  assert.ok(existsSync(absolutePath), `Missing required file: ${relativePath}`);
  return readFileSync(absolutePath, "utf8");
}

const compiler = read("src/service/core/context/context-compiler.mjs");
const taskRecord = read("src/service/core/task-runtime/task-record.mjs");
const testSource = read("tests/behavior/context-compiler.test.mjs");
const taskRecordTest = read("tests/behavior/task-runtime-task-record.test.mjs");
const docs = `${read("docs/architecture/agent-runtime-spine.md")}\n${read("docs/architecture/electron-js-runtime-performance-plan.md")}`;

assert.match(compiler, /CONTEXT_ITEM_PRIORITIES/, "ContextCompiler V1 must define deterministic priorities");
assert.match(compiler, /SESSION_ITEM_KINDS/, "ContextCompiler V1 must compile typed session items");
assert.match(compiler, /follow_up_resolution/, "ContextCompiler V1 must compile FollowUpResolver decisions");
assert.match(compiler, /parent_task_summary/, "ContextCompiler V1 must compile parent task summaries");
assert.match(compiler, /session_tool_observation/, "ContextCompiler V1 must compile tool observations");
assert.match(compiler, /rankCandidates/, "ContextCompiler V1 must rank candidates deterministically");
assert.match(compiler, /inclusion_reason/, "ContextCompiler V1 selected items must carry inclusion reasons");
assert.doesNotMatch(compiler, /conversation_messages/, "ContextCompiler must not scrape visible conversation messages directly");
assert.doesNotMatch(compiler, /\b(?:readFileSync|writeFileSync|readdirSync|execSync|spawnSync|Atomics\.wait)\b/,
  "ContextCompiler V1 must not add blocking hot-path APIs");

assert.match(taskRecord, /compileContextForTask/, "task creation must stamp compiled context");
assert.match(taskRecord, /compiled_context/, "task context must carry compiled_context");
assert.match(taskRecord, /context_compile_error/, "task creation must fail soft on context compile errors");

assert.match(testSource, /typed session anchors and resolver decisions/, "tests must cover session item compilation");
assert.match(testSource, /current_user_command.*follow_up_resolution.*parent_task_summary/s,
  "tests must cover deterministic priority ordering");
assert.match(taskRecordTest, /compiled_context/, "task-record tests must cover compiled context stamping");

assert.match(docs, /CX-004[\s\S]{0,220}Done/, "runtime spine must mark CX-004 done");
assert.match(docs, /ContextCompiler V1[\s\S]{0,300}compiled_context/,
  "docs must describe ContextCompiler V1 task stamping");

console.log("[verify-context-compiler-v1] ContextCompiler V1 verified");
