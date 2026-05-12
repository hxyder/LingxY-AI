import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const policy = readFileSync("src/service/capabilities/marketplace/distribution-policy.mjs", "utf8");
const trust = readFileSync("src/service/capabilities/marketplace/trust-model.mjs", "utf8");
const pluginRegistry = readFileSync("src/service/capabilities/connectors/core/plugin-registry.mjs", "utf8");
const tests = readFileSync("tests/behavior/marketplace-distribution-policy.test.mjs", "utf8");
const pluginVerifier = readFileSync("scripts/verify-plugin-registry.mjs", "utf8");
const pluginLifecycle = readFileSync("docs/task-runtime/PLUGIN_LIFECYCLE.md", "utf8");
const roadmap = readFileSync("docs/architecture/post-runtime-upgrade-roadmap.md", "utf8");
const manifest = readFileSync("scripts/check-manifest.mjs", "utf8");

for (const required of [
  "MARKETPLACE_SIGNATURE_STATE",
  "MARKETPLACE_ARCHIVE_STATE",
  "normalizeMarketplaceDistribution",
  "isMarketplaceEntryRunnable",
  "archiveMarketplaceInstallDirectory",
  "UNVERIFIED",
  "UNSIGNED",
  "VERIFIED",
  "ARCHIVED"
]) {
  assert.match(policy, new RegExp(required), `marketplace distribution policy missing ${required}`);
}

assert.match(trust, /normalizeMarketplaceDistribution/u,
  "trust model must use normalized distribution metadata");
assert.match(trust, /signatureState/u,
  "trust preview must expose signature state");

for (const required of [
  "normalizeMarketplaceDistribution",
  "archiveMarketplaceInstallDirectory",
  "signatureState",
  "shareable",
  "status: \"archived\""
]) {
  assert.match(pluginRegistry, new RegExp(required), `plugin registry missing ${required}`);
}

for (const required of [
  "raw signatures as unverified",
  "only clears unsigned warning for verified signatures",
  "archives are not runnable",
  "plugin uninstall archives external plugin",
  "archive helper moves a directory"
]) {
  assert.match(tests, new RegExp(required), `marketplace distribution tests missing ${required}`);
}

assert.match(pluginVerifier, /archived plugin must not remain discoverable/u,
  "plugin verifier must prove archived plugins are not discoverable");
assert.match(pluginLifecycle, /Signature and archive policy/u,
  "plugin lifecycle doc must record signature/archive policy");
assert.match(roadmap, /PM-003: Sharing, Signatures, And Archive Cleanup/u,
  "roadmap must keep PM-003 section");
assert.match(roadmap, /marketplace distribution policy/u,
  "roadmap must document PM-003 implementation");
assert.match(manifest, /node scripts\/verify-marketplace-distribution-policy\.mjs/u,
  "check manifest must include marketplace distribution verifier");

console.log("[verify-marketplace-distribution-policy] PM-003 marketplace distribution contract OK");
