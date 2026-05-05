#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");
const exists = (relativePath) => existsSync(path.join(repoRoot, relativePath));

const checklistPath = "docs/release/user_interaction_smoke_checklist.md";
assert.equal(exists(checklistPath), true, "missing user interaction smoke checklist");

const checklist = read(checklistPath);
const functionalMatrix = read("docs/release/functional_acceptance_matrix.md");
const releaseReadiness = read("scripts/verify-release-readiness.mjs");
const releaseConfig = read("tools/release/release-config.json");
const pkg = JSON.parse(read("package.json"));

for (const section of [
  "Desktop Surfaces",
  "Voice and Audio",
  "Browser Extension",
  "Office, Files, And Automation",
  "Release Recording"
]) {
  assert.equal(checklist.includes(`## ${section}`), true,
    `user interaction checklist missing section: ${section}`);
}

for (const row of [
  "Dock",
  "Overlay chat",
  "Console chat",
  "Overlay voice input",
  "Note recording",
  "Echo mode",
  "Popup",
  "Floating chip",
  "Side panel",
  "Standalone mode",
  "Office add-ins",
  "Explorer entry",
  "Scheduler",
  "Side-effect approval"
]) {
  assert.equal(checklist.includes(`| ${row} |`), true,
    `user interaction checklist missing row: ${row}`);
}

for (const phrase of [
  "if a control is visible in a public build",
  "Standalone mode only promises browser-context LLM help",
  "files are not opened just because they were attached",
  "copy every partial/fail into `docs/release/known_issues.md`"
]) {
  assert.equal(checklist.toLowerCase().includes(phrase.toLowerCase()), true,
    `user interaction checklist missing discipline phrase: ${phrase}`);
}

assert.equal(functionalMatrix.includes("user_interaction_smoke_checklist.md"), true,
  "functional acceptance matrix must reference the user interaction checklist");
assert.equal(releaseReadiness.includes(checklistPath), true,
  "release readiness verifier must require the user interaction checklist");
assert.equal(releaseConfig.includes(checklistPath), true,
  "trial bundle must include the user interaction checklist");

assert.equal(typeof pkg.scripts["verify:user-interaction-smoke"], "string",
  "package.json missing verify:user-interaction-smoke script");
const smokeScript = pkg.scripts["verify:user-interaction-smoke"].match(/node\s+(scripts\/[^ ]+\.mjs)/u)?.[1];
assert.ok(smokeScript, "verify:user-interaction-smoke must be a node verifier");
assert.equal((pkg.scripts.check ?? "").includes(smokeScript), true,
  "npm run check must include user interaction smoke verifier");

const popupHtml = read("browser_ext/popup/index.html");
const popupJs = read("browser_ext/popup/index.js");
const sidepanelHtml = read("browser_ext/sidepanel/index.html");
const sidepanelJs = read("browser_ext/sidepanel/index.js");
const runModeViewJs = read("browser_ext/shared/run-mode-view.js");

assert.equal(popupHtml.includes('id="mode-detail"'), true,
  "browser popup must expose a run-mode detail line");
assert.equal(sidepanelHtml.includes('id="sp-mode-detail"'), true,
  "browser side panel must expose a run-mode detail line");
assert.equal(popupJs.includes("../shared/run-mode-view.js"), true,
  "browser popup must use the shared run-mode view");
assert.equal(sidepanelJs.includes("../shared/run-mode-view.js"), true,
  "browser side panel must use the shared run-mode view");
assert.equal(/独立模式[\s\S]*本地工具/.test(runModeViewJs), true,
  "browser extension UI must explain standalone mode limitations");

console.log("ok verify-user-interaction-smoke");
