import test from "node:test";
import assert from "node:assert/strict";

import {
  DESKTOP_PRODUCT_WORKFLOW_IDS,
  buildDesktopProductEvidencePack,
  validateDesktopProductEvidencePack
} from "../../src/shared/desktop-product-evidence-pack.mjs";

test("desktop product evidence pack builder includes every workflow row", () => {
  const pack = buildDesktopProductEvidencePack({
    commit: "abc123",
    branch: "task/product-gap",
    rows: [
      {
        workflow: "first_run_provider_setup",
        status: "pass",
        automatedGates: ["verify:provider-setup-onboarding"],
        manualEvidence: "provider setup checked"
      }
    ]
  });
  assert.deepEqual(pack.rows.map((row) => row.workflow), DESKTOP_PRODUCT_WORKFLOW_IDS);
  assert.equal(pack.rows.find((row) => row.workflow === "first_run_provider_setup").status, "pass");
});

test("desktop product evidence pack validator accepts complete template shape", () => {
  const pack = buildDesktopProductEvidencePack({
    commit: "abc123",
    branch: "task/product-gap",
    rows: DESKTOP_PRODUCT_WORKFLOW_IDS.map((workflow) => ({
      workflow,
      status: "not_run",
      automatedGates: ["npm run check:fast"],
      manualEvidence: "not recorded"
    }))
  });
  const validation = validateDesktopProductEvidencePack(pack);
  assert.equal(validation.ok, true, validation.missing.join(", "));
});

test("desktop product evidence pack validator requires known issue for partial and fail rows", () => {
  const pack = buildDesktopProductEvidencePack({
    commit: "abc123",
    branch: "task/product-gap",
    rows: DESKTOP_PRODUCT_WORKFLOW_IDS.map((workflow) => ({
      workflow,
      status: workflow === "connector_workflows" ? "partial" : "not_run",
      automatedGates: ["npm run check:fast"],
      manualEvidence: "not recorded"
    }))
  });
  const validation = validateDesktopProductEvidencePack(pack);
  assert.equal(validation.ok, false);
  assert.ok(validation.missing.includes("connector_workflows.knownIssue"));
});

test("desktop product evidence pack validator requires redaction for live environments", () => {
  const pack = buildDesktopProductEvidencePack({
    commit: "abc123",
    branch: "task/product-gap",
    realEnvironments: [{ kind: "provider_api", status: "pass" }],
    rows: DESKTOP_PRODUCT_WORKFLOW_IDS.map((workflow) => ({
      workflow,
      status: "not_run",
      automatedGates: ["npm run check:fast"],
      manualEvidence: "not recorded"
    }))
  });
  const validation = validateDesktopProductEvidencePack(pack);
  assert.equal(validation.ok, false);
  assert.ok(validation.missing.includes("provider_api.redaction"));
});
