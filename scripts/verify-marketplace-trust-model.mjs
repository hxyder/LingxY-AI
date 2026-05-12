import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const trustModel = readFileSync("src/service/capabilities/marketplace/trust-model.mjs", "utf8");
const skillRegistry = readFileSync("src/service/capabilities/skills/registry.mjs", "utf8");
const skillInstall = readFileSync("src/service/capabilities/skills/github-install.mjs", "utf8");
const skillInstallTools = readFileSync("src/service/capabilities/tools/skill-install-tools.mjs", "utf8");
const mcpRegistry = readFileSync("src/service/capabilities/mcp/registry.mjs", "utf8");
const mcpConfigured = readFileSync("src/service/capabilities/mcp/configured.mjs", "utf8");
const pluginRegistry = readFileSync("src/service/capabilities/connectors/core/plugin-registry.mjs", "utf8");
const tests = readFileSync("tests/behavior/marketplace-trust-model.test.mjs", "utf8");
const manifest = readFileSync("scripts/check-manifest.mjs", "utf8");
const roadmap = readFileSync("docs/architecture/post-runtime-upgrade-roadmap.md", "utf8");

for (const required of [
  "MARKETPLACE_TRUST_SCHEMA_VERSION",
  "TRUSTED",
  "LOCAL_ONLY",
  "THIRD_PARTY",
  "UNSIGNED",
  "DISABLED",
  "DELETED",
  "classifyMarketplaceTrust",
  "buildMarketplaceTrustPreview"
]) {
  assert.match(trustModel, new RegExp(required), `trust model missing ${required}`);
}

assert.match(skillRegistry, /trustPreview/u, "skill registry must expose trustPreview");
assert.match(skillInstall, /trustPreview/u, "GitHub skill staging must bind a trust preview");
assert.match(skillInstallTools, /trust_preview/u, "skill install tools must surface trust_preview metadata");
assert.match(mcpRegistry, /trustPreview/u, "MCP registry must wrap status with trustPreview");
assert.match(mcpConfigured, /trustPreview/u, "configured MCP status must expose trustPreview");
assert.match(pluginRegistry, /previewInstall/u, "plugin registry must expose install preview before install");
assert.match(pluginRegistry, /trustPreview/u, "plugin registry must expose trustPreview");

for (const required of [
  "built-in, local, third-party, disabled, and deleted states",
  "skill registry exposes trust preview",
  "mcp registry wraps server statuses",
  "plugin registry exposes install trust preview",
  "stable warning ids"
]) {
  assert.match(tests, new RegExp(required), `marketplace trust tests missing ${required}`);
}

assert.match(manifest, /node scripts\/verify-marketplace-trust-model\.mjs/u,
  "check manifest must include marketplace trust verifier");
assert.match(roadmap, /PM-001: Marketplace Trust Model/u, "roadmap must keep PM-001 section");
assert.match(roadmap, /marketplace trust model/u, "roadmap must document PM-001 implementation");

console.log("[verify-marketplace-trust-model] PM-001 marketplace trust contract OK");
