import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPolicyTraceExport } from "../src/service/security/policy-trace-export.mjs";

const policyTrace = readFileSync("src/service/security/policy-trace-export.mjs", "utf8");
const exportBundle = readFileSync("src/service/core/export-bundle.mjs", "utf8");
const diagnosticBundle = readFileSync("src/service/core/diagnostic-bundle.mjs", "utf8");
const tests = readFileSync("tests/behavior/policy-trace-export.test.mjs", "utf8");
const roadmap = readFileSync("docs/architecture/post-runtime-upgrade-roadmap.md", "utf8");
const docs = readFileSync("docs/architecture/security-policy-trace-export.md", "utf8");
const manifest = readFileSync("scripts/check-manifest.mjs", "utf8");

for (const required of [
  "POLICY_TRACE_EXPORT_SCHEMA_VERSION",
  "buildPolicyTraceExport",
  "tool.blocked_by_policy",
  "tool.rate_limited",
  "redaction.applied",
  "kill_switch.toggle",
  "presenter_mode.toggle",
  "raw_tool_arguments",
  "raw_context_text"
]) {
  assert.match(policyTrace, new RegExp(required), `policy trace exporter missing ${required}`);
}

assert.match(exportBundle, /policyTrace:\s*buildPolicyTraceExport/u,
  "runtime export bundle must include policyTrace");
assert.match(exportBundle, /policy_trace_redacted/u,
  "runtime export manifest must list policy_trace_redacted");
assert.match(diagnosticBundle, /policyTrace:\s*buildPolicyTraceExport/u,
  "diagnostic bundle must include policyTrace");
assert.match(diagnosticBundle, /policy_trace/u,
  "diagnostic manifest must list policy_trace");

for (const required of [
  "summarizes blocked decisions",
  "redacts secrets",
  "runtime export bundle includes redacted policy trace",
  "diagnostic bundle includes bounded policy trace"
]) {
  assert.match(tests, new RegExp(required), `policy trace behavior tests missing ${required}`);
}

const trace = buildPolicyTraceExport({
  store: {
    listAuditLogs() {
      return [{
        ts: "2026-05-12T00:00:00.000Z",
        event_subtype: "tool.blocked_by_policy",
        payload: { apiKey: "sk-live-redaction-test", reason: "privacy_sandbox_blocks_network_tool" }
      }];
    },
    listPendingApprovals() { return []; },
    listTasks() { return []; }
  }
});
assert.equal(trace.summary.decisions, 1);
assert.ok(!JSON.stringify(trace).includes("sk-live-redaction-test"), "policy trace must redact secret values");

assert.match(docs, /Security Policy Trace Export/u,
  "policy trace architecture doc missing title");
assert.match(docs, /does not include raw tool\s+arguments or raw context text/u,
  "policy trace doc must state raw secrets/content exclusion");
assert.match(roadmap, /SH-003: Audit Export And Policy Trace/u,
  "roadmap must keep SH-003 section");
assert.match(roadmap, /src\/service\/security\/policy-trace-export\.mjs/u,
  "roadmap must document SH-003 implementation");
assert.match(manifest, /node scripts\/verify-policy-trace-export\.mjs/u,
  "check manifest must include policy trace verifier");

console.log("[verify-policy-trace-export] SH-003 policy trace export OK");
