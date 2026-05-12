#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHECK_COMMANDS, FAST_CHECK_COMMANDS } from "./check-manifest.mjs";
import {
  LIVE_PROVIDER_ACCEPTANCE_SCENARIOS,
  validateLiveProviderAcceptanceReport
} from "../src/shared/live-provider-acceptance-harness.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const file = (rel) => path.join(root, rel);
const read = (rel) => readFileSync(file(rel), "utf8");

const contractPath = "src/shared/live-provider-acceptance-harness.mjs";
const runnerPath = "scripts/real-llm-test/run-live-provider-acceptance.mjs";
const docsPath = "docs/architecture/live-provider-acceptance-harness.md";
const templatePath = "docs/release/evidence/live-provider-acceptance.template.json";
const testsPath = "tests/behavior/live-provider-acceptance-harness.test.mjs";

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
  "LIVE_PROVIDER_ACCEPTANCE_SCHEMA_VERSION",
  "LIVE_PROVIDER_ACCEPTANCE_SCENARIOS",
  "buildLiveProviderAcceptanceReport",
  "validateLiveProviderAcceptanceReport",
  "redactLiveProviderAcceptanceReport",
  "detectLiveProviderAcceptanceSecretLeaks"
]) {
  assert.ok(contract.includes(required), `contract missing ${required}`);
}

for (const scenario of LIVE_PROVIDER_ACCEPTANCE_SCENARIOS) {
  assert.ok(template.scenarios.some((entry) => entry.id === scenario.id),
    `template missing scenario ${scenario.id}`);
}

const validation = validateLiveProviderAcceptanceReport(template);
assert.equal(validation.ok, true, `template invalid: ${validation.missing.join(", ")} leaks=${validation.leaks.join(", ")}`);

for (const required of [
  "LINGXY_LIVE_PROVIDER_ACCEPTANCE",
  "--live",
  "/ai/providers",
  "/config/integrations",
  "POST /task",
  "collectTokenMetrics",
  "redactLiveProviderAcceptanceReport",
  "validateLiveProviderAcceptanceReport"
]) {
  assert.ok(runner.includes(required), `runner missing ${required}`);
}

for (const required of [
  "Live Provider Acceptance Harness",
  "dry run",
  "Live mode",
  "Redacted",
  "must not store API keys"
]) {
  assert.ok(docs.includes(required), `docs missing ${required}`);
}

for (const required of [
  "LAPI-001 Live provider acceptance harness | complete",
  "node scripts/verify-live-provider-acceptance-harness.mjs",
  "node scripts/real-llm-test/run-live-provider-acceptance.mjs",
  "docs/release/evidence/live-provider-acceptance.template.json"
]) {
  assert.ok(roadmap.includes(required), `roadmap missing ${required}`);
}

assert.match(tests, /validator accepts complete dry-run template/u,
  "behavior tests must validate the dry-run report shape");
assert.match(tests, /redaction removes API-key-like values/u,
  "behavior tests must cover report redaction");

const command = "node scripts/verify-live-provider-acceptance-harness.mjs";
assert.ok(CHECK_COMMANDS.includes(command), "check manifest must include live provider acceptance verifier");
assert.ok(FAST_CHECK_COMMANDS.includes(command), "fast check manifest must include live provider acceptance verifier");

console.log("[live-provider-acceptance] LAPI-001 harness contract verified");
