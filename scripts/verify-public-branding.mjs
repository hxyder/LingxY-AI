#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoPath = (relativePath) => path.join(repoRoot, relativePath);
const read = (relativePath) => readFileSync(repoPath(relativePath), "utf8");

const CONTACT_EMAIL = "hxy94045@gmail.com";

const pkg = JSON.parse(read("package.json"));
assert.equal(pkg.name, "lingxy-ai-desktop", "package.json name should use the public package slug");
assert.equal(pkg.description, "LingxY AI desktop runtime for Windows.",
  "package.json description should use LingxY AI");
assert.equal(pkg.author, `LingxY AI Contributors <${CONTACT_EMAIL}>`,
  "package.json author should include the public maintainer contact email");
assert.equal(pkg.build.productName, "LingxY", "desktop productName should remain LingxY");
assert.equal(pkg.build.appId, "com.uca.desktop",
  "appId is intentionally kept as the legacy runtime identity until a signed migration exists");

const lock = JSON.parse(read("package-lock.json"));
assert.equal(lock.name, "lingxy-ai-desktop", "package-lock root name should match package.json");
assert.equal(lock.packages[""].name, "lingxy-ai-desktop",
  "package-lock package entry should match package.json");

for (const relativePath of [
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "docs/public/privacy.html",
  "docs/public/terms.html"
]) {
  const text = read(relativePath);
  assert.equal(text.includes(CONTACT_EMAIL), true, `${relativePath} must include ${CONTACT_EMAIL}`);
  assert.equal(text.includes("privacy@example.com"), false, `${relativePath} must not use privacy@example.com`);
  assert.equal(text.includes("hello@example.com"), false, `${relativePath} must not use hello@example.com`);
  assert.equal(text.includes("see git log for the current maintainer contact"), false,
    `${relativePath} must not defer public contact to git log`);
  assert.equal(text.includes("current maintainer contact"), false,
    `${relativePath} must use the explicit public contact email`);
}

const publicBrandFiles = [
  "README.md",
  "产品介绍.md",
  "docs/prd_v1.0.md",
  "docs/phase_1a_demo_script.md",
  "docs/release/README.md",
  "docs/release/external_trial_checklist.md",
  "docs/release/trial_release_notes_v0.1.0-trial.1.md",
  "docs/runtime/office_addin_sideload.md"
];

for (const relativePath of publicBrandFiles) {
  const text = read(relativePath);
  for (const forbiddenPhrase of [
    "Universal Context Agent",
    "UCA Desktop Trial",
    "UCA Trial",
    "# UCA PRD",
    "asks UCA",
    "Submit to UCA",
    "UCA entry",
    "Launch UCA",
    "Start UCA"
  ]) {
    assert.equal(text.includes(forbiddenPhrase), false,
      `${relativePath} still contains old public brand phrase: ${forbiddenPhrase}`);
  }
}

for (const [relativePath, expectedPhrase] of [
  ["README.md", "LingxY AI Desktop"],
  ["产品介绍.md", "灵犀 LingxY AI"],
  ["docs/prd_v1.0.md", "LingxY PRD v1.0"],
  ["docs/release/trial_release_notes_v0.1.0-trial.1.md", "LingxY Trial Release Notes"]
]) {
  assert.equal(read(relativePath).includes(expectedPhrase), true,
    `${relativePath} should include public brand phrase: ${expectedPhrase}`);
}

const overlay = read("src/desktop/renderer/overlay.js");
assert.equal(overlay.includes("LingxY processing"), true,
  "overlay task card title should use LingxY");
assert.equal(overlay.includes("UCA processing"), false,
  "overlay task card title should not use UCA");

for (const [relativePath, forbiddenPhrase] of [
  ["office_addin/shared/task_pane.html", "告诉 UCA"],
  ["office_addin/shared/office_bridge.js", "UCA result"],
  ["office_addin/shared/office_bridge.js", "[UCA 建议]"],
  ["office_addin/shared/index.js", "打开 UCA 主控制台"],
  ["scripts/install-explorer-entry.ps1", "用 UCA 分析"],
  ["scripts/setup-office-addins.ps1", "UCA Office setup"],
  ["scripts/start-runtime.mjs", "UCA runtime listening"],
  ["scripts/start-desktop.mjs", "UCA runtime"],
  ["src/service/executors/kimi/output-format.mjs", "UCA completed without returning content"],
  ["src/service/executors/kimi/output-format.mjs", "UCA Presentation"],
  ["src/service/executors/agentic/finalization.mjs", "[UCA]"],
  ["src/service/core/http-routes/browser-context-routes.mjs", "UCA 录音笔记"],
  ["src/desktop/tray/electron-main.mjs", "[UCA]"]
]) {
  assert.equal(read(relativePath).includes(forbiddenPhrase), false,
    `${relativePath} still contains old user-visible brand phrase: ${forbiddenPhrase}`);
}

console.log("ok verify-public-branding");
