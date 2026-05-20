#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHECK_COMMANDS, FAST_CHECK_COMMANDS } from "./check-manifest.mjs";
import {
  FILE_CLEANUP_CATEGORIES,
  FILE_CLEANUP_DECISIONS,
  FILE_CLEANUP_EVIDENCE_KEYS,
  validateFileCleanupEvidencePack
} from "../src/shared/file-cleanup-evidence-pack.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const file = (rel) => path.join(root, rel);
const read = (rel) => readFileSync(file(rel), "utf8");

const contractPath = "src/shared/file-cleanup-evidence-pack.mjs";
const runnerPath = "scripts/run-file-cleanup-candidates.mjs";
const cleanerPath = "scripts/clean-local-generated.mjs";
const docsPath = "docs/architecture/file-cleanup-evidence-pack.md";
const templatePath = "docs/release/evidence/file-cleanup-evidence-pack.template.json";
const testsPath = "tests/behavior/file-cleanup-evidence-pack.test.mjs";

for (const rel of [contractPath, runnerPath, cleanerPath, docsPath, templatePath, testsPath]) {
  assert.ok(existsSync(file(rel)), `missing ${rel}`);
}

const contract = read(contractPath);
const runner = read(runnerPath);
const cleaner = read(cleanerPath);
const docs = read(docsPath);
const globalPlan = read("docs/architecture/global-execution-efficiency-and-cleanup-plan.md");
const architectureReadme = read("docs/architecture/README.md");
const tests = read(testsPath);
const packageJson = JSON.parse(read("package.json"));
const template = JSON.parse(read(templatePath));

for (const required of [
  "FILE_CLEANUP_EVIDENCE_PACK_SCHEMA_VERSION",
  "FILE_CLEANUP_CATEGORIES",
  "FILE_CLEANUP_DECISIONS",
  "FILE_CLEANUP_EVIDENCE_KEYS",
  "buildFileCleanupEvidencePack",
  "validateFileCleanupEvidencePack",
  "isDisposableLocalCleanupPath",
  "isForbiddenCleanupPath"
]) {
  assert.ok(contract.includes(required), `contract missing ${required}`);
}

for (const category of FILE_CLEANUP_CATEGORIES) {
  assert.ok(template.candidates.some((candidate) => candidate.category === category),
    `template missing category ${category}`);
  assert.ok(docs.includes(category), `docs missing category ${category}`);
}

for (const decision of FILE_CLEANUP_DECISIONS) {
  assert.ok(docs.includes(decision), `docs missing decision ${decision}`);
}

for (const evidenceKey of FILE_CLEANUP_EVIDENCE_KEYS) {
  assert.ok(contract.includes(evidenceKey), `contract missing evidence key ${evidenceKey}`);
  assert.ok(docs.includes(evidenceKey), `docs missing evidence key ${evidenceKey}`);
}

const validation = validateFileCleanupEvidencePack(template);
assert.equal(validation.ok, true, `template invalid: ${validation.missing.join(", ")}`);

for (const required of [
  "evidence-only",
  "must not delete, archive, or move files",
  "npm run check:fast",
  "IPC channels, HTTP routes, tool ids, artifact kinds",
  "large_mixed_responsibility_file",
  "node scripts/run-file-cleanup-candidates.mjs",
  "npm run clean:local",
  ".tmp-checkfast.log",
  ".codex-behavior.log"
]) {
  assert.ok(docs.includes(required), `docs missing required phrase: ${required}`);
}

for (const required of [
  "File Cleanup Evidence Pack",
  "file-cleanup-evidence-pack.md",
  "src/shared/file-cleanup-evidence-pack.mjs",
  "scripts/run-file-cleanup-candidates.mjs",
  "scripts/clean-local-generated.mjs"
]) {
  assert.ok(globalPlan.includes(required) || architectureReadme.includes(required),
    `architecture docs missing ${required}`);
}

for (const forbidden of [
  "unlinkSync",
  "rmSync",
  "rmdirSync",
  "Remove-Item",
  "moveFileSync",
  "renameSync"
]) {
  assert.equal(runner.includes(forbidden), false, `cleanup candidate runner must not use ${forbidden}`);
}

for (const required of [
  "LOCAL_GENERATED_CLEANUP_PATHS",
  "isDisposableLocalCleanupPath",
  "isForbiddenCleanupPath",
  "relativeInsideRoot",
  "--dry-run"
]) {
  assert.ok(cleaner.includes(required), `local cleaner missing ${required}`);
}

for (const rel of [".tmp", "tmp", ".tmp-checkfast.log", ".codex-behavior.log"]) {
  assert.ok(cleaner.includes(`"${rel}"`), `local cleaner missing disposable path ${rel}`);
}

for (const forbidden of [
  "node_modules",
  "dist",
  "child_process",
  "execSync",
  "spawnSync",
  "Remove-Item"
]) {
  assert.equal(cleaner.includes(forbidden), false, `local cleaner must not reference ${forbidden}`);
}

assert.match(tests, /local generated output can be marked delete_ready/u,
  "behavior tests must cover disposable local output");
assert.match(tests, /tracked source delete_ready requires all sweeps/u,
  "behavior tests must block tracked source deletion without evidence");
assert.match(tests, /large mixed responsibility files can require split/u,
  "behavior tests must cover large-file split candidates");

const command = "node scripts/verify-file-cleanup-evidence-pack.mjs";
assert.equal(packageJson.scripts?.["verify:file-cleanup-evidence-pack"], command,
  "package.json must expose verify:file-cleanup-evidence-pack");
assert.equal(packageJson.scripts?.["clean:local"], "node scripts/clean-local-generated.mjs",
  "package.json must expose clean:local");
assert.equal(packageJson.scripts?.["clean:local:dry-run"], "node scripts/clean-local-generated.mjs --dry-run",
  "package.json must expose clean:local:dry-run");
assert.ok(CHECK_COMMANDS.includes(command), "check manifest must include file cleanup evidence verifier");
assert.ok(FAST_CHECK_COMMANDS.includes(command), "fast check manifest must include file cleanup evidence verifier");

console.log("[file-cleanup-evidence-pack] cleanup evidence contract verified");
