#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHECK_COMMANDS, FAST_CHECK_COMMANDS } from "./check-manifest.mjs";
import {
  CONNECTOR_OAUTH_ACCEPTANCE_SCENARIOS,
  validateConnectorOAuthAcceptanceReport
} from "../src/shared/connector-oauth-acceptance-harness.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const file = (rel) => path.join(root, rel);
const read = (rel) => readFileSync(file(rel), "utf8");

const contractPath = "src/shared/connector-oauth-acceptance-harness.mjs";
const runnerPath = "scripts/real-connector-test/run-connector-oauth-acceptance.mjs";
const docsPath = "docs/architecture/connector-oauth-acceptance-harness.md";
const templatePath = "docs/release/evidence/connector-oauth-acceptance.template.json";
const testsPath = "tests/behavior/connector-oauth-acceptance-harness.test.mjs";

for (const rel of [contractPath, runnerPath, docsPath, templatePath, testsPath]) {
  assert.ok(existsSync(file(rel)), `missing ${rel}`);
}

const contract = read(contractPath);
const runner = read(runnerPath);
const docs = read(docsPath);
const roadmap = read("docs/architecture/post-runtime-product-gap-roadmap.md");
const template = JSON.parse(read(templatePath));
const tests = read(testsPath);

for (const required of [
  "CONNECTOR_OAUTH_ACCEPTANCE_SCHEMA_VERSION",
  "CONNECTOR_OAUTH_ACCEPTANCE_PROVIDERS",
  "CONNECTOR_OAUTH_ACCEPTANCE_SCENARIOS",
  "buildConnectorOAuthAcceptanceReport",
  "validateConnectorOAuthAcceptanceReport",
  "redactConnectorOAuthAcceptanceReport"
]) {
  assert.ok(contract.includes(required), `contract missing ${required}`);
}

for (const scenario of CONNECTOR_OAUTH_ACCEPTANCE_SCENARIOS) {
  assert.ok(template.scenarios.some((entry) => entry.id === scenario.id),
    `template missing scenario ${scenario.id}`);
}

const validation = validateConnectorOAuthAcceptanceReport(template);
assert.equal(validation.ok, true, `template invalid: ${validation.missing.join(", ")} leaks=${validation.leaks.join(", ")}`);

for (const required of [
  "LINGXY_CONNECTOR_OAUTH_ACCEPTANCE",
  "--live",
  "/connectors/catalog",
  "/connectors/accounts",
  "/connectors/connected-accounts",
  "/auth/start",
  "redactConnectorOAuthAcceptanceReport",
  "validateConnectorOAuthAcceptanceReport"
]) {
  assert.ok(runner.includes(required), `runner missing ${required}`);
}

for (const required of [
  "Connector OAuth Acceptance Harness",
  "dry run",
  "Live mode",
  "Redacted Evidence",
  "disposable test accounts"
]) {
  assert.ok(docs.includes(required), `docs missing ${required}`);
}

for (const required of [
  "CONN-001 Real connector/OAuth acceptance | complete",
  "node scripts/verify-connector-oauth-acceptance-harness.mjs",
  "node scripts/real-connector-test/run-connector-oauth-acceptance.mjs",
  "docs/release/evidence/connector-oauth-acceptance.template.json"
]) {
  assert.ok(roadmap.includes(required), `roadmap missing ${required}`);
}

assert.match(tests, /validator accepts complete dry-run template/u,
  "behavior tests must validate dry-run shape");
assert.match(tests, /redaction removes OAuth token-like values/u,
  "behavior tests must cover OAuth token redaction");

const command = "node scripts/verify-connector-oauth-acceptance-harness.mjs";
assert.ok(CHECK_COMMANDS.includes(command), "check manifest must include connector OAuth acceptance verifier");
assert.ok(FAST_CHECK_COMMANDS.includes(command), "fast check manifest must include connector OAuth acceptance verifier");

console.log("[connector-oauth-acceptance] CONN-001 harness contract verified");
