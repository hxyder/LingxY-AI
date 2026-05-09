import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  assert.ok(existsSync(absolutePath), `Missing required file: ${relativePath}`);
  return readFileSync(absolutePath, "utf8");
}

const schema = read("src/service/core/store/sqlite-schema.mjs");
const sqliteStore = read("src/service/core/store/sqlite-store.mjs");
const memoryStore = read("src/service/core/store/memory-store.mjs");
const service = read("src/service/core/artifact-extracts/artifact-extract-service.mjs");
const runtimeServices = read("src/service/core/task-runtime/runtime-services.mjs");
const compiler = read("src/service/core/context/context-compiler.mjs");
const tests = read("tests/behavior/artifact-extract-service.test.mjs");
const docs = `${read("docs/architecture/agent-runtime-spine.md")}\n${read("docs/architecture/electron-js-runtime-performance-plan.md")}`;

assert.match(schema, /artifact_extracts/, "schema must include artifact_extracts table");
assert.match(schema, /idx_artifact_extracts_artifact/, "schema must index extracts by artifact");
assert.match(schema, /idx_artifact_extracts_task/, "schema must index extracts by task");
assert.match(schema, /idx_artifact_extracts_conversation/, "schema must index extracts by conversation");

for (const [name, source] of [
  ["sqlite-store", sqliteStore],
  ["memory-store", memoryStore]
]) {
  assert.match(source, /appendArtifactExtract/, `${name} must append artifact extracts`);
  assert.match(source, /listArtifactExtractsForArtifact/, `${name} must list extracts for an artifact`);
  assert.match(source, /listArtifactExtractsForTask/, `${name} must list extracts for a task`);
}

assert.match(service, /ARTIFACT_EXTRACT_SCHEMA_VERSION/, "service must version its contract");
assert.match(service, /ARTIFACT_EXTRACT_KINDS/, "service must define typed extract kinds");
assert.match(service, /appendExtract/, "service must expose appendExtract");
assert.match(service, /MAX_EXTRACT_TEXT_CHARS/, "service must bound extract text");
assert.doesNotMatch(service, /readFileSync|writeFileSync|readdirSync|execSync|spawnSync|Atomics\.wait/,
  "service must not perform blocking extraction work");

assert.match(runtimeServices, /createArtifactExtractService/, "runtime services must create ArtifactExtractService");
assert.match(compiler, /artifact_extract_summary/, "ContextCompiler must understand artifact extract summaries");
assert.match(compiler, /artifact_extract_table/, "ContextCompiler must understand artifact extract tables");
assert.match(compiler, /listArtifactExtractsForArtifact/, "ContextCompiler must read existing extracts through store/service");
assert.doesNotMatch(compiler, /extractFileContent|readFileSync/,
  "ContextCompiler must not extract artifact files on the task hot path");

assert.match(tests, /stores typed extract records/, "tests must cover extract storage");
assert.match(tests, /runtime services attach ArtifactExtractService/, "tests must cover runtime service wiring");
assert.match(tests, /context compiler includes existing typed artifact extracts/, "tests must cover compiler inclusion");

assert.match(docs, /AX-001[\s\S]{0,220}Done/, "runtime spine must mark AX-001 done");
assert.match(docs, /artifact_extracts[\s\S]{0,320}ArtifactExtract|ArtifactExtract[\s\S]{0,420}artifact_extracts/,
  "docs must describe typed ArtifactExtract records");

console.log("[verify-artifact-extract-foundation] ArtifactExtract foundation verified");
