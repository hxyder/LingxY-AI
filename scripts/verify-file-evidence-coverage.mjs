#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

function read(relPath) {
  return readFileSync(path.join(process.cwd(), relPath), "utf8");
}

const contract = read("src/service/core/file-evidence-coverage.mjs");
const tools = read("src/service/action_tools/tools/index.mjs");
const fileReadTools = read("src/service/capabilities/tools/file-read-tools.mjs");
const fileContentTools = read("src/service/capabilities/tools/file-content-tools.mjs");
const guard = read("src/service/executors/tool_using/truthfulness-guard.mjs");

function sliceBetween(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.ok(start >= 0, `missing ${startNeedle}`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(end > start, `missing ${endNeedle} after ${startNeedle}`);
  return source.slice(start, end);
}

const readFileTool = sliceBetween(fileContentTools, "export const READ_FILE_TEXT_TOOL", "function clampNumber");
const readFolderTool = sliceBetween(fileContentTools, "export const READ_FOLDER_TEXT_TOOL", "export const SEARCH_FILE_CONTENT_TOOL");
assert.ok(tools.includes("from \"../../capabilities/tools/file-content-tools.mjs\""),
  "index.mjs must import file-content-tools.mjs from capabilities/tools/");

for (const scope of [
  "single_file_text",
  "folder_recursive_text",
  "directory_listing_shallow",
  "file_enumeration_recursive",
  "file_metadata"
]) {
  assert.ok(contract.includes(scope), `file evidence contract must define ${scope}`);
}

assert.match(fileReadTools, /LIST_FILES_TOOL[\s\S]{0,1600}DIRECTORY_LISTING_SHALLOW/,
  "list_files must mark shallow directory listing coverage");
assert.match(fileReadTools, /GLOB_FILES_TOOL[\s\S]{0,2600}FILE_ENUMERATION_RECURSIVE/,
  "glob_files must mark recursive enumeration coverage");
assert.match(fileReadTools, /FIND_RECENT_FILES_TOOL[\s\S]{0,2600}FILE_ENUMERATION_RECURSIVE/,
  "find_recent_files must mark recursive enumeration coverage");
assert.match(readFileTool, /SINGLE_FILE_TEXT/,
  "read_file_text must mark single-file text coverage");
assert.match(readFileTool, /READ_FOLDER_TEXT_TOOL\.execute/,
  "read_file_text must delegate directory paths to read_folder_text");
assert.match(readFolderTool, /FOLDER_RECURSIVE_TEXT/,
  "read_folder_text must mark recursive folder text coverage");

assert.match(guard, /isFileTextCoverageScope/,
  "truthfulness guard must distinguish text extraction from shallow file enumeration");

for (const banned of ["简历", "岗位", "YouTube", "Raleigh"]) {
  assert.equal(contract.includes(banned), false,
    `file coverage contract must not encode task topic ${banned}`);
}

console.log("file evidence coverage verification passed");
