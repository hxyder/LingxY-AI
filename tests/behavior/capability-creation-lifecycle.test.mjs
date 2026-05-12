import test from "node:test";
import assert from "node:assert/strict";

import {
  CAPABILITY_CREATION_FAMILIES,
  CAPABILITY_CREATION_STAGES,
  buildCapabilityCreationLifecycleCatalog,
  previewGitHubSkillInstall
} from "../../src/service/capabilities/lifecycle/capability-creation-lifecycle.mjs";

test("capability creation lifecycle declares complete stages for managed families", () => {
  assert.deepEqual(CAPABILITY_CREATION_STAGES, [
    "template",
    "dry_run_validation",
    "install_preview",
    "user_approval",
    "activation",
    "archive_recovery"
  ]);
  assert.deepEqual(CAPABILITY_CREATION_FAMILIES.map((family) => family.id), [
    "skill",
    "mcp_server",
    "connector_plugin"
  ]);

  const catalog = buildCapabilityCreationLifecycleCatalog();
  assert.equal(catalog.families.every((family) => family.requiresPreviewBeforeInstall), true);
  assert.equal(catalog.families.every((family) => family.requiresExplicitActivation), true);
  assert.equal(catalog.families.every((family) => family.archiveRecoverable), true);
});

test("GitHub skill preview validates source without cloning or leaking secrets", () => {
  const preview = previewGitHubSkillInstall({
    url: "https://github.com/acme/skills/tree/main/research"
  });

  assert.equal(preview.ok, true);
  assert.equal(preview.family, "skill");
  assert.equal(preview.stage, "install_preview");
  assert.equal(preview.source.sourceRef, "github:acme/skills#main/research");
  assert.equal(preview.policyImpact.executesCode, false);
  assert.equal(preview.policyImpact.requiresUserApproval, true);
  assert.equal(preview.trustPreview.origin, "third_party");
  assert.doesNotMatch(JSON.stringify(preview), /apiKey|token|secret/u);
});

test("GitHub skill preview rejects unsafe source shapes", () => {
  const preview = previewGitHubSkillInstall({
    url: "https://github.com/acme/skills/tree/main/../bad"
  });

  assert.equal(preview.ok, false);
  assert.equal(preview.errors.some((error) => ["url", "subPath"].includes(error.field)), true);
});
