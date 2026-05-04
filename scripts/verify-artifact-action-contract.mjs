#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

function read(relPath) {
  return readFileSync(path.join(process.cwd(), relPath), "utf8");
}

const contract = read("src/service/core/artifact-action-contract.mjs");
const agentLoop = read("src/service/executors/tool_using/agent-loop.mjs");
const contextSubmission = read("src/service/core/context-submission.mjs");
const browserSubmission = read("src/service/core/browser-submission.mjs");
const actionSubmission = read("src/service/core/action-tool-submission.mjs");
const agenticPlanner = read("src/service/executors/agentic/planner.mjs");
const taskRoutes = read("src/service/core/http-routes/task-routes.mjs");
const artifactStore = read("src/service/store/artifact-store.mjs");
const metadata = read("src/service/core/store/artifact-metadata.mjs");

assert.match(contract, /"edit_file",\s*"update_existing"/,
  "artifact action contract must classify edit_file as update_existing");
assert.match(contract, /"update_existing",\s*"edited"/,
  "artifact action contract must map update_existing to edited source");
assert.match(contract, /artifactEventFieldsForToolResult/,
  "artifact action contract must expose event fields for tool results");
assert.match(contract, /artifactRegistrationOptionsForPath/,
  "artifact action contract must expose registration options for submissions");

for (const banned of ["简历", "岗位", "youtube", "YouTube", "天气", "Raleigh"]) {
  assert.equal(contract.includes(banned), false,
    `artifact action contract must not encode task-specific topic "${banned}"`);
}

assert.match(agentLoop, /artifactEventFieldsForToolResult/,
  "tool_using agent-loop must stamp artifact action/source on tool_call_completed");
assert.match(agentLoop, /tool_call_completed[\s\S]{0,240}\.\.\.artifactEventFieldsForToolResult\(tool\.id,\s*result\)/,
  "tool_using agent-loop must include artifact event fields in completion payload");

assert.match(agenticPlanner, /artifactEventFieldsForToolResult/,
  "agentic planner must stamp artifact action/source on tool events");
assert.match(agenticPlanner, /tool_call_completed[\s\S]{0,320}\.\.\.artifactEventFieldsForToolResult\(call\.name,\s*result\)/,
  "agentic planner must include artifact event fields in completion payload");
assert.match(agenticPlanner, /artifact_created[\s\S]{0,520}artifact_source/,
  "agentic planner artifact_created events must carry artifact source when known");

for (const [name, source] of [
  ["context submission", contextSubmission],
  ["browser submission", browserSubmission],
  ["action-tool submission", actionSubmission]
]) {
  assert.match(source, /rememberArtifactMetadataFromToolEvent/,
    `${name} must remember artifact metadata from tool_call_completed events`);
  assert.match(source, /artifactRegistrationOptionsForPath/,
    `${name} must pass artifact source metadata when registering artifacts`);
}

assert.match(actionSubmission, /artifactEventFieldsForToolResult\(fastPathTool,\s*toolResult\)/,
  "action-tool fast path must stamp artifact action/source too");
assert.match(actionSubmission, /persistArtifacts\(runtime,\s*task\.task_id,\s*loopResult\.artifacts,\s*\{\s*metadataByPath/,
  "action-tool submission must persist loop artifacts with remembered source metadata");

assert.match(taskRoutes, /artifactSourceFromEventPayload/,
  "task detail route must preserve source when deriving artifacts from historical events");
assert.match(taskRoutes, /source:\s*artifactSourceFromValue/,
  "task detail derived artifacts must expose source");

assert.match(artifactStore, /source\s*=\s*"generated"/,
  "artifact store registerArtifact must keep generated as the default source");
assert.match(artifactStore, /normalizeArtifactMetadata\([\s\S]{0,180}source/,
  "artifact store registerArtifact must pass source through metadata normalization");
assert.match(metadata, /"edited"/,
  "artifact metadata normalization must accept edited source");

console.log("artifact action contract verification passed");
