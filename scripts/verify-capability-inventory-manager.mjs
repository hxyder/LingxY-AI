#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CHECK_COMMANDS, FAST_CHECK_COMMANDS } from "./check-manifest.mjs";
import {
  CAPABILITY_INVENTORY_GROUPS,
  buildCapabilityInventory
} from "../src/service/capabilities/inventory/capability-inventory.mjs";

const read = (path) => readFileSync(path, "utf8");

const moduleSource = read("src/service/capabilities/inventory/capability-inventory.mjs");
const aiRoutes = read("src/service/core/http-routes/ai-status-routes.mjs");
const serviceBootstrap = read("src/service/core/service-bootstrap.mjs");
const consoleJs = read("src/desktop/renderer/console.js");
const testSource = read("tests/behavior/capability-inventory-manager.test.mjs");
const doc = read("docs/architecture/capability-inventory-manager.md");
const roadmap = read("docs/architecture/post-runtime-product-gap-roadmap.md");
const architectureReadme = read("docs/architecture/README.md");

const requiredGroups = [
  "built_in_tools",
  "skills",
  "mcp_servers",
  "connector_plugins",
  "connector_tools",
  "providers_model_roles",
  "user_created_drafts"
];

assert.deepEqual(CAPABILITY_INVENTORY_GROUPS.map((group) => group.id), requiredGroups,
  "capability inventory group ids must stay stable");

for (const group of requiredGroups) {
  assert.match(moduleSource, new RegExp(`id: "${group}"`, "u"), `module missing ${group}`);
  assert.match(doc, new RegExp(`\\| \`${group}\` \\|`, "u"), `doc missing ${group}`);
}

assert.match(moduleSource, /buildRuntimeCapabilityInventory/u,
  "service inventory builder must expose runtime aggregation");
assert.match(moduleSource, /buildModelRoleRoutingSummary/u,
  "inventory must include model role summary");
assert.match(moduleSource, /listMcpDrafts/u,
  "inventory must include user-created MCP drafts");
assert.match(moduleSource, /runtime\.actionToolRegistry\?\.list/u,
  "inventory must use the runtime tool registry rather than duplicating tool ids");
assert.match(moduleSource, /runtime\.connectorCatalog\?\.listTools/u,
  "inventory must include connector catalog tools");

assert.match(aiRoutes, /url\.pathname === "\/capabilities\/inventory"/u,
  "AI status routes must expose the capability inventory endpoint");
assert.match(aiRoutes, /buildRuntimeCapabilityInventory\(runtime\)/u,
  "capability inventory route must call the runtime inventory builder");
assert.match(serviceBootstrap, /getCapabilityInventory: "\/capabilities\/inventory"/u,
  "service endpoint manifest must expose getCapabilityInventory");

assert.match(consoleJs, /fetchJsonWithFallback\("\/capabilities\/inventory"/u,
  "Console workspace refresh must fetch capability inventory");
assert.match(consoleJs, /state\.workspace\.capabilityInventory\?\.entries/u,
  "Console marketplace must render inventory entries when present");
assert.doesNotMatch(consoleJs, /from\s+["']\.\.\/\.\.\/service\//u,
  "renderer must not import service internals for capability inventory");

assert.match(testSource, /normalizes ownership trust policy and archive state/u,
  "behavior tests must cover typed inventory state");
assert.match(testSource, /secret-free/u,
  "behavior tests must cover secret-free inventory output");

assert.match(roadmap, /CAPM-001 Capability inventory manager \| complete/u,
  "product gap roadmap must mark CAPM-001 complete");
assert.match(roadmap, /node scripts\/verify-capability-inventory-manager\.mjs/u,
  "product gap roadmap must list capability inventory verifier");
assert.match(architectureReadme, /capability-inventory-manager\.md/u,
  "architecture README must link capability inventory manager doc");

const inventory = buildCapabilityInventory({
  actionTools: [{ id: "demo_tool", name: "Demo Tool", required_capabilities: [] }],
  providers: [{ id: "demo_provider", name: "Demo Provider", configured: true, available: true }],
  modelRoles: [{ role: "planner", status: "ready" }]
});
assert.equal(inventory.groups.length, requiredGroups.length);
assert.equal(inventory.summary.entries, 3);
assert.equal(inventory.entries.every((entry) => entry.owner && entry.trustState && entry.policyState), true);

const command = "node scripts/verify-capability-inventory-manager.mjs";
assert.ok(CHECK_COMMANDS.includes(command), "check manifest must include capability inventory verifier");
assert.ok(FAST_CHECK_COMMANDS.includes(command), "fast check manifest must include capability inventory verifier");

console.log("[capability-inventory-manager] CAPM-001 capability inventory manager verified");
