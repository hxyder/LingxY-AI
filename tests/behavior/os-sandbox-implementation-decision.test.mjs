import test from "node:test";
import assert from "node:assert/strict";

import {
  CURRENT_ISOLATION_DECISIONS,
  ISOLATION_DECISION_KIND
} from "../../src/service/security/isolation-decision-records.mjs";
import {
  CURRENT_OS_SANDBOX_IMPLEMENTATION_DECISION,
  OS_SANDBOX_IMPLEMENTATION_DECISION_SCHEMA_VERSION,
  buildOsSandboxImplementationDecision,
  validateOsSandboxImplementationDecision
} from "../../src/service/security/os-sandbox-implementation-decision.mjs";

test("OS sandbox implementation decision defers new OS sandbox by default", () => {
  const decision = CURRENT_OS_SANDBOX_IMPLEMENTATION_DECISION;
  assert.equal(decision.schemaVersion, OS_SANDBOX_IMPLEMENTATION_DECISION_SCHEMA_VERSION);
  assert.equal(decision.state, "defer_new_os_sandbox");
  assert.equal(decision.runtimeDefault, "keep_existing_boundary");
  assert.equal(decision.noNewOsSandbox, true);
  assert.equal(
    decision.candidates.some(
      (candidate) => candidate.currentBoundary === ISOLATION_DECISION_KIND.OS_SANDBOX_REQUIRED
    ),
    false
  );
});

test("OS sandbox implementation decision covers every current isolation record", () => {
  const currentIds = new Set(CURRENT_ISOLATION_DECISIONS.map((record) => record.id));
  const implementationIds = new Set(
    CURRENT_OS_SANDBOX_IMPLEMENTATION_DECISION.candidates.map((candidate) => candidate.id)
  );
  assert.deepEqual(implementationIds, currentIds);
});

test("OS sandbox implementation decision preserves measured evidence gates", () => {
  const candidates = new Map(
    CURRENT_OS_SANDBOX_IMPLEMENTATION_DECISION.candidates.map((candidate) => [
      candidate.id,
      candidate
    ])
  );
  assert.equal(
    candidates.get("ocr_extractors").implementationDecision,
    "measure_before_sidecar_or_os_sandbox"
  );
  assert.match(candidates.get("ocr_extractors").requiredEvidenceBeforeChange, /Latency/);
  assert.equal(
    candidates.get("mcp_install_sandbox").implementationDecision,
    "keep_install_sandbox_child_process"
  );
  assert.match(candidates.get("mcp_install_sandbox").requiredEvidenceBeforeChange, /MCP install sandbox/);
});

test("OS sandbox implementation decision rejects uncataloged isolation decisions", () => {
  assert.throws(
    () =>
      buildOsSandboxImplementationDecision({
        decisions: [
          {
            id: "new_surface",
            owner: "src/service/new",
            scope: "new surface",
            currentBoundary: ISOLATION_DECISION_KIND.CHILD_PROCESS,
            decision: "new decision",
            riskLevel: "high",
            rollbackPath: "rollback",
            userRecovery: "recover",
            nextReviewTrigger: "trigger"
          }
        ]
      }),
    /Missing OS sandbox implementation decision/
  );
});

test("OS sandbox implementation decision validator requires rollback and user recovery", () => {
  const validation = validateOsSandboxImplementationDecision({
    schemaVersion: OS_SANDBOX_IMPLEMENTATION_DECISION_SCHEMA_VERSION,
    state: "defer_new_os_sandbox",
    runtimeDefault: "keep_existing_boundary",
    noNewOsSandbox: true,
    candidates: [
      {
        id: "file_operations",
        owner: "src/service/capabilities/tools",
        currentBoundary: ISOLATION_DECISION_KIND.SERVICE_IN_PROCESS,
        implementationDecision: "do_not_os_sandbox_now",
        requiredEvidenceBeforeChange: "measured evidence",
        rollbackPath: "",
        userRecovery: ""
      }
    ]
  });
  assert.equal(validation.ok, false);
  assert.ok(validation.missing.includes("file_operations.rollbackPath"));
  assert.ok(validation.missing.includes("file_operations.userRecovery"));
});
