import test from "node:test";
import assert from "node:assert/strict";

import {
  DESKTOP_PRODUCT_WORKFLOW_IDS,
  buildDesktopProductEvidencePack
} from "../../src/shared/desktop-product-evidence-pack.mjs";
import {
  buildReleaseEvidenceBundle,
  validateReleaseEvidenceBundle
} from "../../src/shared/release-evidence-bundle.mjs";

function desktopPack() {
  return buildDesktopProductEvidencePack({
    commit: "abc123",
    branch: "task/product-gap",
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
  });
}

test("release evidence bundle validates check GUI desktop evidence and release decision", () => {
  const bundle = buildReleaseEvidenceBundle({
    commit: "abc123",
    branch: "task/product-gap",
    gates: {
      checkFast: { command: "npm run check:fast", status: "pass", summary: "134/134" },
      electronGuiSmoke: { command: "npm run verify:desktop-gui-smoke", status: "pass", summary: "49/49" },
      releaseReadiness: { command: "node scripts/verify-release-readiness.mjs", status: "pass", summary: "ready" }
    },
    desktopProductEvidence: desktopPack(),
    realEvidence: [{
      kind: "live_provider_acceptance",
      status: "not_run",
      summary: "no credentials in deterministic gate",
      live: false
    }],
    policyTraces: [{
      kind: "policy_trace_export",
      status: "pass",
      summary: "redacted policy trace bundle present"
    }],
    knownIssues: [],
    environment: {
      os: "Windows",
      node: "22.12.0",
      electron: "smoke"
    },
    releaseDecision: {
      status: "pass",
      summary: "all deterministic gates passed",
      blockerCount: 0
    }
  });

  assert.equal(validateReleaseEvidenceBundle(bundle).ok, true);
});

test("release evidence bundle requires known issues for partial release decisions", () => {
  const bundle = buildReleaseEvidenceBundle({
    commit: "abc123",
    branch: "task/product-gap",
    desktopProductEvidence: desktopPack(),
    releaseDecision: {
      status: "partial",
      summary: "known blocker remains",
      blockerCount: 1
    }
  });
  const validation = validateReleaseEvidenceBundle(bundle);

  assert.equal(validation.ok, false);
  assert.ok(validation.missing.includes("knownIssues.release_blockers"));
});

test("release evidence bundle requires redaction notes for live evidence", () => {
  const bundle = buildReleaseEvidenceBundle({
    commit: "abc123",
    branch: "task/product-gap",
    desktopProductEvidence: desktopPack(),
    realEvidence: [{
      kind: "connector_oauth_acceptance",
      status: "pass",
      path: ".tmp/connector-oauth/report.json",
      live: true
    }],
    releaseDecision: {
      status: "pass",
      summary: "ready"
    }
  });
  const validation = validateReleaseEvidenceBundle(bundle);

  assert.equal(validation.ok, false);
  assert.ok(validation.missing.includes("realEvidence.0.redaction"));
});
