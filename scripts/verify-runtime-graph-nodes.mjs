import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

function read(path) {
  assert.ok(existsSync(path), `Missing required file: ${path}`);
  return readFileSync(path, "utf8");
}

const graph = read("src/service/core/graph/runtime-graph-checkpoints.mjs");
const taskRecord = read("src/service/core/task-runtime/task-record.mjs");
const eventEmitter = read("src/service/core/task-runtime/event-emitter.mjs");
const runtimeServices = read("src/service/core/task-runtime/runtime-services.mjs");
const tests = read("tests/behavior/runtime-graph-checkpoints.test.mjs")
  + read("tests/behavior/task-runtime-task-record.test.mjs");
const docs = read("docs/architecture/agent-runtime-spine.md");
const performance = read("docs/architecture/electron-js-runtime-performance-plan.md");

for (const node of [
  "ingest",
  "resolve_session",
  "resolve_followup",
  "compile_context",
  "plan",
  "act",
  "validate",
  "synthesize",
  "persist_session"
]) {
  assert.match(graph, new RegExp(`"${node}"`), `runtime graph must include ${node} node`);
}

assert.match(graph, /RUNTIME_GRAPH_CHECKPOINT_EVENT\s*=\s*"runtime_graph_checkpoint"/,
  "runtime graph checkpoints must use a typed task event");
assert.match(graph, /createRuntimeGraphCheckpointService/,
  "runtime graph checkpoint service must exist");
assert.match(graph, /pending_approval_created[\s\S]{0,220}resumeToken/,
  "approval checkpoints must carry resume tokens");
assert.match(graph, /status_changed[\s\S]{0,360}cancelled/,
  "cancel checkpoints must be mapped from status changes");
assert.doesNotMatch(graph, /langgraph|autogen|crew/i,
  "GX-001 must not import a heavyweight graph framework");

assert.match(taskRecord, /runtime_graph:\s*buildTaskRuntimeGraph/,
  "task records must stamp the runtime graph contract");
assert.match(eventEmitter, /runtimeGraph\?\.recordTaskEvent/,
  "task event emitter must delegate checkpoint writes to runtimeGraph service");
assert.match(runtimeServices, /createRuntimeGraphCheckpointService/,
  "runtime services must wire runtimeGraph checkpoint service");

assert.match(tests, /writes typed checkpoints for approval, success, and cancel events/,
  "tests must cover checkpoint recording");
assert.match(tests, /runtime graph template defines the main task execution nodes in order/,
  "tests must cover graph topology");
assert.match(tests, /runtime_graph\.nodes/,
  "task record tests must cover runtime graph stamping");

assert.match(docs, /GX-001[\s\S]{0,80}\| Done \|/, "docs must mark GX-001 done");
assert.match(docs, /runtime_graph_checkpoint/, "docs must describe runtime graph checkpoint events");
assert.match(performance, /GX-001[\s\S]{0,320}runtime_graph_checkpoint/,
  "performance plan must record graph checkpoint work off Electron hot paths");

console.log("[verify-runtime-graph-nodes] runtime graph node checkpoints verified");
