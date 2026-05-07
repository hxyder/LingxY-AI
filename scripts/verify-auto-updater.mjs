#!/usr/bin/env node
/**
 * verify-auto-updater.mjs — P0-1 v1.0 release blocker
 *
 * Asserts the auto-update plumbing stays intact across the layers
 * codex round-1 review identified as drift-prone:
 *   - package.json: electron-updater dep + GitHub Releases publish config
 *   - src/desktop/tray/auto-updater.mjs: 4-tier strategy contract,
 *     no hardcoded default-on, autoDownload/autoInstallOnAppQuit
 *     forced false at construction
 *   - src/desktop/tray/electron-main.mjs: lazy-loaded electron-updater
 *     (so dev runs don't crash), notify routed through brand
 *     popup-card / safeNotify, IPC channels exposed for Settings UI
 *   - .github/workflows/release-artifacts.yml: canonical-repo gate
 *     on the publish job, latest.yml asset enforced (otherwise the
 *     release ships but no updater client can find it)
 *   - src/desktop/shared/manifest.mjs: IPC channel constants exist
 *     for status / setStrategy / checkNow / apply
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

// ── 1. package.json: dep + publish config ────────────────────────────
const pkg = JSON.parse(read("package.json"));
assert.ok(
  pkg.dependencies?.["electron-updater"],
  "package.json must depend on electron-updater (P0-1 release-blocker)"
);
assert.ok(
  pkg.build?.publish,
  "package.json build.publish must be configured for electron-updater (latest.yml feed)"
);
assert.equal(pkg.build.publish.provider, "github",
  "publish provider must be github (only update channel supported on this branch)");
assert.equal(pkg.build.publish.owner, "lingxy-ai",
  "publish owner must be 'lingxy-ai' — drift here breaks the update feed for already-installed clients");
assert.equal(pkg.build.publish.repo, "lingxy-desktop",
  "publish repo must be 'lingxy-desktop' — drift breaks the update feed");

// ── 2. auto-updater.mjs contract ─────────────────────────────────────
const autoUpdaterSrc = read("src/desktop/tray/auto-updater.mjs");
for (const sym of [
  "createAutoUpdater",
  "UPDATE_STRATEGIES",
  "DEFAULT_UPDATE_STRATEGY"
]) {
  assert.ok(
    autoUpdaterSrc.includes(sym),
    `auto-updater.mjs must export '${sym}'`
  );
}
assert.ok(
  /UPDATE_STRATEGIES\s*=\s*Object\.freeze\(\["off",\s*"manual",\s*"notify",\s*"auto"\]\)/.test(autoUpdaterSrc),
  "auto-updater.mjs must declare UPDATE_STRATEGIES as the frozen 4-tier list (off/manual/notify/auto)"
);
assert.ok(
  /DEFAULT_UPDATE_STRATEGY\s*=\s*"off"/.test(autoUpdaterSrc),
  "auto-updater.mjs DEFAULT_UPDATE_STRATEGY must be 'off' — first-run consent flow turns it up; default-on without explicit consent is a privacy regression"
);
assert.ok(
  /autoUpdater\.autoDownload\s*=\s*false/.test(autoUpdaterSrc)
    && /autoUpdater\.autoInstallOnAppQuit\s*=\s*false/.test(autoUpdaterSrc),
  "auto-updater.mjs must force autoDownload + autoInstallOnAppQuit to false at construction (codex round-1: silent action source)"
);
assert.ok(
  /requires `getStrategy` injection/.test(autoUpdaterSrc),
  "auto-updater.mjs must reject missing getStrategy (no hardcoded default — strategy must be explicit)"
);

// ── 3. electron-main wiring ─────────────────────────────────────────
const electronMainSrc = read("src/desktop/tray/electron-main.mjs");
assert.ok(
  /import\s*{\s*createAutoUpdater[^}]*}\s*from\s*"\.\/auto-updater\.mjs"/.test(electronMainSrc),
  "electron-main.mjs must import createAutoUpdater from ./auto-updater.mjs"
);
assert.ok(
  /await import\("electron-updater"\)/.test(electronMainSrc),
  "electron-main.mjs must lazy-load electron-updater so dev runs don't crash if the module is unavailable (codex round-1 fail-soft requirement)"
);
assert.ok(
  /createAutoUpdater\s*\(\s*\{[\s\S]*?autoUpdater[\s\S]*?getStrategy/.test(electronMainSrc),
  "electron-main.mjs must call createAutoUpdater({ autoUpdater, getStrategy, ... })"
);
// Notify must route through the brand-aware safeNotify path (popup
// card → branded notification). Codex round-1 explicitly required
// that we don't construct raw Notification here.
assert.ok(
  /notify:\s*async\s*\(\s*\{\s*kind,\s*payload\s*\}\s*\)\s*=>/.test(electronMainSrc),
  "electron-main.mjs must wire createAutoUpdater notify to a brand-aware handler (popup-card / safeNotify)"
);
assert.ok(
  /safeNotify\(/.test(electronMainSrc),
  "electron-main.mjs auto-updater notify handler should reach safeNotify"
);
// IPC handlers exist
for (const channel of [
  "shellUpdaterStatus",
  "shellUpdaterSetStrategy",
  "shellUpdaterCheckNow",
  "shellUpdaterApply"
]) {
  const re = new RegExp(`ipcMain\\.handle\\(IPC_CHANNELS\\.${channel}`);
  assert.ok(
    re.test(electronMainSrc),
    `electron-main.mjs must register ipcMain.handle(IPC_CHANNELS.${channel}, ...) so Settings UI can read/control updater state`
  );
}
// First-run consent flow exists
assert.ok(
  /consentRecordedAt/.test(electronMainSrc),
  "electron-main.mjs must implement first-run consent (config.updates.consentRecordedAt) before any network call to GitHub Releases"
);

// ── 4. shared manifest IPC channels ──────────────────────────────────
const manifestSrc = read("src/desktop/shared/manifest.mjs");
for (const channel of [
  "shellUpdaterStatus",
  "shellUpdaterSetStrategy",
  "shellUpdaterCheckNow",
  "shellUpdaterApply"
]) {
  assert.ok(
    manifestSrc.includes(channel),
    `manifest.mjs IPC_CHANNELS must define '${channel}'`
  );
}

// ── 5. release workflow gate ─────────────────────────────────────────
const releaseWf = read(".github/workflows/release-artifacts.yml");
assert.ok(
  /github\.repository\s*==\s*'lingxy-ai\/lingxy-desktop'/.test(releaseWf),
  "release-artifacts.yml publish job must gate on github.repository == 'lingxy-ai/lingxy-desktop' so forks cannot pollute the canonical update feed"
);
assert.ok(
  /latest\.yml/.test(releaseWf),
  "release-artifacts.yml must enforce dist/latest.yml — without it electron-updater clients cannot discover the release"
);

console.log("ok verify-auto-updater");
