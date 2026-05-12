import test from "node:test";
import assert from "node:assert/strict";

import {
  LIVE_PROVIDER_ACCEPTANCE_SCENARIOS,
  buildLiveProviderAcceptanceReport,
  detectLiveProviderAcceptanceSecretLeaks,
  redactLiveProviderAcceptanceReport,
  validateLiveProviderAcceptanceReport
} from "../../src/shared/live-provider-acceptance-harness.mjs";

test("live provider acceptance report builder includes every required scenario", () => {
  const report = buildLiveProviderAcceptanceReport({
    commit: "abc123",
    branch: "task/live-provider",
    scenarios: [
      {
        id: "provider_setup_health",
        status: "pass",
        command: "GET /ai/providers",
        evidence: "one configured provider is ready"
      }
    ]
  });
  assert.deepEqual(
    report.scenarios.map((scenario) => scenario.id),
    LIVE_PROVIDER_ACCEPTANCE_SCENARIOS.map((scenario) => scenario.id)
  );
  assert.equal(report.scenarios.find((scenario) => scenario.id === "provider_setup_health").status, "pass");
});

test("live provider acceptance report validator accepts complete dry-run template", () => {
  const report = buildLiveProviderAcceptanceReport({
    commit: "abc123",
    branch: "task/live-provider"
  });
  const validation = validateLiveProviderAcceptanceReport(report);
  assert.equal(validation.ok, true, validation.missing.join(", "));
});

test("validator requires live mode provider setup, model roles, and opt-in", () => {
  const report = buildLiveProviderAcceptanceReport({
    commit: "abc123",
    branch: "task/live-provider",
    mode: "live",
    liveOptIn: false
  });
  const validation = validateLiveProviderAcceptanceReport(report);
  assert.equal(validation.ok, false);
  assert.ok(validation.missing.includes("liveOptIn"));
  assert.ok(validation.missing.includes("provider"));
  assert.ok(validation.missing.includes("providerSetup"));
  assert.ok(validation.missing.includes("modelRoles"));
});

test("redaction removes API-key-like values from evidence", () => {
  const raw = buildLiveProviderAcceptanceReport({
    commit: "abc123",
    branch: "task/live-provider",
    scenarios: [
      {
        id: "short_text_task",
        status: "pass",
        command: "POST /task",
        evidence: "Authorization: Bearer sk-test-secret-value-1234567890"
      }
    ]
  });
  const redacted = redactLiveProviderAcceptanceReport(raw);
  assert.equal(detectLiveProviderAcceptanceSecretLeaks(redacted).length, 0);
  assert.match(JSON.stringify(redacted), /\[REDACTED_SECRET\]/u);
});
