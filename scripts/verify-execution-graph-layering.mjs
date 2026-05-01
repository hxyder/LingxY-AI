#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

async function source(rel) {
  return readFile(path.join(ROOT, rel), "utf8");
}

const graph = await source("src/service/core/runtime/execution-graph.mjs");
for (const state of [
  "RECEIVED",
  "ROUTING",
  "PLANNING",
  "TOOL_RUNNING",
  "SYNTHESIZING_FINAL",
  "FINAL_CHECK",
  "DONE",
  "FAILED"
]) {
  assert.ok(graph.includes(`${state}: "${state}"`), `execution graph must define ${state}`);
}
assert.ok(graph.includes("runExecutionPhase"), "execution graph must export a phase wrapper");
assert.ok(graph.includes('"phase_started"'), "execution graph must emit phase_started");
assert.ok(graph.includes('"phase_timing"'), "execution graph must emit phase_timing");
assert.ok(graph.includes('SEMANTIC_ROUTER_PATCH: "semantic_router_patch"'),
  "execution graph must distinguish deferred SemanticRouter patching from blocking preflight");

for (const rel of [
  "src/service/core/context-submission.mjs",
  "src/service/core/browser-submission.mjs"
]) {
  const src = await source(rel);
  assert.ok(src.includes("runExecutionPhase"), `${rel} must use the shared execution graph wrapper`);
  assert.ok(src.includes("EXECUTION_PHASES.SEMANTIC_ROUTER_PATCH"), `${rel} must route deferred SemanticRouter through the patch graph phase`);
  assert.ok(src.includes("EXECUTION_STATES.ROUTING"), `${rel} must stamp routing state`);
}

const agentLoop = await source("src/service/executors/tool_using/agent-loop.mjs");
assert.ok(/async function llmPlanner\(\{[^}]*runtime/.test(agentLoop),
  "llmPlanner must accept runtime when streaming callbacks emit through runtime.emitTaskEvent");
assert.ok(!agentLoop.includes('task.__runtime?.emitTaskEvent?.("text_delta"'),
  "tool_using streaming deltas must not be emitted through stale task.__runtime");
assert.ok(agentLoop.includes('runtime?.emitTaskEvent?.("text_delta"'),
  "tool_using streaming deltas must use the execution runtime emitter");

const taskRuntime = await source("src/service/core/task-runtime.mjs");
const taskEventLog = await source("src/service/core/task-runtime/event-log.mjs");
assert.ok(/EPHEMERAL_EVENT_TYPES[\s\S]*"reasoning_delta"/.test(taskRuntime),
  "reasoning_delta must be ephemeral");
assert.ok(/JSONL_SKIP_EVENT_TYPES[\s\S]*"reasoning_delta"/.test(taskEventLog),
  "reasoning_delta must be skipped from jsonl task logs");
assert.ok(taskRuntime.includes('phase: "executor_first_delta"'),
  "task runtime must record first-token latency as executor_first_delta");

const main = await source("src/desktop/tray/electron-main.mjs");
assert.ok(main.includes('reason: "primary_ui_visible"'),
  "success notifications must be suppressible while primary UI is visible");
assert.ok(main.includes("setIgnoreMouseEvents(Boolean(ignore)"),
  "main process must expose dock click-through control");

const manifest = await source("src/desktop/shared/manifest.mjs");
assert.ok(manifest.includes('shellSetIgnoreMouseEvents: "uca:shell-set-ignore-mouse-events"'),
  "manifest must include mouse-event IPC");
assert.ok(manifest.includes("width: 52") && manifest.includes("height: 52"),
  "dock manifest must use reduced hitbox");

console.log("ok verify-execution-graph-layering");
