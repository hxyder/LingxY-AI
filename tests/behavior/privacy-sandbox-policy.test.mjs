import test from "node:test";
import assert from "node:assert/strict";

import { createSecurityBroker } from "../../src/service/security/broker.mjs";
import {
  buildPrivacySandboxSummary,
  evaluatePrivacySandboxToolPolicy,
  normalizePrivacySandboxPolicy
} from "../../src/service/security/privacy-sandbox-policy.mjs";
import { buildPrivacySettingsViewModel } from "../../src/desktop/console/privacy_settings/view-model.mjs";

const networkTool = { id: "web_search_fetch", required_capabilities: ["network"] };
const writeTool = { id: "write_file", required_capabilities: ["file_write"] };

test("privacy sandbox defaults preserve current allow behavior", () => {
  const policy = normalizePrivacySandboxPolicy({});
  assert.equal(policy.mode, "standard");
  assert.equal(policy.network, "allow");
  assert.equal(evaluatePrivacySandboxToolPolicy({ config: {}, tool: networkTool }).allowed, true);
});

test("local_only privacy sandbox blocks network tools with explicit reason", () => {
  const decision = evaluatePrivacySandboxToolPolicy({
    config: { privacy_sandbox: { mode: "local_only" } },
    tool: networkTool
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "privacy_sandbox_blocks_network_tool");
  assert.equal(decision.policy.network, "block");
});

test("offline mode keeps the existing offline network denial reason", () => {
  const decision = evaluatePrivacySandboxToolPolicy({
    config: { offline_mode: true, privacy_sandbox: { mode: "local_only" } },
    tool: networkTool
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "offline_mode_blocks_network_tool");
});

test("security broker applies sandbox policy to tool authorization", () => {
  const broker = createSecurityBroker({
    runtime: { store: { appendAuditLog() {} } },
    config: { privacy_sandbox: { file_write: "block" } }
  });

  const decision = broker.authorizeToolCall(writeTool, { path: "out.md" });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "privacy_sandbox_blocks_file_write_tool");
});

test("privacy settings view-model exposes sandbox summary", () => {
  const vm = buildPrivacySettingsViewModel({
    global_kill_switch: false,
    offline_mode: false,
    presenter_mode: false,
    privacy_sandbox: {
      mode: "standard",
      network: "block",
      file_read: "allow",
      file_write: "allow",
      secrets: "allow"
    }
  });

  assert.equal(vm.sandbox.active, true);
  assert.deepEqual(vm.sandbox.blockedCapabilities, ["network"]);
  assert.equal(buildPrivacySandboxSummary({ privacy_sandbox: { mode: "local_only" } }).network, "block");
});
