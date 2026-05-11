#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

function read(relPath) {
  return readFileSync(path.join(process.cwd(), relPath), "utf8");
}

const schemas = read("src/service/capabilities/schemas/index.mjs");
const tools = read("src/service/action_tools/tools/index.mjs");
const surface = read("src/service/executors/tool_using/tool-surface.mjs");
const agentLoop = read("src/service/executors/tool_using/agent-loop.mjs");
const agenticToolExecution = read("src/service/executors/agentic/tool-execution.mjs");
const runtimeServices = read("src/service/core/task-runtime/runtime-services.mjs");
const approvalContext = read("src/service/executors/shared/tool-approval-context.mjs");
const toolStart = tools.indexOf("export const INDEX_FILE_CONTENT_TOOL");
const toolEnd = tools.indexOf("export const REGISTER_ARTIFACT_TOOL");
assert.ok(toolStart >= 0, "INDEX_FILE_CONTENT_TOOL export must exist");
assert.ok(toolEnd > toolStart, "INDEX_FILE_CONTENT_TOOL must stay before REGISTER_ARTIFACT_TOOL");
const indexTool = tools.slice(toolStart, toolEnd);

assert.match(schemas, /index_file_content/);
assert.match(indexTool, /INDEX_FILE_CONTENT_TOOL/);
assert.match(indexTool, /requires_confirmation:\s*true/);
assert.match(indexTool, /risk_level:\s*"high"/);
assert.match(indexTool, /buildFileContentIndexRecords/);
assert.match(indexTool, /store\.add\(record\)/);
assert.match(surface, /index_file_content/,
  "file_read capability tool surface must expose index_file_content");
assert.match(agentLoop, /transcript:\s*transcript\.slice\(\)/,
  "tool calls must receive a snapshot of prior transcript entries");
assert.match(agenticToolExecution, /transcript:\s*Array\.isArray\(transcript\)\s*\?\s*transcript\.slice\(\)\s*:\s*\[\]/,
  "agentic tool calls must receive a snapshot of prior transcript entries");
assert.match(approvalContext, /buildDeferredToolContext/);
assert.match(approvalContext, /index_file_content/);
assert.match(approvalContext, /read_file_text/);
assert.match(approvalContext, /read_folder_text/);
assert.match(runtimeServices, /deferred_tool_context/);
assert.match(runtimeServices, /transcript:\s*Array\.isArray\(deferredToolContext\.transcript\)/,
  "approved deferred tool execution must replay deferred transcript context");
assert.equal(indexTool.includes("readFile("), false,
  "index_file_content must not read local files directly");
assert.equal(indexTool.includes("readFolder("), false,
  "index_file_content must not read folders directly");

for (const banned of ["简历", "岗位", "YouTube", "Raleigh"]) {
  assert.equal(indexTool.includes(banned), false,
    `index_file_content tool must not encode task topic ${banned}`);
}

console.log("file content index tool verification passed");
