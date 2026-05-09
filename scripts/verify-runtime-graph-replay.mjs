import fs from "node:fs";
import assert from "node:assert/strict";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

const replay = read("src/service/core/graph/runtime-graph-replay.mjs");
const checkpoints = read("src/service/core/graph/runtime-graph-checkpoints.mjs");
const runtimeServices = read("src/service/core/task-runtime/runtime-services.mjs");
const tests = read("tests/behavior/runtime-graph-replay.test.mjs");
const spine = read("docs/architecture/agent-runtime-spine.md");
const packageJson = read("package.json");

assert.match(replay, /export function listRuntimeGraphCheckpoints/,
  "runtime graph replay must expose checkpoint listing");
assert.match(replay, /export function buildRuntimeGraphReplayPlan/,
  "runtime graph replay must expose replay plan builder");
assert.match(replay, /export function buildRuntimeGraphForkSeed/,
  "runtime graph replay must expose checkpoint fork seed builder");
assert.match(replay, /event_type !== RUNTIME_GRAPH_CHECKPOINT_EVENT/,
  "replay prefixes must not replay checkpoint events as source events");
assert.match(replay, /resumeKindForCheckpoint/,
  "replay must map checkpoint status to explicit resume kinds");
assert.match(replay, /getTaskMessages[\s\S]*getMessage/,
  "fork seeds must use conversation message prefix metadata when available");
assert.match(replay, /getLatestConversationSession|session_id/,
  "fork seeds must carry session prefix metadata");
assert.match(checkpoints, /RUNTIME_GRAPH_CHECKPOINT_EVENT/,
  "checkpoint event constant must remain canonical");
assert.match(runtimeServices, /createRuntimeGraphReplayService/,
  "runtime services must wire runtime graph replay service");
assert.match(runtimeServices, /runtimeGraphReplay/,
  "runtime must expose runtimeGraphReplay");
assert.match(tests, /runtime graph replay plan builds a bounded prefix/,
  "behavior tests must cover replay prefix construction");
assert.match(tests, /runtime graph fork seed carries conversation and session prefix metadata/,
  "behavior tests must cover checkpoint fork seeds");
assert.match(spine, /GX-002[\s\S]{0,420}Done/,
  "architecture spine must record GX-002 as done");
assert.match(packageJson, /verify:runtime-graph-replay/,
  "package.json must expose runtime graph replay verifier");

const forbiddenRuntime = [
  /from\s+["'][^"']*electron/,
  /from\s+["'][^"']*desktop\/renderer/,
  /from\s+["'][^"']*langgraph/i,
  /from\s+["'][^"']*autogen/i
];
for (const pattern of forbiddenRuntime) {
  assert.doesNotMatch(replay, pattern, "runtime graph replay must stay service-owned and lightweight");
}

console.log("[verify-runtime-graph-replay] runtime graph replay/fork contracts verified");
