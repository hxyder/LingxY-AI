import test from "node:test";
import assert from "node:assert/strict";

import {
  CURRENT_ISOLATION_DECISIONS,
  ISOLATION_DECISION_KIND,
  SIDECAR_DECISION_REQUIRED_FIELDS,
  listIsolationDecisionRecords,
  validateIsolationDecisionRecord,
  validateSidecarDecisionRecord
} from "../../src/service/security/isolation-decision-records.mjs";

test("current isolation decisions cover high-risk runtime surfaces", () => {
  const ids = new Set(CURRENT_ISOLATION_DECISIONS.map((record) => record.id));
  for (const required of [
    "file_operations",
    "external_commands",
    "browser_automation",
    "ocr_extractors",
    "audio_daemons",
    "mcp_install_sandbox"
  ]) {
    assert.equal(ids.has(required), true, `${required} decision missing`);
  }
});

test("current isolation decisions have rollback and user recovery contracts", () => {
  for (const record of listIsolationDecisionRecords()) {
    const validation = validateIsolationDecisionRecord(record);
    assert.equal(validation.ok, true, `${record.id} missing ${validation.missing.join(", ")}`);
    assert.ok(Object.values(ISOLATION_DECISION_KIND).includes(record.currentBoundary));
    assert.match(record.rollbackPath, /\S/);
    assert.match(record.userRecovery, /\S/);
    assert.match(record.nextReviewTrigger, /\S/);
  }
});

test("sidecar decision template rejects business-logic rewrites without evidence", () => {
  const rejected = validateSidecarDecisionRecord({
    id: "rewrite-runtime",
    owner: "src/service/core",
    scope: "Move business logic elsewhere.",
    measuredBottleneck: "",
    workerInsufficientReason: "",
    serializationBoundary: "json",
    cancellationBoundary: "kill",
    failureBehavior: "fail",
    packagingImpact: "unknown",
    rollbackPath: "unknown",
    userRecovery: "unknown",
    businessLogicRewriteProhibited: false
  });
  assert.equal(rejected.allowed, false);
  assert.ok(rejected.missing.includes("measuredBottleneck"));
  assert.ok(rejected.missing.includes("workerInsufficientReason"));
  assert.ok(rejected.missing.includes("businessLogicRewriteProhibited"));
});

test("complete sidecar decision record is accepted by the contract", () => {
  const record = Object.fromEntries(SIDECAR_DECISION_REQUIRED_FIELDS.map((field) => [
    field,
    field === "businessLogicRewriteProhibited" ? true : `${field} value`
  ]));
  const validation = validateSidecarDecisionRecord(record);
  assert.equal(validation.ok, true);
  assert.equal(validation.allowed, true);
});
