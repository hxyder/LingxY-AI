#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

const consoleJs = read("src/desktop/renderer/console.js");
const overlayJs = read("src/desktop/renderer/overlay.js");
const sharedChatCss = read("src/desktop/renderer/shared-chat.css");

assert.match(consoleJs, /function appendConsoleChatErrorBlock\(taskId, payload = \{\}/,
  "console chat must have an inline error block renderer");
assert.match(consoleJs, /frame\.event === "failed"[\s\S]{0,420}appendConsoleChatErrorBlock\(taskId, payload\)/,
  "console failed events must render an inline error block");
assert.match(consoleJs, /frame\.event === "cancelled"[\s\S]{0,520}appendConsoleChatErrorBlock\(taskId, payload, \{ cancelled: true \}\)/,
  "console cancelled events must render an inline cancelled block");
assert.match(consoleJs, /appendConsoleChatErrorBlock[\s\S]{0,3600}retryTaskViaShell\(key, \{ mode: "retry_same" \}\)/,
  "console inline error block must offer retry through the desktop shell bridge");
assert.ok(consoleJs.includes("recovery_hint") && consoleJs.includes("cie-recovery") && consoleJs.includes("cie-policy"),
  "console inline error block must render provider/tool recovery hints and policy chips");
assert.match(consoleJs, /runInlineErrorRetry\([\s\S]{0,1200}appendConsoleChatErrorBlock[\s\S]{0,1200}\.cie-retry[\s\S]{0,1200}已发起/,
  "console smoke hook must click the real inline retry button");
assert.doesNotMatch(consoleJs, /fetchJson\(\s*`\/task\/\$\{[^}]+\}\/retry`/,
  "console inline retry must not POST directly to /task/:id/retry");

assert.match(overlayJs, /function appendOverlayErrorBlock\(taskId, payload = \{\}/,
  "overlay must have an inline error block renderer");
assert.match(overlayJs, /frame\.event === "failed"[\s\S]{0,220}appendOverlayErrorBlock\(frameTaskId, frame\.data \?\? \{\}\)/,
  "overlay failed events must render an inline error block");
assert.match(overlayJs, /frame\.event === "cancelled"[\s\S]{0,220}appendOverlayErrorBlock\(frameTaskId, frame\.data \?\? \{\}, \{ cancelled: true \}\)/,
  "overlay cancelled events must render an inline cancelled block");
assert.match(overlayJs, /appendOverlayErrorBlock[\s\S]{0,3600}retryTaskViaShell\(key, \{ mode: "retry_same" \}\)/,
  "overlay inline error block must offer retry through the desktop shell bridge");
assert.ok(overlayJs.includes("recovery_hint") && overlayJs.includes("cie-recovery") && overlayJs.includes("cie-policy"),
  "overlay inline error block must render provider/tool recovery hints and policy chips");
assert.match(overlayJs, /runInlineErrorRetry\([\s\S]{0,1200}appendOverlayErrorBlock[\s\S]{0,1200}\.cie-retry[\s\S]{0,1200}已发起/,
  "overlay smoke hook must click the real inline retry button");

for (const selector of [
  ".chat-inline-error",
  ".cie-head",
  ".cie-body",
  ".cie-recovery",
  ".cie-policy",
  ".cie-footer"
]) {
  assert.ok(sharedChatCss.includes(selector), `shared chat CSS missing ${selector}`);
}

console.log("inline error retry contract ok");
