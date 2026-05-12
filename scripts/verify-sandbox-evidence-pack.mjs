#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHECK_COMMANDS, FAST_CHECK_COMMANDS } from "./check-manifest.mjs";
import {
  SANDBOX_EVIDENCE_SURFACE_IDS,
  validateSandboxEvidencePack
} from "../src/shared/sandbox-evidence-pack.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const file = (rel) => path.join(root, rel);
const read = (rel) => readFileSync(file(rel), "utf8");

const contractPath = "src/shared/sandbox-evidence-pack.mjs";
const runnerPath = "scripts/run-sandbox-evidence-pack.mjs";
const docsPath = "docs/architecture/sandbox-evidence-pack.md";
const templatePath = "docs/release/evidence/sandbox-evidence-pack.template.json";
const testsPath = "tests/behavior/sandbox-evidence-pack.test.mjs";

for (const rel of [contractPath, runnerPath, docsPath, templatePath, testsPath]) {
  assert.ok(existsSync(file(rel)), `missing ${rel}`);
}

const contract = read(contractPath);
const runner = read(runnerPath);
const docs = read(docsPath);
const roadmap = read("docs/architecture/post-runtime-product-gap-roadmap.md");
const template = JSON.parse(read(templatePath));
const tests = read(testsPath);

for (const required of [
  "SANDBOX_EVIDENCE_PACK_SCHEMA_VERSION",
  "SANDBOX_EVIDENCE_SURFACE_IDS",
  "buildSandboxEvidencePack",
  "validateSandboxEvidencePack",
  "redactSandboxEvidencePack"
]) {
  assert.ok(contract.includes(required), `contract missing ${required}`);
}

for (const surface of SANDBOX_EVIDENCE_SURFACE_IDS) {
  assert.ok(template.surfaces.some((entry) => entry.id === surface),
    `template missing surface ${surface}`);
  assert.ok(runner.includes(surface), `runner missing surface ${surface}`);
}

const validation = validateSandboxEvidencePack(template);
assert.equal(validation.ok, true, `template invalid: ${validation.missing.join(", ")} leaks=${validation.leaks.join(", ")}`);

for (const required of [
  "boundaryChange: false",
  "verify-write-edit-run-tools-contract",
  "verify-security-broker",
  "verify-mcp-governance-policy",
  "verify-pdf-ocr",
  "verify-browser-runmode-router",
  "verify-browser-overlay",
  "verify-browser-extension",
  "verify-real-audio-kws-fixtures"
]) {
  assert.ok(runner.includes(required), `runner missing ${required}`);
}

for (const required of [
  "Sandbox Evidence Pack",
  "evidence-only",
  "File mutation",
  "Command execution",
  "MCP install",
  "OCR",
  "Browser automation",
  "Audio daemon"
]) {
  assert.ok(docs.includes(required), `docs missing ${required}`);
}

for (const required of [
  "SBOX-001 High-risk sandbox evidence pack | complete",
  "node scripts/verify-sandbox-evidence-pack.mjs",
  "node scripts/run-sandbox-evidence-pack.mjs",
  "docs/release/evidence/sandbox-evidence-pack.template.json"
]) {
  assert.ok(roadmap.includes(required), `roadmap missing ${required}`);
}

assert.match(tests, /validator accepts complete template shape/u,
  "behavior tests must validate the template shape");
assert.match(tests, /rejects boundary changes/u,
  "behavior tests must block boundary changes");

const command = "node scripts/verify-sandbox-evidence-pack.mjs";
assert.ok(CHECK_COMMANDS.includes(command), "check manifest must include sandbox evidence verifier");
assert.ok(FAST_CHECK_COMMANDS.includes(command), "fast check manifest must include sandbox evidence verifier");

console.log("[sandbox-evidence-pack] SBOX-001 evidence contract verified");
