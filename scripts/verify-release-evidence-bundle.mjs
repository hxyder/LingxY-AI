#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { CHECK_COMMANDS, FAST_CHECK_COMMANDS } from "./check-manifest.mjs";
import {
  DESKTOP_PRODUCT_WORKFLOW_IDS,
  buildDesktopProductEvidencePack
} from "../src/shared/desktop-product-evidence-pack.mjs";
import {
  buildReleaseEvidenceBundle,
  validateReleaseEvidenceBundle
} from "../src/shared/release-evidence-bundle.mjs";

function read(path) {
  assert.ok(existsSync(path), `Missing required file: ${path}`);
  return readFileSync(path, "utf8");
}

const contract = read("src/shared/release-evidence-bundle.mjs");
const docs = read("docs/release/release_evidence_bundle.md");
const template = read("docs/release/evidence/release-evidence-bundle.template.json");
const tests = read("tests/behavior/release-evidence-bundle.test.mjs");
const roadmap = read("docs/architecture/post-runtime-product-gap-roadmap.md");
const releaseReadme = read("docs/release/README.md");

assert.match(contract, /validateDesktopProductEvidencePack/u, "release bundle must validate desktop product evidence pack");
assert.match(contract, /checkFast/u, "release bundle must include check:fast gate");
assert.match(contract, /electronGuiSmoke/u, "release bundle must include Electron GUI smoke gate");
assert.match(contract, /releaseReadiness/u, "release bundle must include release readiness gate");
assert.match(contract, /realEvidence/u, "release bundle must include real evidence refs");
assert.match(contract, /policyTraces/u, "release bundle must include policy traces");
assert.match(contract, /knownIssues\.release_blockers/u, "release bundle must require known issues for partial/fail decisions");
assert.match(contract, /redaction/u, "release bundle must require redaction notes for live evidence");
assert.match(docs, /check:fast` alone is never enough/u, "docs must state check:fast alone is insufficient");
assert.match(template, /releaseReadiness/u, "template must include release readiness gate");
assert.match(template, /live_provider_acceptance/u, "template must include live provider evidence ref");
assert.match(template, /connector_oauth_acceptance/u, "template must include connector evidence ref");
assert.match(tests, /requires known issues for partial release decisions/u,
  "behavior tests must cover partial/fail known issue requirement");
assert.match(tests, /requires redaction notes for live evidence/u,
  "behavior tests must cover live evidence redaction requirement");
assert.match(roadmap, /REL-001 Release evidence bundle \| complete/u, "roadmap must mark REL-001 complete");
assert.match(releaseReadme, /release_evidence_bundle\.md/u, "release README must link release evidence bundle docs");

const bundle = buildReleaseEvidenceBundle({
  commit: "abc123",
  branch: "task/release-evidence",
  gates: {
    checkFast: { command: "npm run check:fast", status: "pass", summary: "134/134" },
    electronGuiSmoke: { command: "npm run verify:desktop-gui-smoke", status: "pass", summary: "49/49" },
    releaseReadiness: { command: "node scripts/verify-release-readiness.mjs", status: "pass", summary: "ready" }
  },
  desktopProductEvidence: buildDesktopProductEvidencePack({
    commit: "abc123",
    branch: "task/release-evidence",
    checkFast: { command: "npm run check:fast", status: "pass", summary: "134/134" },
    electronGuiSmoke: { command: "npm run verify:desktop-gui-smoke", status: "pass", summary: "49/49" },
    realEnvironments: [{ kind: "electron_gui", status: "pass", redaction: "no secrets" }],
    rows: DESKTOP_PRODUCT_WORKFLOW_IDS.map((workflow) => ({
      workflow,
      status: "pass",
      automatedGates: ["npm run check:fast"],
      manualEvidence: `${workflow} covered by deterministic release bundle fixture`
    })),
    knownIssues: []
  }),
  releaseDecision: { status: "pass", summary: "ready", blockerCount: 0 }
});

assert.equal(validateReleaseEvidenceBundle(bundle).ok, true);

const command = "node scripts/verify-release-evidence-bundle.mjs";
assert.ok(CHECK_COMMANDS.includes(command), "check manifest must include release evidence bundle verifier");
assert.ok(FAST_CHECK_COMMANDS.includes(command), "fast check manifest must include release evidence bundle verifier");

console.log("[release-evidence-bundle] REL-001 release evidence bundle contract verified");
