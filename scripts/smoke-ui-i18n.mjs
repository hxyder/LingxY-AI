#!/usr/bin/env node
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const rendererDir = path.join(root, "src", "desktop", "renderer");

function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

const htmlFiles = readdirSync(rendererDir)
  .filter((name) => name.endsWith(".html"))
  .map((name) => path.join("src", "desktop", "renderer", name));

assert.ok(htmlFiles.length >= 5, "renderer HTML inventory looks unexpectedly small");

for (const rel of htmlFiles) {
  const text = read(rel);
  assert.match(text, /<html[^>]*lang="en-US"/, `${rel} should default to English for the public build`);
  assert.match(text, /i18n-dom-bootstrap\.mjs/, `${rel} should install the shared UI locale bootstrap`);
  assert.doesNotMatch(text, /lang="zh-CN"/, `${rel} should not default the whole UI to Chinese`);
}

const consoleHtml = read("src/desktop/renderer/console.html");
assert.match(consoleHtml, /id="appLanguageSelect"/, "console language selector missing");
assert.match(consoleHtml, /value="en-US">English/, "English option missing");
assert.match(consoleHtml, /value="zh-CN">中文/, "Chinese option missing");

const consoleJs = read("src/desktop/renderer/console.js");
assert.match(consoleJs, /installLingxyI18nControls/, "console should wire the language selector");
assert.match(consoleJs, /#appLanguageSelect/, "console should bind the language selector element");

const i18nDom = read("src/desktop/renderer/i18n-dom.mjs");
assert.match(i18nDom, /lingxy\.locale/, "shared locale storage key missing");
assert.match(i18nDom, /MutationObserver/, "dynamic UI mutation handling missing");
assert.match(i18nDom, /splitInlineBilingual/, "inline bilingual splitter missing");
assert.match(i18nDom, /data-i18n-en/, "explicit bilingual element support missing");
assert.match(i18nDom, /TEXT_SKIP_SELECTOR/, "user-content skip guard missing");
assert.match(i18nDom, /"en-US"/, "English locale missing");
assert.match(i18nDom, /"zh-CN"/, "Chinese locale missing");

const toolDisplay = read("src/desktop/renderer/tool-display.mjs");
assert.match(toolDisplay, /TOOL_DISPLAY_LABELS_EN/, "tool display labels need an English locale");
assert.match(toolDisplay, /currentLingxyLocale/, "tool display should follow the active UI locale");

const overlayHtml = read("src/desktop/renderer/overlay.html");
assert.match(overlayHtml, /html\[data-locale="zh-CN"\]/, "overlay CSS text should have Chinese locale variants");

console.log("ui i18n smoke ok");
