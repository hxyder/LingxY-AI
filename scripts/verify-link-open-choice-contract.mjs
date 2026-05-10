#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

const electronMain = read("src/desktop/tray/electron-main.mjs");
const linkBrowserModule = read("src/desktop/tray/desktop-link-browser-window.mjs");
const shellOpenUrlIpc = read("src/desktop/tray/ipc/register-shell-open-url-ipc.mjs");
const mainProcess = `${electronMain}\n${shellOpenUrlIpc}`;
const overlayJs = read("src/desktop/renderer/overlay.js");
const consoleJs = read("src/desktop/renderer/console.js");
const evidenceSourcesView = read("src/desktop/renderer/evidence-sources-view.mjs");

assert.match(
  mainProcess,
  /const explicitMode = payload\.ask === true\s*\?\s*"ask"[\s\S]{0,800}let mode = explicitMode\s*\?\?\s*readLinkOpenPreference\(\)/,
  "shell URL handler must honor renderer ask:true before falling back to stored linkOpenMode"
);

assert.match(
  mainProcess,
  /if \(mode === "ask" && canOpenInLingxy\)[\s\S]{0,600}buttons:\s*\["LingxY 新窗口", "系统浏览器", "取消"\][\s\S]{0,260}cancelId:\s*2/,
  "ask mode must show a cancellable LingxY/system-browser choice dialog"
);

assert.match(
  mainProcess,
  /defaultId:\s*1/,
  "link choice dialog must default to system browser rather than the in-app browser"
);

assert.match(
  linkBrowserModule,
  /function showLinkBrowserWindow\(url\)[\s\S]{0,900}frame:\s*true[\s\S]{0,400}closable:\s*true/,
  "LingxY link browser windows must keep native window controls enabled"
);

assert.match(linkBrowserModule, /function injectLinkBrowserCloseControl\(\)/,
  "LingxY link browser close-control injector must exist");
assert.match(linkBrowserModule, /lingxy-link-browser-close-host/,
  "LingxY link browser close control must have a stable host id");
assert.match(linkBrowserModule, /setAttribute\("aria-label", "关闭 LingxY 链接窗口"\)/,
  "LingxY link browser close control must be accessible");
assert.match(linkBrowserModule, /window\.location\.href = "lingxy:\/\/close-link-browser"/,
  "LingxY link browser close control must call the main-process close URL");

assert.match(
  linkBrowserModule,
  /will-navigate[\s\S]{0,500}lingxy:\/\/close-link-browser[\s\S]{0,220}closeLinkBrowserWindow\(\)/,
  "LingxY link browser close control must be handled by main-process navigation guard"
);

assert.match(
  linkBrowserModule,
  /before-input-event[\s\S]{0,220}input\.key === "Escape"[\s\S]{0,160}closeLinkBrowserWindow\(\)/,
  "LingxY link browser must support Escape as a close shortcut"
);

for (const [name, source] of [
  ["overlay chat links", overlayJs],
  ["console chat links", consoleJs],
  ["evidence source links", evidenceSourcesView]
]) {
  assert.match(
    source,
    /openUrl(?:\?\.)?\([^)]*,\s*\{\s*ask:\s*true,/,
    `${name} must request an ask-before-open URL choice`
  );
}

console.log("link open choice contract ok");
