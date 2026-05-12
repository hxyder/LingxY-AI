#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHECK_COMMANDS, FAST_CHECK_COMMANDS } from "./check-manifest.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

const html = read("src/desktop/renderer/console.html");
const consoleJs = read("src/desktop/renderer/console.js");
const connectorRoutes = read("src/service/core/http-routes/connector-routes.mjs");
const roadmap = read("docs/architecture/post-runtime-maturity-roadmap.md");

for (const required of [
  "marketplaceManagementPanel",
  "marketplaceCapabilityCount",
  "marketplaceRefreshBtn",
  "marketplaceState",
  "marketplaceCapabilityList"
]) {
  assert.ok(html.includes(required), `console HTML missing marketplace management surface: ${required}`);
}

for (const required of [
  "marketplaceCapabilityCount",
  "marketplaceRefreshBtn",
  "marketplaceState",
  "marketplaceCapabilityList"
]) {
  assert.ok(consoleJs.includes(required), `console JS missing marketplace management wiring: ${required}`);
}

for (const required of [
  "function marketplaceTrustFields",
  "function renderMarketplaceManagement",
  "trustPreview",
  "signatureState",
  "archiveState",
  "governance",
  "fetchJsonWithFallback(\"/plugins\"",
  "data-marketplace-plugin-toggle",
  "data-marketplace-plugin-archive",
  "setMarketplacePluginEnabled",
  "archiveMarketplacePlugin"
]) {
  assert.ok(consoleJs.includes(required), `console marketplace UI missing contract text: ${required}`);
}

for (const required of [
  "method === \"GET\" && url.pathname === \"/plugins\"",
  "method === \"DELETE\" && /^\\/plugins\\/[^/]+$/.test(url.pathname)",
  "method === \"PATCH\" && /^\\/plugins\\/[^/]+\\/enabled$/.test(url.pathname)"
]) {
  assert.ok(connectorRoutes.includes(required), `plugin route missing required management contract: ${required}`);
}

assert.ok(roadmap.includes("PM-004 Marketplace management UI | complete"), "roadmap must mark PM-004 complete");
assert.ok(roadmap.includes("node scripts/verify-marketplace-management-ui.mjs"), "roadmap must list PM-004 UI verifier");

const command = "node scripts/verify-marketplace-management-ui.mjs";
assert.ok(CHECK_COMMANDS.includes(command), "check manifest must include marketplace management UI verifier");
assert.ok(FAST_CHECK_COMMANDS.includes(command), "fast check manifest must include marketplace management UI verifier");

console.log("[marketplace-management-ui] marketplace management UI contract verified");
