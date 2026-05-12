#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CHECK_COMMANDS, FAST_CHECK_COMMANDS } from "./check-manifest.mjs";
import { CURRENT_ISOLATION_DECISIONS } from "../src/service/security/isolation-decision-records.mjs";
import {
  CURRENT_OS_SANDBOX_IMPLEMENTATION_DECISION,
  validateOsSandboxImplementationDecision
} from "../src/service/security/os-sandbox-implementation-decision.mjs";

const moduleText = readFileSync("src/service/security/os-sandbox-implementation-decision.mjs", "utf8");
const doc = readFileSync("docs/architecture/os-sandbox-implementation-decision.md", "utf8");
const tests = readFileSync("tests/behavior/os-sandbox-implementation-decision.test.mjs", "utf8");
const roadmap = readFileSync("docs/architecture/post-runtime-maturity-roadmap.md", "utf8");
const architectureReadme = readFileSync("docs/architecture/README.md", "utf8");
const manifest = readFileSync("scripts/check-manifest.mjs", "utf8");

for (const required of [
  "OS_SANDBOX_IMPLEMENTATION_DECISION_SCHEMA_VERSION",
  "OS_SANDBOX_IMPLEMENTATION_STATE",
  "OS_SANDBOX_IMPLEMENTATION_REQUIRED_FIELDS",
  "buildOsSandboxImplementationDecision",
  "validateOsSandboxImplementationDecision",
  "CURRENT_OS_SANDBOX_IMPLEMENTATION_DECISION"
]) {
  assert.match(moduleText, new RegExp(required), `OS sandbox implementation module missing ${required}`);
}

assert.match(
  moduleText,
  /CURRENT_ISOLATION_DECISIONS/u,
  "implementation decision must derive from current isolation decisions"
);
assert.match(doc, /does not introduce a new OS sandbox/u, "doc must state no new OS sandbox is introduced");
assert.match(doc, /noNewOsSandbox/u, "doc must declare current noNewOsSandbox invariant");
assert.match(doc, /real API, GUI, hardware, or packaged-build test/u,
  "doc must describe when real surface tests are required");
assert.match(tests, /defers new OS sandbox by default/u,
  "behavior tests must cover default defer decision");
assert.match(tests, /covers every current isolation record/u,
  "behavior tests must cover full inventory");

const validation = validateOsSandboxImplementationDecision(CURRENT_OS_SANDBOX_IMPLEMENTATION_DECISION);
assert.equal(validation.ok, true, `implementation decision missing ${validation.missing.join(", ")}`);

const currentIds = new Set(CURRENT_ISOLATION_DECISIONS.map((record) => record.id));
const implementationIds = new Set(
  CURRENT_OS_SANDBOX_IMPLEMENTATION_DECISION.candidates.map((candidate) => candidate.id)
);
assert.deepEqual(implementationIds, currentIds, "implementation decision must cover every isolation record");

for (const id of currentIds) {
  assert.match(doc, new RegExp(id), `implementation doc missing ${id}`);
}

assert.match(roadmap, /SH-004 OS sandbox implementation decision \| complete/u,
  "maturity roadmap must mark SH-004 complete");
assert.match(roadmap, /node scripts\/verify-os-sandbox-implementation-decision\.mjs/u,
  "maturity roadmap must include OS sandbox implementation verifier");
assert.match(architectureReadme, /\[os-sandbox-implementation-decision\.md\]/u,
  "architecture README must link OS sandbox implementation decision");
assert.match(manifest, /node scripts\/verify-os-sandbox-implementation-decision\.mjs/u,
  "check manifest must include OS sandbox implementation verifier");

const command = "node scripts/verify-os-sandbox-implementation-decision.mjs";
assert.ok(CHECK_COMMANDS.includes(command), "full check manifest must include OS sandbox implementation verifier");
assert.ok(FAST_CHECK_COMMANDS.includes(command), "fast check manifest must include OS sandbox implementation verifier");

console.log("[verify-os-sandbox-implementation-decision] SH-004 implementation decision OK");
