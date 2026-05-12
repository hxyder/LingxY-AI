#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CHECK_COMMANDS, FAST_CHECK_COMMANDS } from "./check-manifest.mjs";
import {
  DESKTOP_GUI_DAILY_WORKFLOW_GROUPS,
  validateDesktopGuiDailyWorkflowCoverage
} from "../src/shared/desktop-gui-smoke-workflow-coverage.mjs";

const moduleText = readFileSync("src/shared/desktop-gui-smoke-workflow-coverage.mjs", "utf8");
const runner = readFileSync("src/desktop/smoke/desktop-gui-smoke-runner.mjs", "utf8");
const doc = readFileSync("docs/architecture/desktop-gui-daily-workflow-coverage.md", "utf8");
const roadmap = readFileSync("docs/architecture/post-runtime-product-gap-roadmap.md", "utf8");
const tests = readFileSync("tests/behavior/desktop-gui-smoke-workflow-coverage.test.mjs", "utf8");
const evidenceDoc = readFileSync("docs/release/desktop_product_evidence_pack.md", "utf8");
const architectureReadme = readFileSync("docs/architecture/README.md", "utf8");

for (const required of [
  "DESKTOP_GUI_DAILY_WORKFLOW_COVERAGE_SCHEMA_VERSION",
  "DESKTOP_GUI_DAILY_WORKFLOW_GROUPS",
  "summarizeDesktopGuiDailyWorkflowCoverage",
  "validateDesktopGuiDailyWorkflowCoverage"
]) {
  assert.match(moduleText, new RegExp(required), `desktop GUI workflow coverage module missing ${required}`);
}

const allRequiredChecks = DESKTOP_GUI_DAILY_WORKFLOW_GROUPS.flatMap((group) => group.requiredChecks);
for (const checkName of allRequiredChecks) {
  assert.match(runner, new RegExp(checkName), `Electron GUI smoke runner missing check ${checkName}`);
  assert.match(doc, new RegExp(checkName), `desktop GUI workflow doc missing check ${checkName}`);
}

const validation = validateDesktopGuiDailyWorkflowCoverage(allRequiredChecks);
assert.equal(validation.ok, true, `workflow coverage self-check failed: ${validation.missing.join(", ")}`);

for (const workflow of [
  "conversation_continuity",
  "task_operations",
  "artifact_workflow"
]) {
  assert.match(doc, new RegExp(workflow), `desktop GUI workflow doc missing ${workflow}`);
}

assert.match(tests, /validates complete smoke result/u,
  "behavior tests must validate complete smoke result");
assert.match(roadmap, /DXR-002 Daily conversation\/task\/artifact GUI matrix \| complete/u,
  "product gap roadmap must mark DXR-002 complete");
assert.match(roadmap, /node scripts\/verify-desktop-gui-daily-workflow-coverage\.mjs/u,
  "product gap roadmap must include DXR-002 verifier");
assert.match(evidenceDoc, /Desktop Product Evidence Pack/u,
  "desktop evidence doc must remain available for real smoke evidence");
assert.match(architectureReadme, /\[desktop-gui-daily-workflow-coverage\.md\]/u,
  "architecture README must link desktop GUI daily workflow coverage");

const command = "node scripts/verify-desktop-gui-daily-workflow-coverage.mjs";
assert.ok(CHECK_COMMANDS.includes(command), "check manifest must include desktop GUI workflow coverage verifier");
assert.ok(FAST_CHECK_COMMANDS.includes(command), "fast check manifest must include desktop GUI workflow coverage verifier");

console.log("[desktop-gui-daily-workflow-coverage] DXR-002 daily workflow coverage verified");
