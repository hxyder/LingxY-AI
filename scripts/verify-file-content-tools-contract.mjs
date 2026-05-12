#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BUILTIN_ACTION_TOOLS } from "../src/service/action_tools/tools/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

// CAP file content/artifact verifier.
// Preflight state: this family remains inline in action_tools/tools/index.mjs.
// Physical move state must update this verifier to lock the capabilities/tools
// owner and absence of old inline helper/tool bodies.

const aggregatorPath = "src/service/action_tools/tools/index.mjs";
const targetOwnerPath = "src/service/capabilities/tools/file-content-tools.mjs";
const boundaryPath = "docs/architecture/file-content-artifact-tools-boundary.md";

assert(existsSync(path.join(root, aggregatorPath)), `tool aggregator missing: ${aggregatorPath}`);
assert(existsSync(path.join(root, boundaryPath)), `file content/artifact boundary doc missing: ${boundaryPath}`);
assert(!existsSync(path.join(root, targetOwnerPath)),
  "file-content-tools.mjs must not exist until the physical move updates this verifier");

const indexSrc = read(aggregatorPath);
for (const requiredText of [
  "export const READ_FILE_TEXT_TOOL",
  "export const READ_FOLDER_TEXT_TOOL",
  "export const SEARCH_FILE_CONTENT_TOOL",
  "export const INDEX_FILE_CONTENT_TOOL",
  "export const REGISTER_ARTIFACT_TOOL",
  "export const RESOLVE_OUTPUT_PATH_TOOL",
  "function clampNumber",
  "function emitFileReadEvent",
  "function emitToolFileReadTiming",
  "function fileReadResultFromTranscriptEntry",
  "READ_FOLDER_TEXT_TOOL.execute",
  "resolveFileReadBudgetFromTask",
  "FILE_EVIDENCE_COVERAGE.SINGLE_FILE_TEXT",
  "FILE_EVIDENCE_COVERAGE.FOLDER_RECURSIVE_TEXT",
  "EMBEDDING_NAMESPACES.FILE_CONTENT",
  "buildFileContentIndexRecords",
  "extractFileContent(filePath)",
  "collectPathReadableFiles",
  "extractReadableFileText",
  "artifactPaths: [filePath]",
  "metadata: { tool_id: \"resolve_output_path\""
]) {
  assert(indexSrc.includes(requiredText), `file content/artifact preflight missing ${requiredText}`);
}

const tools = new Map(BUILTIN_ACTION_TOOLS.map((tool) => [tool.id, tool]));
const expected = [
  ["read_file_text", "low", false, ["file_read"]],
  ["read_folder_text", "low", false, ["file_read"]],
  ["search_file_content", "low", false, ["file_read"]],
  ["index_file_content", "high", true, ["file_read"]],
  ["register_artifact", "low", false, ["file_write"]],
  ["resolve_output_path", "low", false, []]
];
for (const [id, risk, requiresConfirmation, capabilities] of expected) {
  const tool = tools.get(id);
  assert(tool, `missing built-in tool ${id}`);
  assert.equal(tool.risk_level, risk, `${id} risk level changed`);
  assert.equal(tool.requires_confirmation, requiresConfirmation, `${id} confirmation gate changed`);
  assert.deepEqual(tool.required_capabilities ?? [], capabilities, `${id} required capabilities changed`);
  assert.equal(tool.parameters?.type, "object", `${id} schema must remain an object schema`);
}

const readFileStart = indexSrc.indexOf("export const READ_FILE_TEXT_TOOL");
const readFolderStart = indexSrc.indexOf("export const READ_FOLDER_TEXT_TOOL");
const searchStart = indexSrc.indexOf("export const SEARCH_FILE_CONTENT_TOOL");
const indexStart = indexSrc.indexOf("export const INDEX_FILE_CONTENT_TOOL");
const registerStart = indexSrc.indexOf("export const REGISTER_ARTIFACT_TOOL");
const resolveStart = indexSrc.indexOf("export const RESOLVE_OUTPUT_PATH_TOOL");
assert(readFileStart >= 0 && readFolderStart > readFileStart, "read_file_text must precede read_folder_text");
assert(searchStart > readFolderStart, "search_file_content must follow read_folder_text");
assert(indexStart > searchStart, "index_file_content must follow search_file_content");
assert(registerStart > indexStart, "register_artifact must follow index_file_content");
assert(resolveStart > registerStart, "resolve_output_path must follow register_artifact");

const indexToolSrc = indexSrc.slice(indexStart, registerStart);
assert(!indexToolSrc.includes("extractFileContent("), "index_file_content must not read local files directly");
assert(!indexToolSrc.includes("collectPathReadableFiles("), "index_file_content must not crawl folders directly");
assert(indexToolSrc.includes("ctx.transcript"), "index_file_content must index prior transcript reads");

const resolveToolSrc = indexSrc.slice(resolveStart, indexSrc.indexOf("// UCA-077", resolveStart));
assert(!resolveToolSrc.includes("artifactPaths"), "resolve_output_path must not create an artifact");

const boundaryDoc = read(boundaryPath);
for (const requiredText of [
  "File Content And Artifact Tools Boundary",
  "`src/service/action_tools/tools/index.mjs`",
  "`src/service/capabilities/tools/file-content-tools.mjs`",
  "read_file_text",
  "index_file_content",
  "register_artifact",
  "resolve_output_path",
  "No-Touch Areas",
  "Preflight only"
]) {
  assert(boundaryDoc.includes(requiredText),
    `file content/artifact boundary doc missing required text: ${requiredText}`);
}

console.log("[file-content-tools] preflight contract verified");
