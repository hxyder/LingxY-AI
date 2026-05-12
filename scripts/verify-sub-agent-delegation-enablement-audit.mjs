#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHECK_COMMANDS, FAST_CHECK_COMMANDS } from "./check-manifest.mjs";
import {
  buildSubAgentDelegationEnablementAudit,
  SUB_AGENT_DELEGATION_ENABLEMENT_CLASSES,
  SUB_AGENT_DELEGATION_REQUIRED_GATES
} from "../src/service/core/evals/sub-agent-delegation-enablement-audit.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

for (const rel of [
  "src/service/core/evals/sub-agent-delegation-enablement-audit.mjs",
  "tests/behavior/sub-agent-delegation-enablement-audit.test.mjs",
  "docs/architecture/planner-selected-delegation-enablement-audit.md"
]) {
  assert.ok(existsSync(path.join(root, rel)), `missing SA-003 artifact: ${rel}`);
}

const auditSource = read("src/service/core/evals/sub-agent-delegation-enablement-audit.mjs");
const tests = read("tests/behavior/sub-agent-delegation-enablement-audit.test.mjs");
const doc = read("docs/architecture/planner-selected-delegation-enablement-audit.md");
const architectureReadme = read("docs/architecture/README.md");
const roadmap = read("docs/architecture/post-runtime-maturity-roadmap.md");

for (const required of [
  "SUB_AGENT_DELEGATION_ENABLEMENT_SCHEMA_VERSION",
  "SUB_AGENT_DELEGATION_REQUIRED_GATES",
  "SUB_AGENT_DELEGATION_ENABLEMENT_CLASSES",
  "buildSubAgentDelegationEnablementAudit",
  "runtimeDefault: \"disabled\"",
  "plannerSelectedOnly: true",
  "automaticDelegationEnabled"
]) {
  assert.ok(auditSource.includes(required), `SA-003 audit source missing: ${required}`);
}

for (const category of Object.keys(SUB_AGENT_DELEGATION_ENABLEMENT_CLASSES)) {
  assert.ok(doc.includes(category), `SA-003 doc missing eligible class: ${category}`);
}
for (const gate of SUB_AGENT_DELEGATION_REQUIRED_GATES) {
  assert.ok(doc.includes(gate), `SA-003 doc missing required gate: ${gate}`);
}

for (const required of [
  "disabled by default",
  "eval-proven positive classes",
  "trace visibility is absent"
]) {
  assert.ok(tests.includes(required), `SA-003 behavior tests missing: ${required}`);
}

const defaultAudit = buildSubAgentDelegationEnablementAudit();
assert.equal(defaultAudit.automaticDelegationEnabled, false, "automatic delegation must stay disabled by default");
assert.ok(defaultAudit.classes.every((entry) => entry.missing.includes("feature_flag_enabled")),
  "default audit must require feature flag before enablement");
assert.ok(defaultAudit.forbiddenCategories.includes("do_not_delegate_high_risk_mutation"),
  "audit must keep high-risk mutations forbidden");
assert.ok(defaultAudit.forbiddenCategories.includes("do_not_delegate_private_context"),
  "audit must keep private context delegation forbidden");

const flaggedAudit = buildSubAgentDelegationEnablementAudit({ featureFlagEnabled: true });
assert.ok(flaggedAudit.classes.every((entry) => entry.enablement === "eligible_with_flag"),
  "feature-flagged audit should mark only configured positive classes eligible");

assert.ok(roadmap.includes("SA-003 Planner-selected delegation enablement audit | complete"),
  "maturity roadmap must mark SA-003 complete");
assert.ok(roadmap.includes("node scripts/verify-sub-agent-delegation-enablement-audit.mjs"),
  "maturity roadmap must list SA-003 verifier");
assert.ok(architectureReadme.includes("planner-selected-delegation-enablement-audit.md"),
  "architecture README must link SA-003 audit doc");

const command = "node scripts/verify-sub-agent-delegation-enablement-audit.mjs";
assert.ok(CHECK_COMMANDS.includes(command), "full check manifest must include SA-003 verifier");
assert.ok(FAST_CHECK_COMMANDS.includes(command), "fast check manifest must include SA-003 verifier");

console.log("[sub-agent-delegation-enablement] SA-003 enablement audit verified");
