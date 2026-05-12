#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CHECK_COMMANDS, FAST_CHECK_COMMANDS } from "./check-manifest.mjs";
import {
  CAPABILITY_CREATION_STAGES,
  buildCapabilityCreationLifecycleCatalog,
  previewGitHubSkillInstall
} from "../src/service/capabilities/lifecycle/capability-creation-lifecycle.mjs";

const read = (path) => readFileSync(path, "utf8");

const lifecycleSource = read("src/service/capabilities/lifecycle/capability-creation-lifecycle.mjs");
const configRoutes = read("src/service/core/http-routes/config-provider-routes.mjs");
const connectorRoutes = read("src/service/core/http-routes/connector-routes.mjs");
const aiRoutes = read("src/service/core/http-routes/ai-status-routes.mjs");
const serviceBootstrap = read("src/service/core/service-bootstrap.mjs");
const skillsClient = read("src/desktop/renderer/console/console-skills-client.mjs");
const consoleJs = read("src/desktop/renderer/console.js");
const pluginRegistry = read("src/service/capabilities/connectors/core/plugin-registry.mjs");
const pluginVerifier = read("scripts/verify-plugin-registry.mjs");
const doc = read("docs/architecture/capability-creation-lifecycle.md");
const roadmap = read("docs/architecture/post-runtime-product-gap-roadmap.md");
const tests = read("tests/behavior/capability-creation-lifecycle.test.mjs");

assert.deepEqual(CAPABILITY_CREATION_STAGES, [
  "template",
  "dry_run_validation",
  "install_preview",
  "user_approval",
  "activation",
  "archive_recovery"
], "capability creation lifecycle stages must stay stable");

const catalog = buildCapabilityCreationLifecycleCatalog();
assert.equal(catalog.families.length, 3);
assert.equal(catalog.families.every((family) => family.requiresPreviewBeforeInstall), true);
assert.equal(catalog.families.every((family) => family.requiresExplicitActivation), true);

for (const required of [
  "previewGitHubSkillInstall",
  "validateGitHubSkillUrl",
  "validateSubPath",
  "buildMarketplaceTrustPreview"
]) {
  assert.match(lifecycleSource, new RegExp(required, "u"), `lifecycle module missing ${required}`);
}

assert.match(aiRoutes, /url\.pathname === "\/capabilities\/lifecycle"/u,
  "AI status routes must expose lifecycle catalog");
assert.match(serviceBootstrap, /getCapabilityLifecycle: "\/capabilities\/lifecycle"/u,
  "service endpoint manifest must expose getCapabilityLifecycle");

assert.match(configRoutes, /url\.pathname === "\/skills\/install\/github\/preview"/u,
  "skill install preview route missing");
assert.match(configRoutes, /skill_install_preview_required/u,
  "skill install route must require accepted preview");
assert.match(skillsClient, /previewInstallFromGitHub/u,
  "Console skills client must expose preview before install");
assert.match(consoleJs, /previewInstallFromGitHub\(url\)/u,
  "Console must call skill preview before GitHub install");
assert.match(consoleJs, /previewAccepted: true/u,
  "Console must mark preview acceptance when installing");

assert.match(connectorRoutes, /url\.pathname === "\/plugins\/install\/preview"/u,
  "plugin install preview route missing");
assert.match(connectorRoutes, /runtime\.pluginRegistry\.previewInstall/u,
  "plugin preview route must call plugin registry preview");
assert.match(pluginRegistry, /enabled:\s*false,\s*\n\s*installedAt/u,
  "installed connector plugins must start disabled until explicit activation");
assert.match(pluginVerifier, /installed\.enabled,\s*false/u,
  "plugin verifier must lock disabled-after-install behavior");

assert.match(doc, /CAPM-002 complete/u, "lifecycle doc must record CAPM-002 completion");
assert.match(roadmap, /CAPM-002 Capability creation lifecycle \| complete/u,
  "product gap roadmap must mark CAPM-002 complete");
assert.match(roadmap, /node scripts\/verify-capability-creation-lifecycle\.mjs/u,
  "product gap roadmap must list lifecycle verifier");
assert.match(tests, /validates source without cloning/u,
  "behavior tests must cover preview without clone");

const preview = previewGitHubSkillInstall({
  url: "https://github.com/acme/skills/tree/main/research"
});
assert.equal(preview.ok, true);
assert.equal(preview.policyImpact.requiresUserApproval, true);
assert.equal(preview.policyImpact.executesCode, false);

const command = "node scripts/verify-capability-creation-lifecycle.mjs";
assert.ok(CHECK_COMMANDS.includes(command), "check manifest must include capability creation lifecycle verifier");
assert.ok(FAST_CHECK_COMMANDS.includes(command), "fast check manifest must include capability creation lifecycle verifier");

console.log("[capability-creation-lifecycle] CAPM-002 capability creation lifecycle verified");
