import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const governance = readFileSync("src/service/capabilities/mcp/governance.mjs", "utf8");
const configured = readFileSync("src/service/capabilities/mcp/configured.mjs", "utf8");
const registry = readFileSync("src/service/capabilities/mcp/registry.mjs", "utf8");
const bridge = readFileSync("src/service/capabilities/connectors/core/mcp-catalog-bridge.mjs", "utf8");
const tests = readFileSync("tests/behavior/mcp-governance.test.mjs", "utf8");
const mcpIntegration = readFileSync("docs/task-runtime/MCP_INTEGRATION.md", "utf8");
const roadmap = readFileSync("docs/architecture/post-runtime-upgrade-roadmap.md", "utf8");
const manifest = readFileSync("scripts/check-manifest.mjs", "utf8");

for (const required of [
  "EXTERNAL_MCP_TOKEN_POLICY",
  "oauthTokenReuse: \"forbidden\"",
  "tokenStore: \"isolated\"",
  "catalogOnly: true",
  "requiresConfirmation: true",
  "shared_oauth_token_ref_forbidden",
  "evaluateExternalMcpGovernance",
  "applyExternalMcpGovernanceToStatus"
]) {
  assert.match(governance, new RegExp(required), `MCP governance module missing ${required}`);
}

assert.match(configured, /applyExternalMcpGovernanceToStatus/u,
  "configured MCP status must apply governance");
assert.match(registry, /applyExternalMcpGovernanceToStatus/u,
  "MCP registry statuses must apply governance");
assert.match(bridge, /evaluateExternalMcpGovernance/u,
  "external MCP catalog bridge must evaluate governance before discovery");
assert.match(bridge, /if \(!governance\.allowed\) return/u,
  "external MCP catalog bridge must skip governance-blocked servers");
assert.match(bridge, /source:\s*"external_mcp"/u,
  "external MCP tools must remain catalog entries, not raw action tools");
assert.match(bridge, /requiresConfirmation:\s*policy\.requiresConfirmation \?\? true/u,
  "external MCP tools must default to confirmation required");

for (const required of [
  "forbids reuse of LingxY OAuth/account token refs",
  "allows isolated MCP secret refs",
  "internal MCP servers are not treated as external",
  "configured MCP status carries governance",
  "MCP registry wraps status with governance metadata"
]) {
  assert.match(tests, new RegExp(required), `MCP governance tests missing ${required}`);
}

assert.match(mcpIntegration, /External MCP token policy/u,
  "MCP integration doc must record the external token policy");
assert.match(mcpIntegration, /must not reuse LingxY OAuth or connector account tokens/u,
  "MCP integration doc must forbid OAuth/account token reuse");
assert.match(roadmap, /PM-002: External MCP Governance/u, "roadmap must keep PM-002 section");
assert.match(roadmap, /isolated token stores/u, "roadmap must document PM-002 token decision");
assert.match(manifest, /node scripts\/verify-mcp-governance-policy\.mjs/u,
  "check manifest must include MCP governance verifier");

console.log("[verify-mcp-governance-policy] PM-002 external MCP governance contract OK");
