import test from "node:test";
import assert from "node:assert/strict";

import {
  CAPABILITY_INVENTORY_GROUPS,
  CAPABILITY_INVENTORY_SCHEMA_VERSION,
  buildCapabilityInventory
} from "../../src/service/capabilities/inventory/capability-inventory.mjs";

test("capability inventory exposes required typed groups", () => {
  const groupIds = CAPABILITY_INVENTORY_GROUPS.map((group) => group.id);
  assert.deepEqual(groupIds, [
    "built_in_tools",
    "skills",
    "mcp_servers",
    "connector_plugins",
    "connector_tools",
    "providers_model_roles",
    "user_created_drafts"
  ]);
});

test("capability inventory normalizes ownership trust policy and archive state", () => {
  const inventory = buildCapabilityInventory({
    generatedAt: "2026-05-12T00:00:00.000Z",
    actionTools: [{
      id: "write_file",
      name: "Write File",
      risk_level: "high",
      required_capabilities: ["file_write"],
      requires_confirmation: true
    }],
    skills: [{
      id: "local-summary",
      displayName: "Local Summary",
      source: "local",
      active: true
    }],
    mcpServers: [{
      id: "filesystem",
      displayName: "Filesystem",
      source: "builtin",
      enabled: false
    }],
    plugins: [{
      id: "google",
      displayName: "Google",
      source: "builtin",
      enabled: true
    }],
    connectorTools: [{
      id: "google.gmail.list_messages",
      name: "List Gmail messages",
      provider: "google",
      service: "gmail",
      risk: "low"
    }],
    providers: [{
      id: "openai",
      name: "OpenAI",
      kind: "openai",
      configured: false,
      available: false
    }],
    codeCliAdapters: [{
      id: "kimi-code-cli",
      name: "Kimi Code CLI",
      available: true
    }],
    modelRoles: [{
      role: "planner",
      status: "ready",
      providerId: "openai",
      model: "gpt-5.4-mini"
    }],
    drafts: [{
      id: "mcp-draft",
      name: "MCP Draft",
      kind: "mcp",
      status: "draft",
      validation: { ok: true }
    }]
  });

  assert.equal(inventory.schemaVersion, CAPABILITY_INVENTORY_SCHEMA_VERSION);
  assert.equal(inventory.groups.length, 7);
  assert.equal(inventory.entries.length, 9);
  assert.equal(inventory.entries.every((entry) => entry.owner && entry.targetLayer), true);

  const tool = inventory.entries.find((entry) => entry.id === "write_file");
  assert.equal(tool.policyState, "approval_required");
  assert.deepEqual(tool.metadata.required_capabilities, ["file_write"]);

  const provider = inventory.entries.find((entry) => entry.id === "openai");
  assert.equal(provider.group, "providers_model_roles");
  assert.equal(provider.policyState, "needs_setup");

  const draft = inventory.entries.find((entry) => entry.id === "mcp-draft");
  assert.equal(draft.archiveState, "recoverable");
  assert.equal(draft.enabledState, "disabled");
});

test("capability inventory keeps management routes explicit and secret-free", () => {
  const inventory = buildCapabilityInventory({
    plugins: [{
      id: "third-party",
      displayName: "Third Party",
      source: "installed",
      enabled: true,
      apiKey: "sk-should-not-leak"
    }],
    mcpServers: [{
      id: "custom-mcp",
      displayName: "Custom MCP",
      source: "runtime_config",
      enabled: true,
      env: { TOKEN: "secret" }
    }]
  });

  const json = JSON.stringify(inventory);
  assert.doesNotMatch(json, /sk-should-not-leak|TOKEN|secret/u);

  const plugin = inventory.entries.find((entry) => entry.id === "third-party");
  assert.equal(plugin.management.toggleRoute, "/plugins/third-party/enabled");
  assert.equal(plugin.management.archiveRoute, "/plugins/third-party");

  const mcp = inventory.entries.find((entry) => entry.id === "custom-mcp");
  assert.equal(mcp.management.toggleRoute, "/ai/mcp/custom-mcp/toggle");
  assert.equal(mcp.management.configRoute, "/ai/mcp/custom-mcp/config");
});
