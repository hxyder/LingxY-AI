import test from "node:test";
import assert from "node:assert/strict";

import {
  CONNECTOR_OAUTH_ACCEPTANCE_PROVIDERS,
  CONNECTOR_OAUTH_ACCEPTANCE_SCENARIOS,
  buildConnectorOAuthAcceptanceReport,
  detectConnectorOAuthAcceptanceSecretLeaks,
  redactConnectorOAuthAcceptanceReport,
  validateConnectorOAuthAcceptanceReport
} from "../../src/shared/connector-oauth-acceptance-harness.mjs";

test("connector OAuth report builder includes all providers and scenarios", () => {
  const report = buildConnectorOAuthAcceptanceReport({
    commit: "abc123",
    branch: "task/connector-acceptance",
    scenarios: [
      {
        id: "connector_catalog",
        status: "pass",
        command: "GET /connectors/catalog",
        evidence: "google and microsoft providers present"
      }
    ]
  });
  assert.deepEqual(report.providers.map((provider) => provider.provider), CONNECTOR_OAUTH_ACCEPTANCE_PROVIDERS);
  assert.deepEqual(report.scenarios.map((scenario) => scenario.id), CONNECTOR_OAUTH_ACCEPTANCE_SCENARIOS.map((scenario) => scenario.id));
  assert.equal(report.scenarios.find((scenario) => scenario.id === "connector_catalog").status, "pass");
});

test("connector OAuth validator accepts complete dry-run template", () => {
  const report = buildConnectorOAuthAcceptanceReport({
    commit: "abc123",
    branch: "task/connector-acceptance"
  });
  const validation = validateConnectorOAuthAcceptanceReport(report);
  assert.equal(validation.ok, true, validation.missing.join(", "));
});

test("connector OAuth validator requires live opt-in in live mode", () => {
  const report = buildConnectorOAuthAcceptanceReport({
    commit: "abc123",
    branch: "task/connector-acceptance",
    mode: "live",
    liveOptIn: false
  });
  const validation = validateConnectorOAuthAcceptanceReport(report);
  assert.equal(validation.ok, false);
  assert.ok(validation.missing.includes("liveOptIn"));
});

test("connector OAuth report redaction removes OAuth token-like values", () => {
  const raw = buildConnectorOAuthAcceptanceReport({
    commit: "abc123",
    branch: "task/connector-acceptance",
    scenarios: [
      {
        id: "token_refresh",
        status: "pass",
        command: "GET /connectors/accounts/google/emails",
        evidence: "Authorization: Bearer ya29.this-is-a-token-like-value-1234567890"
      }
    ]
  });
  const redacted = redactConnectorOAuthAcceptanceReport(raw);
  assert.equal(detectConnectorOAuthAcceptanceSecretLeaks(redacted).length, 0);
  assert.match(JSON.stringify(redacted), /\[REDACTED_SECRET\]/u);
});
