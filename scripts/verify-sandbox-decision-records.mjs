import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CURRENT_ISOLATION_DECISIONS,
  SIDECAR_DECISION_REQUIRED_FIELDS,
  validateIsolationDecisionRecord
} from "../src/service/security/isolation-decision-records.mjs";

const moduleText = readFileSync("src/service/security/isolation-decision-records.mjs", "utf8");
const osDoc = readFileSync("docs/architecture/os-sandbox-decision-records.md", "utf8");
const sidecarDoc = readFileSync("docs/architecture/sidecar-decision-record.md", "utf8");
const roadmap = readFileSync("docs/architecture/post-runtime-upgrade-roadmap.md", "utf8");
const tests = readFileSync("tests/behavior/isolation-decision-records.test.mjs", "utf8");
const manifest = readFileSync("scripts/check-manifest.mjs", "utf8");

for (const required of [
  "ISOLATION_DECISION_SCHEMA_VERSION",
  "ISOLATION_DECISION_KIND",
  "SIDECAR_DECISION_REQUIRED_FIELDS",
  "CURRENT_ISOLATION_DECISIONS",
  "validateIsolationDecisionRecord",
  "validateSidecarDecisionRecord"
]) {
  assert.match(moduleText, new RegExp(required), `isolation decision module missing ${required}`);
}

for (const requiredId of [
  "file_operations",
  "external_commands",
  "browser_automation",
  "ocr_extractors",
  "audio_daemons",
  "mcp_install_sandbox"
]) {
  assert.ok(CURRENT_ISOLATION_DECISIONS.some((record) => record.id === requiredId),
    `current isolation decisions missing ${requiredId}`);
  assert.match(osDoc, new RegExp(requiredId), `OS sandbox decision doc missing ${requiredId}`);
}

for (const record of CURRENT_ISOLATION_DECISIONS) {
  const validation = validateIsolationDecisionRecord(record);
  assert.equal(validation.ok, true, `${record.id} missing ${validation.missing.join(", ")}`);
}

for (const field of SIDECAR_DECISION_REQUIRED_FIELDS) {
  assert.match(sidecarDoc, new RegExp(field), `sidecar decision template missing ${field}`);
}

assert.match(sidecarDoc, /Sidecars are prohibited as a general business-logic rewrite/u,
  "sidecar decision doc must prohibit sidecars as business-logic rewrite");
assert.match(osDoc, /rollback and user recovery/u,
  "OS sandbox decision doc must require rollback and user recovery");
assert.match(tests, /current isolation decisions cover high-risk runtime surfaces/u,
  "behavior test must cover current decision inventory");
assert.match(tests, /sidecar decision template rejects business-logic rewrites/u,
  "behavior test must reject sidecar rewrite without evidence");
assert.match(roadmap, /SH-001: OS-Level Sandbox Decision Records/u,
  "roadmap must keep SH-001 section");
assert.match(roadmap, /SH-002: Sidecar Decision Record Template/u,
  "roadmap must keep SH-002 section");
assert.match(manifest, /node scripts\/verify-sandbox-decision-records\.mjs/u,
  "check manifest must include sandbox decision verifier");

console.log("[verify-sandbox-decision-records] SH-001/SH-002 decision records OK");
