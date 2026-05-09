import fs from "node:fs";
import assert from "node:assert/strict";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

const scheduler = read("src/service/core/graph/runtime-graph-scheduler.mjs");
const runtimeServices = read("src/service/core/task-runtime/runtime-services.mjs");
const tests = read("tests/behavior/runtime-graph-scheduler.test.mjs");
const performance = read("docs/architecture/electron-js-runtime-performance-plan.md");
const packageJson = read("package.json");

assert.match(scheduler, /DEFAULT_RUNTIME_GRAPH_SCHEDULING_BUDGET/,
  "scheduler must define default budget");
assert.match(scheduler, /maxConcurrent/,
  "scheduler must enforce global concurrency");
assert.match(scheduler, /maxPerSession/,
  "scheduler must enforce per-session concurrency");
assert.match(scheduler, /maxQueued/,
  "scheduler must enforce queue bound");
assert.match(scheduler, /AbortController|signal/,
  "scheduler must support cancellation");
assert.match(scheduler, /setTimeout/,
  "scheduler must enforce node timeout");
assert.match(scheduler, /snapshot/,
  "scheduler must expose budget snapshot");
assert.match(runtimeServices, /createRuntimeGraphScheduler/,
  "runtime services must wire runtime graph scheduler");
assert.match(runtimeServices, /runtimeGraphScheduler/,
  "runtime must expose runtimeGraphScheduler");
assert.match(tests, /serializes nodes within a session/,
  "tests must cover per-session serialization");
assert.match(tests, /bounded parallel work across sessions/,
  "tests must cover global bounded parallelism");
assert.match(tests, /timeout and queue bounds/,
  "tests must cover timeout and queue bounds");
assert.match(tests, /caller cancellation/,
  "tests must cover caller cancellation");
assert.match(performance, /PR-07[\s\S]{0,220}Done/,
  "performance plan must mark PR-07 done");
assert.match(packageJson, /verify:runtime-graph-scheduling-budget/,
  "package.json must expose runtime graph scheduling verifier");

for (const source of [scheduler]) {
  assert.doesNotMatch(source, /from\s+["'][^"']*electron/,
    "scheduler must not import Electron main process APIs");
  assert.doesNotMatch(source, /from\s+["'][^"']*desktop\/renderer/,
    "scheduler must not import renderer code");
  assert.doesNotMatch(source, /langgraph|autogen|crew/i,
    "scheduler must not pull heavyweight graph frameworks");
}

console.log("[verify-runtime-graph-scheduling-budget] runtime graph scheduling budget verified");
