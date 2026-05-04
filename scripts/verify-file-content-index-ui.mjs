#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

const consoleHtml = read("src/desktop/renderer/console.html");
const consoleJs = read("src/desktop/renderer/console.js");
const indexPanel = read("src/desktop/renderer/console-file-content-index-panel.mjs");
const overlayJs = read("src/desktop/renderer/overlay.js");
const overlayHtml = read("src/desktop/renderer/overlay.html");
const schemas = read("src/service/action_tools/schemas/index.mjs");
const tools = read("src/service/action_tools/tools/index.mjs");

for (const id of [
  "fileContentIndexPanel",
  "fileContentIndexRefreshBtn",
  "fileContentIndexCount",
  "fileContentIndexState",
  "fileContentIndexList"
]) {
  assert.match(consoleHtml, new RegExp(`id="${id}"`), `Console must expose #${id}`);
}

assert.match(consoleJs, /from "\.\/console-file-content-index-panel\.mjs"/,
  "Console must load the file-content index panel as a separate module");
assert.match(consoleJs, /createFileContentIndexPanel\s*\(/,
  "Console must initialize the file-content index panel");
assert.doesNotMatch(consoleJs, /["']\/history\/file-content/,
  "Console workspace refresh must not pull file-content index records globally");

assert.match(indexPanel, /\/history\/file-content\?limit=200/,
  "Index panel must list indexed file-content records through the admin route");
assert.match(indexPanel, /\/history\/file-content\/\$\{encodeURIComponent\(id\)\}/,
  "Index panel must delete records through the namespace-scoped admin route");
assert.match(indexPanel, /X-Lingxy-Desktop-Actor/);
assert.match(indexPanel, /desktop_console/);
assert.match(indexPanel, /confirm\(/,
  "Deleting an index record must be a user-confirmed action");
assert.match(indexPanel, /does not delete the source file/,
  "Delete confirmation must distinguish index deletion from source-file deletion");

assert.doesNotMatch(overlayJs, /\/history\/file-content/,
  "Overlay must not manage file-content index records");
assert.doesNotMatch(overlayHtml, /fileContentIndex/,
  "Overlay must not expose the Console-only file-content index panel");

assert.doesNotMatch(`${schemas}\n${tools}`, /\b(delete|remove)_file_content\b/,
  "File-content index deletion must not be exposed as an LLM action tool");

console.log("File content index UI verification passed.");
