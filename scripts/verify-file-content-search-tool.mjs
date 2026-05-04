#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

function read(relPath) {
  return readFileSync(path.join(process.cwd(), relPath), "utf8");
}

const schemas = read("src/service/action_tools/schemas/index.mjs");
const tools = read("src/service/action_tools/tools/index.mjs");
const surface = read("src/service/executors/tool_using/tool-surface.mjs");
const toolStart = tools.indexOf("export const SEARCH_FILE_CONTENT_TOOL");
const toolEnd = tools.indexOf("export const VERIFY_FILE_EXISTS_TOOL");
assert.ok(toolStart >= 0, "SEARCH_FILE_CONTENT_TOOL export must exist");
assert.ok(toolEnd > toolStart, "SEARCH_FILE_CONTENT_TOOL must stay before VERIFY_FILE_EXISTS_TOOL");
const searchTool = tools.slice(toolStart, toolEnd);

assert.match(schemas, /search_file_content/);
assert.match(searchTool, /SEARCH_FILE_CONTENT_TOOL/);
assert.match(searchTool, /EMBEDDING_NAMESPACES\.FILE_CONTENT/);
assert.match(searchTool, /store\.search\(query,\s*limit,\s*\{\s*namespace:\s*EMBEDDING_NAMESPACES\.FILE_CONTENT\s*\}\)/,
  "search_file_content must query only the file_content namespace");
assert.match(surface, /search_file_content/,
  "file_read capability tool surface must expose search_file_content");
assert.match(searchTool, /This does not read disk/,
  "tool description must make clear it searches an index and does not read disk");

for (const banned of ["简历", "岗位", "YouTube", "Raleigh"]) {
  assert.equal(searchTool.includes(banned), false,
    `search_file_content tool must not encode task topic ${banned}`);
}

console.log("file content search tool verification passed");
