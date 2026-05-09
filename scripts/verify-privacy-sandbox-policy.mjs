#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CHECK_COMMANDS, FAST_CHECK_COMMANDS } from "./check-manifest.mjs";
import {
  buildPrivacySandboxSummary,
  evaluatePrivacySandboxToolPolicy
} from "../src/service/security/privacy-sandbox-policy.mjs";

const policy = readFileSync("src/service/security/privacy-sandbox-policy.mjs", "utf8");
const broker = readFileSync("src/service/security/broker.mjs", "utf8");
const defaults = readFileSync("src/service/security/rules/defaults.json", "utf8");
const privacyVm = readFileSync("src/desktop/console/privacy_settings/view-model.mjs", "utf8");
const behavior = readFileSync("tests/behavior/privacy-sandbox-policy.test.mjs", "utf8");

assert.match(policy, /normalizePrivacySandboxPolicy/u, "privacy sandbox policy normalizer must exist");
assert.match(policy, /privacy_sandbox_blocks_network_tool/u, "network block reason must be explicit");
assert.match(policy, /privacy_sandbox_blocks_file_write_tool/u, "file-write block reason must be explicit");
assert.match(policy, /offline_mode_blocks_network_tool/u, "offline mode reason must remain stable");
assert.match(broker, /evaluatePrivacySandboxToolPolicy/u, "security broker must call privacy sandbox policy before tool execution");
assert.match(defaults, /"privacy_sandbox"/u, "security defaults must declare privacy_sandbox policy");
assert.match(privacyVm, /buildPrivacySandboxSummary/u, "privacy settings view-model must expose sandbox summary");
assert.match(behavior, /local_only privacy sandbox blocks network tools/u, "behavior tests must cover local_only network block");

const networkDecision = evaluatePrivacySandboxToolPolicy({
  config: { privacy_sandbox: { mode: "local_only" } },
  tool: { id: "web_search_fetch", required_capabilities: ["network"] }
});
assert.equal(networkDecision.allowed, false);
assert.equal(networkDecision.reason, "privacy_sandbox_blocks_network_tool");

const summary = buildPrivacySandboxSummary({ privacy_sandbox: { file_read: "block" } });
assert.equal(summary.active, true);
assert.deepEqual(summary.blockedCapabilities, ["file_read"]);

const command = "node scripts/verify-privacy-sandbox-policy.mjs";
assert.ok(CHECK_COMMANDS.includes(command), "check manifest must include privacy sandbox verifier");
assert.ok(FAST_CHECK_COMMANDS.includes(command), "fast check manifest must include privacy sandbox verifier");

console.log("[verify-privacy-sandbox-policy] FW-026 privacy sandbox policy contract OK");
