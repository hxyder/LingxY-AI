import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

const executionGraph = read("src/service/core/runtime/execution-graph.mjs");
assert.match(executionGraph, /visibility\s*=\s*"foreground"/, "execution graph must expose foreground/diagnostic visibility");
assert.match(executionGraph, /phaseVisibilityPayload/, "execution graph must stamp visibility payloads on phase events");

const contextSubmission = read("src/service/core/context-submission.mjs");
assert.match(contextSubmission, /BUFFERED_EXECUTOR_TERMINAL_EVENTS/, "context submission must buffer terminal executor events");
assert.match(contextSubmission, /augmentTerminalEventsWithArtifacts/, "terminal events must be augmented with registered artifact paths before emit");
assert.match(contextSubmission, /detectRequestedOutputFormatsForTask/, "context submission must preserve multi-format artifact requests");
assert.match(contextSubmission, /writeRequestedArtifactSet/, "context submission must synthesize requested artifact sets, not just one file");

const artifactFallbackPolicy = read("src/service/core/artifact-fallback-policy.mjs");
assert.match(artifactFallbackPolicy, /taskRequestsNewArtifactOutput/, "artifact fallback must distinguish new-output requests from file inspection mentions");
assert.match(artifactFallbackPolicy, /!artifactRequired\s*&&\s*!taskRequestsNewArtifactOutput\(task\)/,
  "artifact fallback must not synthesize files merely because an existing file format was mentioned");

const lateMerge = read("src/service/core/semantic-router-late-merge.mjs");
assert.match(lateMerge, /late semantic-router patch cannot revoke an in-flight evidence contract|Preserved after external web evidence/u,
  "late semantic router merge must preserve already-started external evidence contracts");
assert.match(lateMerge, /tool_call_proposed[\s\S]*web_search_fetch/, "late merge must inspect task events for started web evidence");

const agentLoop = read("src/service/executors/tool_using/agent-loop.mjs");
assert.match(agentLoop, /Number\(iteration\)\s*>\s*0/, "planner must not re-wait on deferred semantic routing after iteration zero");
assert.match(agentLoop, /LINGXY_SR_PATCH_PLANNER_WAIT_MS[\s\S]*:\s*650/, "default semantic-router wait budget must stay bounded for hot path latency");
assert.match(agentLoop, /finaliseWithFreshnessDisclosure/, "final answers must add deterministic freshness disclosure when dated web evidence is stale");

const taskSpec = read("src/service/core/task-spec.mjs");
assert.match(taskSpec, /explicitCodeExecutionRequired[\s\S]*SCRIPT_EXECUTION_REQUEST_RE\.test/,
  "task spec must detect explicit code execution independently from generated script artifacts");
assert.match(taskSpec, /required_tool_names:\s*explicitCodeExecutionRequired\s*\?\s*\["run_script"\]/,
  "explicit script execution must require run_script instead of allowing read-only shortcuts");

const search = read("src/service/search/free-search.mjs");
assert.match(search, /extractPublishedDate/, "web search must extract source dates from search result text");
assert.match(search, /published_date/, "web search result metadata must carry published_date");

const consoleRenderer = read("src/desktop/renderer/console.js");
assert.match(consoleRenderer, /visibility\s*===\s*"diagnostic"/, "console must ignore diagnostic background runtime events in chat progress");

const overlayRenderer = read("src/desktop/renderer/overlay.js");
assert.match(overlayRenderer, /visibility\s*===\s*"diagnostic"/, "overlay must ignore diagnostic background runtime events in user-facing timeline");

console.log("[verify-runtime-efficiency-contract] Runtime efficiency and freshness contracts verified");
