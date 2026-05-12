import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildMarketplaceTrustPreview,
  classifyMarketplaceTrust,
  MARKETPLACE_TRUST_FLAGS
} from "../../src/service/capabilities/marketplace/trust-model.mjs";
import { createSkillRegistry } from "../../src/service/capabilities/skills/registry.mjs";
import { createMCPRegistry } from "../../src/service/capabilities/mcp/registry.mjs";
import { createPluginRegistry } from "../../src/service/capabilities/connectors/core/plugin-registry.mjs";

test("marketplace trust model classifies built-in, local, third-party, disabled, and deleted states", () => {
  const builtin = classifyMarketplaceTrust({ id: "google", source: "builtin", enabled: true }, { kind: "plugin" });
  assert.deepEqual(builtin.trustFlags, [MARKETPLACE_TRUST_FLAGS.TRUSTED]);
  assert.equal(builtin.userActionRequired, false);

  const skill = classifyMarketplaceTrust({
    id: "repo-skill",
    source: "github_install",
    localOnly: true,
    thirdParty: true
  }, { kind: "skill" });
  assert.ok(skill.trustFlags.includes(MARKETPLACE_TRUST_FLAGS.THIRD_PARTY));
  assert.ok(skill.trustFlags.includes(MARKETPLACE_TRUST_FLAGS.UNSIGNED));
  assert.ok(skill.trustFlags.includes(MARKETPLACE_TRUST_FLAGS.LOCAL_ONLY));
  assert.equal(skill.userActionRequired, true);

  const disabledDeleted = classifyMarketplaceTrust({
    id: "old-plugin",
    source: "installed",
    enabled: false,
    deletedAt: "2026-05-12T00:00:00.000Z"
  }, { kind: "plugin" });
  assert.ok(disabledDeleted.trustFlags.includes(MARKETPLACE_TRUST_FLAGS.DISABLED));
  assert.ok(disabledDeleted.trustFlags.includes(MARKETPLACE_TRUST_FLAGS.DELETED));
});

test("skill registry exposes trust preview for active and disabled skills", async () => {
  const registry = createSkillRegistry([{
    id: "external-registry",
    source: "github_install",
    async listSkills() {
      return [{ id: "summarizer", displayName: "Summarizer" }];
    }
  }]);
  const disabledKey = "external-registry:summarizer";
  const skills = await registry.listSkills({
    includeInactive: true,
    config: { ai: { skills: { disabledSkillKeys: [disabledKey] } } }
  });

  assert.equal(skills.length, 1);
  assert.equal(skills[0].active, false);
  assert.ok(skills[0].trustPreview.trust.trustFlags.includes(MARKETPLACE_TRUST_FLAGS.THIRD_PARTY));
  assert.ok(skills[0].trustPreview.trust.trustFlags.includes(MARKETPLACE_TRUST_FLAGS.DISABLED));
});

test("mcp registry wraps server statuses with trust preview", async () => {
  const registry = createMCPRegistry([{
    id: "external-mcp",
    displayName: "External MCP",
    transport: "stdio",
    source: "plugin:demo",
    async getStatus() {
      return {
        id: "external-mcp",
        displayName: "External MCP",
        transport: "stdio",
        enabled: false,
        available: false,
        source: "plugin:demo",
        detail: "disabled"
      };
    }
  }]);
  const [status] = await registry.listStatus();

  assert.equal(status.trustPreview.trust.origin, "third_party");
  assert.ok(status.trustPreview.trust.trustFlags.includes(MARKETPLACE_TRUST_FLAGS.UNSIGNED));
  assert.ok(status.trustPreview.trust.trustFlags.includes(MARKETPLACE_TRUST_FLAGS.DISABLED));
});

test("plugin registry exposes install trust preview before installation", async () => {
  const root = await mkdtempDir();
  try {
    const pluginsDir = path.join(root, "plugins");
    const sourcePath = path.join(root, "demo-plugin");
    await mkdir(sourcePath, { recursive: true });
    await writeFile(path.join(sourcePath, "plugin.json"), JSON.stringify({
      id: "demo-plugin",
      displayName: "Demo Plugin",
      version: "0.1.0",
      provider: "demo",
      contracts: ["contracts/demo.json"]
    }), "utf8");

    const runtime = { connectorCatalog: { reload() {} } };
    const registry = createPluginRegistry({ runtime, pluginsDir, builtInsDir: path.join(root, "builtins") });
    const preview = registry.previewInstall({ sourcePath });
    assert.equal(preview.plugin.id, "demo-plugin");
    assert.ok(preview.trustPreview.trust.trustFlags.includes(MARKETPLACE_TRUST_FLAGS.THIRD_PARTY));
    assert.ok(preview.trustPreview.requiredUserReview);

    const installed = await registry.install({ sourcePath });
    assert.equal(installed.trustPreview.trust.origin, "third_party");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("marketplace trust preview provides stable warning ids", () => {
  const preview = buildMarketplaceTrustPreview({
    id: "unsigned-skill",
    source: "github_install",
    thirdParty: true
  }, { kind: "skill" });
  assert.deepEqual(preview.warnings, ["skill_third_party", "skill_unsigned"]);
});

async function mkdtempDir() {
  const { mkdtemp } = await import("node:fs/promises");
  return mkdtemp(path.join(os.tmpdir(), "lingxy-marketplace-trust-"));
}
