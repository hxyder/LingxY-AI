#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

function read(relPath) {
  return readFileSync(path.join(process.cwd(), relPath), "utf8");
}

const contract = read("src/service/core/file-evidence-coverage.mjs");
const tools = read("src/service/action_tools/tools/index.mjs");
const guard = read("src/service/executors/tool_using/truthfulness-guard.mjs");

for (const scope of [
  "single_file_text",
  "folder_recursive_text",
  "directory_listing_shallow",
  "file_enumeration_recursive",
  "file_metadata"
]) {
  assert.ok(contract.includes(scope), `file evidence contract must define ${scope}`);
}

assert.match(tools, /LIST_FILES_TOOL[\s\S]{0,1600}DIRECTORY_LISTING_SHALLOW/,
  "list_files must mark shallow directory listing coverage");
assert.match(tools, /GLOB_FILES_TOOL[\s\S]{0,2600}FILE_ENUMERATION_RECURSIVE/,
  "glob_files must mark recursive enumeration coverage");
assert.match(tools, /FIND_RECENT_FILES_TOOL[\s\S]{0,2600}FILE_ENUMERATION_RECURSIVE/,
  "find_recent_files must mark recursive enumeration coverage");
assert.match(tools, /READ_FILE_TEXT_TOOL[\s\S]{0,3600}SINGLE_FILE_TEXT/,
  "read_file_text must mark single-file text coverage");
assert.match(tools, /READ_FILE_TEXT_TOOL[\s\S]{0,1800}READ_FOLDER_TEXT_TOOL\.execute/,
  "read_file_text must delegate directory paths to read_folder_text");
assert.match(tools, /READ_FOLDER_TEXT_TOOL[\s\S]{0,4600}FOLDER_RECURSIVE_TEXT/,
  "read_folder_text must mark recursive folder text coverage");

assert.match(guard, /isFileTextCoverageScope/,
  "truthfulness guard must distinguish text extraction from shallow file enumeration");

for (const banned of ["简历", "岗位", "YouTube", "Raleigh"]) {
  assert.equal(contract.includes(banned), false,
    `file coverage contract must not encode task topic ${banned}`);
}

console.log("file evidence coverage verification passed");
