#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHECK_COMMANDS, FAST_CHECK_COMMANDS } from "./check-manifest.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const file = (rel) => path.join(root, rel);
const read = (rel) => readFileSync(file(rel), "utf8");

const matrixPath = "docs/release/desktop_product_acceptance_matrix.md";
assert.ok(existsSync(file(matrixPath)), "missing desktop product acceptance matrix");

const matrix = read(matrixPath);
const functional = read("docs/release/functional_acceptance_matrix.md");
const userSmoke = read("docs/release/user_interaction_smoke_checklist.md");
const externalTrial = read("docs/release/external_trial_checklist.md");
const roadmap = read("docs/architecture/post-runtime-maturity-roadmap.md");

for (const workflow of [
  "First-run provider setup",
  "Conversation continuity",
  "Task operations",
  "Artifact workflow",
  "Memory governance",
  "Marketplace governance",
  "Scheduler and approvals",
  "Connector workflows",
  "Browser and Office entry",
  "Native Windows entry",
  "Recovery and diagnostics",
  "Performance and accessibility"
]) {
  assert.ok(matrix.includes(`| ${workflow} |`), `desktop product acceptance matrix missing workflow: ${workflow}`);
}

for (const command of [
  "verify:desktop-gui-smoke",
  "verify:user-interaction-smoke",
  "verify:memory-scope-filters",
  "verify:marketplace-management-ui",
  "verify:conversation-branch-contract",
  "verify:cancellation-propagation",
  "verify:policy-trace-export",
  "verify:desktop-gui-perf-smoke"
]) {
  assert.ok(matrix.includes(command), `desktop product acceptance matrix missing verifier reference: ${command}`);
}

for (const phrase of [
  "`npm run check:fast`",
  "is not enough by itself",
  "Run real API/provider/OAuth/manual tests only when the row depends on",
  "Electron GUI smoke result and check count",
  "Rows manually exercised, with pass/partial/fail"
]) {
  assert.ok(matrix.includes(phrase), `desktop product acceptance matrix missing discipline phrase: ${phrase}`);
}

assert.ok(functional.includes("desktop_product_acceptance_matrix.md"),
  "functional acceptance matrix must reference desktop product acceptance matrix");
assert.ok(functional.includes("| Marketplace governance |"),
  "functional acceptance matrix must include marketplace governance manual row");
assert.ok(userSmoke.includes("review marketplace governance"),
  "user interaction smoke checklist must include marketplace governance in Settings row");
assert.ok(userSmoke.includes("filter/undo memory"),
  "user interaction smoke checklist must include memory review UI in Settings row");
assert.ok(externalTrial.includes("- Marketplace governance result: `pass / partial / fail`"),
  "external trial checklist must record marketplace governance result");
assert.ok(roadmap.includes("DX-006 Desktop product acceptance matrix | complete"),
  "maturity roadmap must mark DX-006 complete");
assert.ok(roadmap.includes("node scripts/verify-desktop-product-acceptance-matrix.mjs"),
  "maturity roadmap must list DX-006 verifier");

const checkCommand = "node scripts/verify-desktop-product-acceptance-matrix.mjs";
assert.ok(CHECK_COMMANDS.includes(checkCommand), "check manifest must include desktop product acceptance verifier");
assert.ok(FAST_CHECK_COMMANDS.includes(checkCommand), "fast check manifest must include desktop product acceptance verifier");

console.log("[desktop-product-acceptance] desktop product acceptance matrix verified");
