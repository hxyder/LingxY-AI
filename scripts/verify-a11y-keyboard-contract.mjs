#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

const overlayHtml = read("src/desktop/renderer/overlay.html");
const overlayJs = read("src/desktop/renderer/overlay.js");
const consoleHtml = read("src/desktop/renderer/console.html");

assert.match(overlayHtml, /<div class="quick-toolbar" role="toolbar" aria-label="快捷操作">/,
  "overlay quick toolbar must expose toolbar semantics");
for (const id of [
  "newSessionBtn",
  "projectSelectorBtn",
  "scheduleToggleBtn",
  "voiceToggleBtn",
  "settingsBtn"
]) {
  assert.match(overlayHtml, new RegExp(`<button[^>]+id="${id}"[^>]+aria-label="[^"]+"`, "u"),
    `overlay #${id} must have an accessible name`);
}
for (const action of ["translate", "summarize", "explain"]) {
  assert.match(overlayHtml, new RegExp(`<button[^>]+data-quick-action="${action}"[^>]+aria-label="[^"]+"`, "u"),
    `overlay quick action ${action} must have an accessible name`);
}

for (const [id, label] of [
  ["projectPanel", "对话与历史"],
  ["schedulePanel", "新建定时任务"],
  ["voiceCard", "录音笔记与语音输入"],
  ["taskListPanel", "任务清单"]
]) {
  assert.match(overlayHtml, new RegExp(`id="${id}"[^>]+role="dialog"[^>]+aria-label="${label}"`, "u"),
    `overlay #${id} must be a labelled dialog surface`);
}

for (const id of ["projectDropdown", "scheduleWhen", "scheduleName", "scheduleCommand", "scheduleCategory", "scheduleLeadTime", "voiceLang", "noteLang"]) {
  assert.match(overlayHtml, new RegExp(`id="${id}"[^>]+aria-label="[^"]+"`, "u"),
    `overlay #${id} must have an accessible name`);
}

assert.match(overlayHtml, /id="voiceMinimizeBtn"[^>]+aria-label="最小化录音面板"/,
  "voice minimize button must have an accessible name");
assert.match(overlayHtml, /id="voiceStatus"[^>]+role="status"[^>]+aria-live="polite"/,
  "voice status must be announced politely");
assert.match(overlayHtml, /id="voiceTranscript"[^>]+role="status"[^>]+aria-live="polite"[^>]+aria-label="实时语音识别文本"/,
  "voice transcript must be an announced status region");
assert.match(overlayHtml, /id="noteTranscriptBox"[^>]+role="log"[^>]+aria-live="polite"[^>]+aria-label="录音笔记实时转录"/,
  "note transcript must be a live log region");

assert.match(overlayHtml, /task-list-filters" role="tablist" aria-label="任务过滤"/,
  "task-list filters must expose tablist semantics");
assert.match(overlayJs, /function activateTaskListFilter\(btn\)[\s\S]{0,420}aria-selected[\s\S]{0,120}tabIndex/s,
  "task-list filter activation must keep aria-selected and roving tabIndex in sync");
assert.match(overlayJs, /function handleTaskListFilterKeydown\(event\)[\s\S]{0,180}ArrowLeft[\s\S]{0,80}ArrowRight[\s\S]{0,80}Home[\s\S]{0,80}End/s,
  "task-list filter tabs must support arrow/Home/End keyboard navigation");
assert.match(overlayJs, /taskListPanel\?\.addEventListener\("keydown"[\s\S]{0,120}event\.key === "Escape"[\s\S]{0,120}closeTaskListPanel\(\)/s,
  "task-list panel must close with Escape and restore dock focus");

assert.match(consoleHtml, /<button[^>]+role="tab"[^>]+aria-selected="true"/,
  "console rail must continue exposing selected tab semantics");

console.log("a11y keyboard contract ok");
