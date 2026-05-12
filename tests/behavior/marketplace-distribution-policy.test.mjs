import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  archiveMarketplaceInstallDirectory,
  isMarketplaceEntryRunnable,
  MARKETPLACE_ARCHIVE_STATE,
  MARKETPLACE_SIGNATURE_STATE,
  normalizeMarketplaceDistribution
} from "../../src/service/capabilities/marketplace/distribution-policy.mjs";
import { buildMarketplaceTrustPreview, MARKETPLACE_TRUST_FLAGS } from "../../src/service/capabilities/marketplace/trust-model.mjs";
import { createPluginRegistry } from "../../src/service/capabilities/connectors/core/plugin-registry.mjs";

test("marketplace distribution treats raw signatures as unverified until a verifier marks them", () => {
  const unsigned = normalizeMarketplaceDistribution({ source: "installed" }, { kind: "plugin" });
  assert.equal(unsigned.signature.state, MARKETPLACE_SIGNATURE_STATE.UNSIGNED);

  const unverified = normalizeMarketplaceDistribution({
    source: "installed",
    signature: { scheme: "minisign", signer: "example", digest: "sha256:abc" }
  }, { kind: "plugin" });
  assert.equal(unverified.signature.state, MARKETPLACE_SIGNATURE_STATE.UNVERIFIED);
  assert.equal(unverified.shareable, false);

  const verified = normalizeMarketplaceDistribution({
    source: "installed",
    shareable: true,
    signature: { scheme: "minisign", signer: "example", digest: "sha256:abc", verified: true }
  }, { kind: "plugin" });
  assert.equal(verified.signature.state, MARKETPLACE_SIGNATURE_STATE.VERIFIED);
  assert.equal(verified.shareable, true);
});

test("marketplace trust preview only clears unsigned warning for verified signatures", () => {
  const rawSignature = buildMarketplaceTrustPreview({
    id: "raw-signed-plugin",
    source: "installed",
    signature: { scheme: "minisign", signer: "example" }
  }, { kind: "plugin" });
  assert.ok(rawSignature.trust.trustFlags.includes(MARKETPLACE_TRUST_FLAGS.UNSIGNED));
  assert.equal(rawSignature.distribution.signature.state, MARKETPLACE_SIGNATURE_STATE.UNVERIFIED);

  const verified = buildMarketplaceTrustPreview({
    id: "verified-plugin",
    source: "installed",
    signature: { scheme: "minisign", signer: "example", verified: true }
  }, { kind: "plugin" });
  assert.ok(!verified.trust.trustFlags.includes(MARKETPLACE_TRUST_FLAGS.UNSIGNED));
  assert.equal(verified.distribution.signature.state, MARKETPLACE_SIGNATURE_STATE.VERIFIED);
});

test("marketplace archives are not runnable", () => {
  const active = normalizeMarketplaceDistribution({ source: "installed" }, { kind: "plugin" });
  assert.equal(active.archive.state, MARKETPLACE_ARCHIVE_STATE.ACTIVE);
  assert.equal(isMarketplaceEntryRunnable({ enabled: true, distribution: active }), true);

  const archived = normalizeMarketplaceDistribution({
    source: "installed",
    archived: true,
    archivedAt: "2026-05-12T00:00:00.000Z"
  }, { kind: "plugin" });
  assert.equal(archived.archive.state, MARKETPLACE_ARCHIVE_STATE.ARCHIVED);
  assert.equal(isMarketplaceEntryRunnable({ enabled: true, distribution: archived }), false);
});

test("plugin uninstall archives external plugin without leaving it discoverable", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lingxy-marketplace-distribution-"));
  try {
    const pluginsDir = path.join(root, "plugins");
    const sourcePath = path.join(root, "demo-plugin");
    await mkdir(sourcePath, { recursive: true });
    await writeFile(path.join(sourcePath, "plugin.json"), JSON.stringify({
      id: "demo-plugin",
      displayName: "Demo Plugin",
      version: "0.1.0",
      provider: "demo",
      contracts: ["contracts/demo.json"],
      signature: { scheme: "minisign", signer: "test", verified: true },
      shareable: true
    }), "utf8");

    const runtime = { connectorCatalog: { reload() {} } };
    const registry = createPluginRegistry({ runtime, pluginsDir, builtInsDir: path.join(root, "builtins") });
    const preview = registry.previewInstall({ sourcePath });
    assert.equal(preview.distribution.signature.state, MARKETPLACE_SIGNATURE_STATE.VERIFIED);
    assert.equal(preview.distribution.shareable, true);

    const installed = await registry.install({ sourcePath });
    assert.equal(installed.distribution.signature.state, MARKETPLACE_SIGNATURE_STATE.VERIFIED);
    assert.equal(installed.trustPreview.distribution.shareable, true);

    const removed = await registry.uninstall("demo-plugin");
    assert.equal(removed.status, "archived");
    assert.equal(removed.distribution.archive.state, MARKETPLACE_ARCHIVE_STATE.ARCHIVED);
    assert.equal(existsSync(removed.archivePath), true);
    assert.equal(existsSync(path.join(pluginsDir, "demo-plugin")), false);
    assert.ok(!registry.list().some((plugin) => plugin.id === "demo-plugin"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("marketplace archive helper moves a directory into a non-active archive root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lingxy-marketplace-archive-"));
  try {
    const sourceDir = path.join(root, "source");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(path.join(sourceDir, "plugin.json"), "{}", "utf8");
    const archive = archiveMarketplaceInstallDirectory({
      sourceDir,
      archiveRoot: path.join(root, ".archive"),
      id: "demo",
      now: () => new Date("2026-05-12T00:00:00.000Z"),
      randomId: () => "abcdef123456"
    });
    assert.equal(archive.archiveState, MARKETPLACE_ARCHIVE_STATE.ARCHIVED);
    assert.equal(existsSync(sourceDir), false);
    assert.equal(existsSync(archive.archivePath), true);
    assert.ok(archive.archivePath.includes(`${path.sep}.archive${path.sep}`));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
