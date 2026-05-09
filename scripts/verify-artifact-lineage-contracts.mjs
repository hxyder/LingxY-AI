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
const service = read("src/service/core/artifact-lineage/artifact-lineage-service.mjs");
const runtimeServices = read("src/service/core/task-runtime/runtime-services.mjs");
const tests = read("tests/behavior/artifact-lineage-service.test.mjs");
const docs = `${read("docs/architecture/agent-runtime-spine.md")}\n${read("docs/architecture/electron-js-runtime-performance-plan.md")}`;

assert.match(schema, /artifact_lineage/, "schema must include artifact_lineage table");
assert.match(schema, /artifact_lineage_sources/, "schema must include artifact_lineage_sources table");
assert.match(schema, /idx_artifact_lineage_target/, "schema must index lineage by target artifact");
assert.match(schema, /idx_artifact_lineage_sources_source/, "schema must index lineage by source artifact");

for (const [name, source] of [
  ["sqlite-store", sqliteStore],
  ["memory-store", memoryStore]
]) {
  assert.match(source, /getArtifact\(/, `${name} must expose getArtifact`);
  assert.match(source, /appendArtifactLineage/, `${name} must append artifact lineage`);
  assert.match(source, /listArtifactLineageForArtifact/, `${name} must list lineage for an artifact`);
  assert.match(source, /listArtifactLineageForTask/, `${name} must list lineage for a task`);
}

assert.match(service, /ARTIFACT_LINEAGE_SCHEMA_VERSION/, "service must version its contract");
assert.match(service, /ARTIFACT_ACTIONS/, "service must define artifact actions");
assert.match(service, /appendTransformLineage/, "service must expose transform lineage helper");
assert.match(service, /validateArtifactTransformContract/, "service must expose transform contract validation");
assert.match(service, /missing_source_artifact/, "validator must reject missing source artifact");
assert.match(service, /target_kind_mismatch/, "validator must reject target kind mismatch");
assert.match(service, /missing_source_extract_or_quality_reason/, "validator must require source extract or quality reason");
assert.match(service, /fake_or_unstable_target_path/, "validator must reject fake target paths");
assert.doesNotMatch(service, /readFileSync|writeFileSync|readdirSync|execSync|spawnSync|Atomics\.wait/,
  "lineage service must not perform blocking artifact IO");

assert.match(runtimeServices, /createArtifactLineageService/, "runtime services must create ArtifactLineageService");

assert.match(tests, /stores transform lineage and semantic validation/, "tests must cover lineage storage");
assert.match(tests, /rejects unrelated create-new artifacts/, "tests must cover unrelated create_new rejection");
assert.match(tests, /rejects fake target paths/, "tests must cover fake target rejection");

assert.match(docs, /AX-002[\s\S]{0,220}Done/, "runtime spine must mark AX-002 done");
assert.match(docs, /artifact_lineage[\s\S]{0,420}semantic contract|semantic contract[\s\S]{0,420}artifact_lineage/,
  "docs must describe lineage and semantic contract records");

console.log("[verify-artifact-lineage-contracts] Artifact lineage contracts verified");
