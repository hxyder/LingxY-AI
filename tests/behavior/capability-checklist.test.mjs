import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCapabilityChecklist,
  capabilityChecklistSummary
} from "../../src/desktop/renderer/capability-checklist.mjs";

test("capability checklist shows model setup as blocking before providers are configured", () => {
  const items = buildCapabilityChecklist({
    workspace: {
      providers: [],
      codeCliAdapters: [],
      mcpServers: [],
      skills: [],
      skillRegistries: [],
      onboarding: { pendingSuggestions: [] }
    }
  });
  const byId = new Map(items.map((entry) => [entry.id, entry]));

  assert.equal(byId.get("ai-provider")?.status, "action_needed");
  assert.equal(byId.get("model-routing")?.status, "action_needed");
  assert.equal(byId.get("skills")?.status, "recommended");
  assert.equal(byId.get("cli-mcp-files")?.status, "disabled");
  assert.equal(capabilityChecklistSummary(items).action_needed, 2);
});

test("capability checklist converts provider suggestions into direct actions", () => {
  const items = buildCapabilityChecklist({
    workspace: {
      providers: [{ id: "openai-main", configured: true, available: true, displayName: "OpenAI" }],
      codeCliAdapters: [],
      mcpServers: [],
      skills: [{ id: "write-report", entryPath: "E:\\skills\\write-report\\SKILL.md" }],
      skillRegistries: [],
      onboarding: {
        pendingSuggestions: [
          {
            id: "provider:openai-main:mcp:enable-mcp-filesystem",
            status: "pending",
            priority: "recommended",
            action: { type: "enable_builtin_mcp", serverId: "mcp-filesystem" }
          },
          {
            id: "provider:openai-main:mcp:web-research",
            status: "pending",
            priority: "optional",
            action: { type: "configure_builtin_mcp", serverId: "mcp-brave-search" }
          }
        ]
      }
    }
  });
  const byId = new Map(items.map((entry) => [entry.id, entry]));

  assert.equal(byId.get("ai-provider")?.status, "ready");
  assert.equal(byId.get("skills")?.status, "ready");
  assert.equal(byId.get("local-files")?.status, "recommended");
  assert.deepEqual(byId.get("local-files")?.action, {
    type: "suggestion",
    suggestionId: "provider:openai-main:mcp:enable-mcp-filesystem"
  });
  assert.equal(byId.get("web-research")?.status, "optional");
});

test("capability checklist promotes CLI MCP config suggestions when a code CLI is selected", () => {
  const items = buildCapabilityChecklist({
    workspace: {
      providers: [],
      codeCliAdapters: [{ id: "claude-cli", available: true, configured: true }],
      mcpServers: [],
      skills: [],
      skillRegistries: [],
      onboarding: {
        pendingSuggestions: [{
          id: "provider:claude-cli:mcp:code-cli-mcp-config",
          status: "pending",
          priority: "recommended",
          action: { type: "configure_provider_mcp_files", providerId: "claude-cli" }
        }]
      }
    }
  });
  const byId = new Map(items.map((entry) => [entry.id, entry]));

  assert.equal(byId.get("ai-provider")?.status, "ready");
  assert.equal(byId.get("cli-mcp-files")?.status, "recommended");
  assert.deepEqual(byId.get("cli-mcp-files")?.action, {
    type: "suggestion",
    suggestionId: "provider:claude-cli:mcp:code-cli-mcp-config"
  });
});

test("capability checklist treats ready MCP servers and CLI adapters as capabilities", () => {
  const items = buildCapabilityChecklist({
    workspace: {
      providers: [],
      codeCliAdapters: [{ id: "claude-cli", available: true, configured: true }],
      mcpServers: [
        { id: "mcp-filesystem", enabled: true, available: true },
        { id: "mcp-memory", enabled: true, available: true },
        { id: "mcp-brave-search", enabled: true, available: true }
      ],
      skills: [],
      skillRegistries: [{ id: "runtime-skills", rootPath: "E:\\linxi\\data\\integrations\\skills" }],
      security: { approvals: true },
      onboarding: { pendingSuggestions: [] }
    }
  });
  const byId = new Map(items.map((entry) => [entry.id, entry]));

  assert.equal(byId.get("ai-provider")?.status, "ready");
  assert.equal(byId.get("local-files")?.status, "ready");
  assert.equal(byId.get("memory")?.status, "ready");
  assert.equal(byId.get("web-research")?.status, "ready");
  assert.equal(byId.get("skills")?.status, "ready");
  assert.equal(byId.get("approval-policy")?.status, "ready");
});

test("capability checklist surfaces MCP missing_config as action_needed and names the missing refs", () => {
  const items = buildCapabilityChecklist({
    workspace: {
      providers: [{ id: "openai-main", configured: true, available: true }],
      codeCliAdapters: [],
      mcpServers: [
        {
          id: "mcp-brave-search",
          enabled: true,
          available: false,
          detail: "missing_config",
          missingEnv: [
            { envKey: "BRAVE_API_KEY", type: "env", name: "BRAVE_API_KEY" }
          ]
        }
      ],
      skills: [],
      skillRegistries: [],
      onboarding: { pendingSuggestions: [] }
    }
  });
  const byId = new Map(items.map((entry) => [entry.id, entry]));

  const web = byId.get("web-research");
  assert.equal(web?.status, "action_needed");
  // Detail must name the env reference, never echo a value.
  assert.match(web?.detail ?? "", /BRAVE_API_KEY/);
  assert.doesNotMatch(web?.detail ?? "", /value|secret/i);
});

test("capability checklist missing_config wins over a pending suggestion (action_needed > recommended)", () => {
  const items = buildCapabilityChecklist({
    workspace: {
      providers: [{ id: "openai-main", configured: true, available: true }],
      codeCliAdapters: [],
      mcpServers: [
        {
          id: "mcp-filesystem",
          enabled: true,
          available: false,
          detail: "missing_config",
          missingEnv: [
            { envKey: "FS_ROOTS", type: "env", name: "FS_ROOTS" }
          ]
        }
      ],
      skills: [],
      skillRegistries: [],
      onboarding: {
        pendingSuggestions: [{
          id: "provider:openai-main:mcp:enable-mcp-filesystem",
          status: "pending",
          priority: "recommended",
          action: { type: "enable_builtin_mcp", serverId: "mcp-filesystem" }
        }]
      }
    }
  });
  const byId = new Map(items.map((entry) => [entry.id, entry]));

  const local = byId.get("local-files");
  assert.equal(local?.status, "action_needed");
  assert.match(local?.detail ?? "", /FS_ROOTS/);
});

test("capability checklist falls through to suggestion fallback when missingEnv is empty", () => {
  const items = buildCapabilityChecklist({
    workspace: {
      providers: [{ id: "openai-main", configured: true, available: true }],
      codeCliAdapters: [],
      // disabled server, no missing_config — should remain suggestion/fallback driven
      mcpServers: [{ id: "mcp-memory", enabled: false, available: false, detail: "disabled" }],
      skills: [],
      skillRegistries: [],
      onboarding: { pendingSuggestions: [] }
    }
  });
  const byId = new Map(items.map((entry) => [entry.id, entry]));

  const memory = byId.get("memory");
  assert.equal(memory?.status, "optional");
});
