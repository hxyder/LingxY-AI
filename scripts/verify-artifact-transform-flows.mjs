import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  assert.ok(existsSync(absolutePath), `Missing required file: ${relativePath}`);
  return readFileSync(absolutePath, "utf8");
}

const service = read("src/service/core/artifact-transforms/artifact-transform-service.mjs");
const runtimeServices = read("src/service/core/task-runtime/runtime-services.mjs");
const tests = read("tests/behavior/artifact-transform-service.test.mjs");
const manifest = read("scripts/check-manifest.mjs");
const docs = `${read("docs/architecture/agent-runtime-spine.md")}\n${read("docs/architecture/electron-js-runtime-performance-plan.md")}`;

assert.match(service, /ARTIFACT_TRANSFORM_SCHEMA_VERSION/, "transform service must version its contract");
assert.match(service, /XLSX_TO_PPTX/, "transform service must define xlsx_to_pptx");
assert.match(service, /buildXlsxToPptxOutline/, "transform service must build deterministic outlines");
assert.match(service, /validateXlsxToPptxOutline/, "transform service must validate outlines");
assert.match(service, /transformXlsxToPptx/, "transform service must expose xlsx->pptx flow");
assert.match(service, /listArtifactExtractsForArtifact/, "transform flow must consume typed artifact extracts");
assert.match(service, /generate_document/, "transform flow must reuse generate_document for target artifact generation");
assert.match(service, /appendArtifact\(/, "transform flow must register target artifacts");
assert.match(service, /appendTransformLineage/, "transform flow must write artifact lineage");
assert.match(service, /artifact_reference/, "transform flow must persist a session artifact reference when sessions are available");
assert.match(service, /one_slide_prose_dump/, "transform validator must reject one-slide prose dumps");
assert.doesNotMatch(service, /extractFileContent|readFileSync|readdirSync|execSync|spawnSync|Atomics\.wait/,
  "transform service must not parse source files or perform blocking work");

assert.match(runtimeServices, /createArtifactTransformService/, "runtime services must create ArtifactTransformService");
assert.match(tests, /creates a real PPTX, lineage, and session artifact reference/,
  "behavior tests must cover real pptx target, lineage, and session reference");
assert.match(tests, /requires table extracts/, "behavior tests must require table extracts");
assert.match(tests, /rejects one-slide prose dumps/, "behavior tests must reject prose-only decks");
assert.match(manifest, /verify-artifact-transform-flows/, "check manifest must include transform verifier");
assert.match(docs, /AX-003[\s\S]{0,220}Done/, "runtime spine must mark AX-003 done");
assert.match(docs, /xlsx_to_pptx|XLSX -> PPTX|XLSX → PPTX/,
  "docs must describe the xlsx to pptx typed transform flow");

console.log("[verify-artifact-transform-flows] Artifact transform flows verified");
