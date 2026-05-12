import test from "node:test";
import assert from "node:assert/strict";

import {
  applyExternalMcpGovernanceToStatus,
  evaluateExternalMcpGovernance,
  EXTERNAL_MCP_TOKEN_POLICY,
  isExternalMcpServer
} from "../../src/service/capabilities/mcp/governance.mjs";
import { createConfiguredMCPServer } from "../../src/service/capabilities/mcp/configured.mjs";
import { createMCPRegistry } from "../../src/service/capabilities/mcp/registry.mjs";

test("external MCP governance forbids reuse of LingxY OAuth/account token refs", () => {
  const result = evaluateExternalMcpGovernance({
    id: "gmail-mcp",
    source: "runtime_config",
    env: {
      GOOGLE_TOKEN: "${secret_ref:oauth/google/default}",
      LOCAL_TOKEN: "${secret_ref:mcp/gmail/token}"
    }
  });

  assert.equal(result.external, true);
  assert.equal(result.allowed, false);
  assert.equal(result.tokenPolicy.oauthTokenReuse, "forbidden");
  assert.equal(result.violations[0]?.code, "shared_oauth_token_ref_forbidden");
  assert.deepEqual(result.violations[0]?.refs, [{ envKey: "GOOGLE_TOKEN", name: "oauth/google/default" }]);
});

test("external MCP governance allows isolated MCP secret refs", () => {
  const result = evaluateExternalMcpGovernance({
    id: "search-mcp",
    source: "plugin:search",
    env: {
      SEARCH_TOKEN: "${secret_ref:mcp/search/token}"
    }
  });

  assert.equal(result.external, true);
  assert.equal(result.allowed, true);
  assert.equal(result.tokenPolicy.tokenStore, "isolated");
  assert.equal(result.requiresConfirmation, true);
});

test("internal MCP servers are not treated as external token consumers", () => {
  assert.equal(isExternalMcpServer({ source: "lingxy_internal" }), false);
  const governed = evaluateExternalMcpGovernance({
    id: "lingxy-google",
    source: "lingxy_internal",
    env: { TOKEN: "${secret_ref:oauth/google/default}" }
  });
  assert.equal(governed.external, false);
  assert.equal(governed.allowed, true);
});

test("configured MCP status carries governance and blocks shared token refs", async () => {
  const server = createConfiguredMCPServer({
    id: "bad-mcp",
    displayName: "Bad MCP",
    transport: "stdio",
    command: "node",
    source: "runtime_config",
    env: { TOKEN: "${secret_ref:connector/google/oauth}" }
  });
  const status = await server.getStatus({
    secretStore: { getSync: () => "secret" },
    processEnv: {}
  });

  assert.equal(status.governance.allowed, false);
  assert.equal(status.available, false);
  assert.equal(status.detail, "governance_blocked");
});

test("MCP registry wraps status with governance metadata", async () => {
  const registry = createMCPRegistry([{
    id: "plugin-mcp",
    displayName: "Plugin MCP",
    transport: "stdio",
    command: "node",
    source: "plugin:demo",
    enabled: false,
    env: { TOKEN: "${secret_ref:mcp/plugin/token}" },
    async getStatus() {
      return {
        id: "plugin-mcp",
        displayName: "Plugin MCP",
        transport: "stdio",
        enabled: false,
        available: false,
        source: "plugin:demo",
        detail: "disabled"
      };
    }
  }]);

  const [status] = await registry.listStatus();
  assert.equal(status.governance.tokenPolicy.catalogOnly, EXTERNAL_MCP_TOKEN_POLICY.catalogOnly);
  assert.equal(status.governance.allowed, true);
  assert.equal(status.trustPreview.trust.thirdParty, true);
});

test("governance status wrapper preserves safe statuses", () => {
  const status = applyExternalMcpGovernanceToStatus(
    { id: "safe", source: "runtime_config", available: true, detail: "ready" },
    { env: { TOKEN: "${secret_ref:mcp/safe/token}" } }
  );
  assert.equal(status.available, true);
  assert.equal(status.detail, "ready");
  assert.equal(status.governance.requiresConfirmation, true);
});
