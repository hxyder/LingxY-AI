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
const taskEventEmitter = await source("src/service/core/task-runtime/event-emitter.mjs");
const taskEventLog = await source("src/service/core/task-runtime/event-log.mjs");
assert.ok(taskRuntime.includes('from "./task-runtime/event-emitter.mjs"'),
  "task runtime must delegate event emission to event-emitter");
assert.ok(/EPHEMERAL_EVENT_TYPES[\s\S]*"reasoning_delta"/.test(taskEventEmitter),
  "reasoning_delta must be ephemeral");
assert.ok(/JSONL_SKIP_EVENT_TYPES[\s\S]*"reasoning_delta"/.test(taskEventLog),
  "reasoning_delta must be skipped from jsonl task logs");
assert.ok(taskEventEmitter.includes('"executor_first_delta"'),
  "task event emitter must record first-token latency as executor_first_delta");
assert.ok(taskEventEmitter.includes('"executor_first_event"'),
  "task event emitter must record first executor activity as executor_first_event");
assert.ok(taskEventEmitter.includes('"executor_first_progress"'),
  "task event emitter must record first non-visible executor progress as executor_first_progress");
assert.ok(taskEventEmitter.includes('"executor_first_visible_output"'),
  "task event emitter must record first visible output latency across streaming, inline, and artifact outputs");

const main = await source("src/desktop/tray/electron-main.mjs");
const desktopNotifications = await source("src/desktop/tray/desktop-notifications.mjs");
assert.ok(desktopNotifications.includes('reason: "primary_ui_visible"'),
  "success notifications must be suppressible while primary UI is visible");
const ipcShellWindow = await source("src/desktop/tray/ipc/register-shell-window-ipc.mjs");
assert.ok(ipcShellWindow.includes("setIgnoreMouseEvents(Boolean(ignore)"),
  "main process must expose dock click-through control");

const manifest = await source("src/desktop/shared/manifest.mjs");
assert.ok(manifest.includes('shellSetIgnoreMouseEvents: "uca:shell-set-ignore-mouse-events"'),
  "manifest must include mouse-event IPC");
assert.ok(manifest.includes("width: 48") && manifest.includes("height: 48"),
  "dock manifest must use reduced hitbox");

console.log("ok verify-execution-graph-layering");
