#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHECK_COMMANDS, FAST_CHECK_COMMANDS } from "./check-manifest.mjs";
import {
  DESKTOP_PRODUCT_WORKFLOW_IDS,
  validateDesktopProductEvidencePack
} from "../src/shared/desktop-product-evidence-pack.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const file = (rel) => path.join(root, rel);
const read = (rel) => readFileSync(file(rel), "utf8");

const docsPath = "docs/release/desktop_product_evidence_pack.md";
const templatePath = "docs/release/evidence/desktop-product-evidence.template.json";
assert.ok(existsSync(file(docsPath)), "missing desktop product evidence pack doc");
assert.ok(existsSync(file(templatePath)), "missing desktop product evidence template");

const moduleText = read("src/shared/desktop-product-evidence-pack.mjs");
const docs = read(docsPath);
const matrix = read("docs/release/desktop_product_acceptance_matrix.md");
const roadmap = read("docs/architecture/post-runtime-product-gap-roadmap.md");
const tests = read("tests/behavior/desktop-product-evidence-pack.test.mjs");
const template = JSON.parse(read(templatePath));

for (const required of [
  "DESKTOP_PRODUCT_EVIDENCE_PACK_SCHEMA_VERSION",
  "DESKTOP_PRODUCT_WORKFLOW_IDS",
  "DESKTOP_PRODUCT_EVIDENCE_STATUS",
  "DESKTOP_PRODUCT_REAL_ENVIRONMENT_KINDS",
  "validateDesktopProductEvidencePack",
  "buildDesktopProductEvidencePack"
]) {
  assert.match(moduleText, new RegExp(required), `evidence pack shared contract missing ${required}`);
}

for (const workflow of DESKTOP_PRODUCT_WORKFLOW_IDS) {
  assert.ok(template.rows.some((row) => row.workflow === workflow),
    `desktop product evidence template missing ${workflow}`);
}

const validation = validateDesktopProductEvidencePack(template);
assert.equal(validation.ok, true, `desktop product evidence template invalid: ${validation.missing.join(", ")}`);

for (const phrase of [
  "Desktop Product Evidence Pack",
  "pass",
  "partial",
  "fail",
  "not_run",
  "redaction note",
  "must not contain credentials",
  "npm run check:fast"
]) {
  assert.ok(docs.includes(phrase), `desktop evidence doc missing phrase: ${phrase}`);
}

for (const phrase of [
  "Desktop evidence pack runner | complete",
  "node scripts/verify-desktop-product-evidence-pack.mjs",
  "docs/release/desktop_product_evidence_pack.md"
]) {
  assert.ok(roadmap.includes(phrase), `product gap roadmap missing DXR-001 evidence phrase: ${phrase}`);
}

assert.ok(matrix.includes("Completion Evidence"), "desktop acceptance matrix must keep completion evidence section");
assert.match(tests, /validator accepts complete template shape/u,
  "behavior tests must validate complete evidence pack shape");
assert.match(tests, /requires known issue for partial and fail rows/u,
  "behavior tests must require known issues for partial/fail evidence rows");

const command = "node scripts/verify-desktop-product-evidence-pack.mjs";
assert.ok(CHECK_COMMANDS.includes(command), "check manifest must include desktop evidence verifier");
assert.ok(FAST_CHECK_COMMANDS.includes(command), "fast check manifest must include desktop evidence verifier");

console.log("[desktop-product-evidence-pack] DXR-001 evidence pack contract verified");
