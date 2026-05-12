import test from "node:test";
import assert from "node:assert/strict";

import {
  SANDBOX_EVIDENCE_SURFACE_IDS,
  buildSandboxEvidencePack,
  detectSandboxEvidenceSecretLeaks,
  redactSandboxEvidencePack,
  validateSandboxEvidencePack
} from "../../src/shared/sandbox-evidence-pack.mjs";

test("sandbox evidence pack builder includes every high-risk surface", () => {
  const pack = buildSandboxEvidencePack({
    commit: "abc123",
    branch: "task/sbox",
    surfaces: [
      {
        id: "file_mutation",
        status: "pass",
        command: "node scripts/verify-write-edit-run-tools-contract.mjs",
        evidence: "file mutation guard verified",
        measured: true,
        mitigation: "confirmation gate and reversible checkpoint"
      }
    ]
  });
  assert.deepEqual(pack.surfaces.map((surface) => surface.id), SANDBOX_EVIDENCE_SURFACE_IDS);
  assert.equal(pack.surfaces.find((surface) => surface.id === "file_mutation").status, "pass");
});

test("sandbox evidence validator accepts complete template shape", () => {
  const pack = buildSandboxEvidencePack({
    commit: "abc123",
    branch: "task/sbox"
  });
  const validation = validateSandboxEvidencePack(pack);
  assert.equal(validation.ok, true, validation.missing.join(", "));
});

test("sandbox evidence validator rejects boundary changes in evidence-only phase", () => {
  const pack = buildSandboxEvidencePack({
    commit: "abc123",
    branch: "task/sbox",
    boundaryChange: true
  });
  const validation = validateSandboxEvidencePack(pack);
  assert.equal(validation.ok, false);
  assert.ok(validation.missing.includes("boundaryChange"));
});

test("sandbox evidence redaction removes secret-like strings", () => {
  const pack = buildSandboxEvidencePack({
    commit: "abc123",
    branch: "task/sbox",
    surfaces: [
      {
        id: "command_execution",
        status: "pass",
        command: "node scripts/verify-security-broker.mjs",
        evidence: "Authorization: Bearer secret-token-value-1234567890",
        measured: true,
        mitigation: "security broker policy"
      }
    ]
  });
  const redacted = redactSandboxEvidencePack(pack);
  assert.equal(detectSandboxEvidenceSecretLeaks(redacted).length, 0);
  assert.match(JSON.stringify(redacted), /\[REDACTED_SECRET\]/u);
});
