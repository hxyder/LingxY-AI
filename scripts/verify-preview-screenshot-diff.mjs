#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHECK_COMMANDS, FAST_CHECK_COMMANDS } from "./check-manifest.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");

const previewWindow = read("src/desktop/renderer/preview-window.js");
const guiSmokeRunner = read("src/desktop/smoke/desktop-gui-smoke-runner.mjs");
const userInteractionSmoke = read("scripts/verify-user-interaction-smoke.mjs");
const roadmap = read("docs/architecture/post-runtime-upgrade-roadmap.md");

assert.match(
  previewWindow,
  /prepareGenerateDocumentScreenshotDiff/u,
  "preview window smoke hooks must expose generate_document screenshot-diff preparation"
);
assert.match(
  previewWindow,
  /phase === "initial"[\s\S]+applyInit[\s\S]+phase[\s\S]+applyDelta/u,
  "preview screenshot-diff hook must compare initial draft against an incremental update"
);
assert.match(
  guiSmokeRunner,
  /webContents\.capturePage\(previewCaptureRect\)/u,
  "desktop GUI smoke must capture preview-window screenshots"
);
assert.match(
  guiSmokeRunner,
  /captureImageStats/u,
  "desktop GUI smoke must reject blank preview screenshots"
);
assert.match(
  guiSmokeRunner,
  /compareImageStats/u,
  "desktop GUI smoke must compare preview screenshots"
);
assert.match(
  guiSmokeRunner,
  /preview_generate_document_screenshot_diff/u,
  "desktop GUI smoke must report the preview screenshot-diff check"
);
assert.match(
  userInteractionSmoke,
  /preview_generate_document_screenshot_diff/u,
  "user interaction smoke verifier must require the preview screenshot-diff check"
);
assert.match(
  roadmap,
  /preview screenshot-diff/u,
  "post-runtime roadmap must track preview screenshot-diff completion"
);

const command = "node scripts/verify-preview-screenshot-diff.mjs";
assert.ok(CHECK_COMMANDS.includes(command), "check manifest must include preview screenshot-diff verifier");
assert.ok(FAST_CHECK_COMMANDS.includes(command), "fast check manifest must include preview screenshot-diff verifier");

console.log("[verify-preview-screenshot-diff] preview screenshot-diff contract OK");
