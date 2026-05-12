#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CHECK_COMMANDS, FAST_CHECK_COMMANDS } from "./check-manifest.mjs";
import { createWindowSessionState } from "../src/desktop/shared/window-session-state.mjs";

const model = readFileSync("src/desktop/shared/window-session-state.mjs", "utf8");
const electronMain = readFileSync("src/desktop/tray/electron-main.mjs", "utf8");
const previewManager = readFileSync("src/desktop/shell/desktop-preview-window-manager.mjs", "utf8");
const previewIpc = readFileSync("src/desktop/main/ipc/register-preview-ipc.mjs", "utf8");
const popupManager = readFileSync("src/desktop/tray/popup-card-manager.mjs", "utf8");
const behavior = readFileSync("tests/behavior/window-session-state.test.mjs", "utf8");
const roadmap = readFileSync("docs/architecture/post-runtime-upgrade-roadmap.md", "utf8");

assert.match(model, /createWindowSessionState/u, "WindowSession state model must exist");
assert.match(model, /canAcceptTaskEvent/u, "WindowSession must expose stale-event rejection");
assert.match(model, /acceptPreviewPayload/u, "WindowSession must own preview binding checks");
assert.match(model, /registerPopup/u, "WindowSession must track popup owners");
assert.match(model, /backgroundOwners/u, "WindowSession must track background/system task ownership");
assert.match(electronMain, /createWindowSessionState/u, "Electron shell must create one WindowSession state object");
assert.match(electronMain, /windowSession\.bindWindow/u, "Electron shell must bind managed windows");
assert.match(electronMain, /previewInitChannel:\s*IPC_CHANNELS\.previewWindowInit/u, "Preview manager must receive typed preview init channel");
assert.match(previewManager, /windowSession\.acceptPreviewPayload/u, "Preview manager must reject stale preview payloads");
assert.match(previewManager, /previewInitChannel/u, "Preview manager must avoid hard-coded IPC channel ownership checks");
assert.match(previewIpc, /sendToPreview\(IPC_CHANNELS\.previewWindowDelta/u, "Preview IPC must return preview manager decisions");
assert.match(popupManager, /windowSession\?\.registerPopup/u, "Popup manager must register popup owners");
assert.match(popupManager, /windowSession\?\.unregisterPopup/u, "Popup manager must unregister popup owners");
assert.match(behavior, /rejects stale preview deltas/u, "Behavior tests must cover stale preview rejection");
assert.match(roadmap, /DX-001: WindowSession State Machine/u, "Roadmap must keep DX-001 tracking section");

const session = createWindowSessionState();
session.bindWindow("console", { taskId: "task_console", conversationId: "conv_console" });
assert.equal(session.canAcceptTaskEvent({ windowId: "console", taskId: "task_console", conversationId: "conv_console" }).allowed, true);
assert.equal(session.canAcceptTaskEvent({ windowId: "console", taskId: "task_other", conversationId: "conv_console" }).allowed, false);
session.acceptPreviewPayload({ taskId: "task_a", conversationId: "conv_a" }, { bind: true });
assert.equal(session.acceptPreviewPayload({ taskId: "task_b", conversationId: "conv_a" }).allowed, false);

const command = "node scripts/verify-window-session-state-machine.mjs";
assert.ok(CHECK_COMMANDS.includes(command), "check manifest must include WindowSession verifier");
assert.ok(FAST_CHECK_COMMANDS.includes(command), "fast check manifest must include WindowSession verifier");

console.log("[verify-window-session-state-machine] DX-001 WindowSession state contract OK");
