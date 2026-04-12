import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { IPC_CHANNELS } from "../src/desktop/shared/manifest.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

async function read(relativePath) {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

const overlayHtml = await read("src/desktop/renderer/overlay.html");
assert.equal(overlayHtml.includes("bubbleArea"), true);
assert.equal(overlayHtml.includes("commandInput"), true);
assert.equal(overlayHtml.includes("sendBtn"), true);
assert.equal(overlayHtml.includes("clipboardBtn"), true);
assert.equal(overlayHtml.includes("resultToast"), true);
assert.equal(overlayHtml.includes("toastOpenBtn"), true);
// Apple-style voice card + pop bubble + paper-plane send icon
assert.equal(overlayHtml.includes("voiceCard"), true);
assert.equal(overlayHtml.includes("wave-bar"), true);
assert.equal(overlayHtml.includes("voiceTranscript"), true);
assert.equal(overlayHtml.includes("popBubble"), true);
assert.equal(overlayHtml.includes("popOpenBtn"), true);
assert.equal(overlayHtml.includes("schedulePanel"), true);
assert.equal(overlayHtml.includes("settingsBtn"), true);
assert.equal(overlayHtml.includes("data-quick-action=\"translate\""), true);
assert.equal(overlayHtml.includes("<svg"), true); // paper-plane SVG inside send button
assert.equal(overlayHtml.includes("taskListDock"), true);
assert.equal(overlayHtml.includes("taskListPanel"), true);

const overlayJs = await read("src/desktop/renderer/overlay.js");
assert.equal(overlayJs.includes("loadClipboardIntoContext"), true);
assert.equal(overlayJs.includes("refreshActiveTask"), true);
assert.equal(overlayJs.includes("showWelcome"), true);
assert.equal(overlayJs.includes("showContextReceivedBubble"), true);
assert.equal(overlayJs.includes("showToast"), true);
assert.equal(overlayJs.includes("handleUserSend"), true);
assert.equal(overlayJs.includes("createScheduleFromText"), true);
assert.equal(overlayJs.includes("showScheduleConfirmCard"), true);
assert.equal(overlayJs.includes("syncProjectStoreFromService"), true);
assert.equal(overlayJs.includes("/projects/store"), true);
assert.equal(overlayJs.includes("buildScheduleActionFromText"), true);
assert.equal(overlayJs.includes("parseScheduleTriggerFromText"), true);
assert.equal(overlayJs.includes("onWindowFocused"), true);
assert.equal(overlayJs.includes("ucaShell.notify"), true);
assert.equal(overlayJs.includes("selectedFormatInstruction"), true);
assert.equal(overlayJs.includes("UCA processing"), true);
assert.equal(overlayJs.includes("pendingCapture"), true);
assert.equal(overlayJs.includes("applyShellHandoff"), true);
assert.equal(overlayJs.includes("subscribeTaskEvents"), true);
assert.equal(overlayJs.includes("handleTaskEventFrame"), true);
assert.equal(overlayJs.includes("ensureActiveTaskEventStream"), true);
assert.equal(overlayJs.includes("childBadgeRow"), true);
assert.equal(overlayJs.includes("renderCompositeBreadcrumb"), true);
// Voice mode + pop-bubble + Apple-style auto-hide additions
assert.equal(overlayJs.includes("enterVoiceMode"), true);
assert.equal(overlayJs.includes("exitVoiceMode"), true);
assert.equal(overlayJs.includes("showPopBubble"), true);
assert.equal(overlayJs.includes("schedulePopHide"), true);
assert.equal(overlayJs.includes("popKeptOpen"), true);
assert.equal(overlayJs.includes("markUserEngaged"), true);
assert.equal(overlayJs.includes("voice-wake"), true);
// Friendly mic-permission error
assert.equal(overlayJs.includes("not-allowed"), true);
// Quick actions wired to clipboard auto-load
assert.equal(overlayJs.includes("QUICK_ACTION_PRESETS"), true);
assert.equal(overlayJs.includes("runQuickAction"), true);
// UCA-049: provider visibility footer + downgraded warning
assert.equal(overlayJs.includes("extractTaskProviderInfo"), true);
assert.equal(overlayJs.includes("appendProviderFooterBubble"), true);
assert.equal(overlayJs.includes("formatProviderTag"), true);
assert.equal(overlayJs.includes("AI claim downgraded"), true);
// UCA-047: active window preview card + quick-action buttons
assert.equal(overlayJs.includes("showActiveWindowPreviewCard"), true);
assert.equal(overlayJs.includes("data-uca-active-window-card") || overlayJs.includes("dataset.ucaActiveWindowCard"), true);
assert.equal(overlayJs.includes("分析此页面"), true);
assert.equal(overlayJs.includes("payload.active_window"), true);
// UCA-046: inline schedule form now has category + leadTime selects
assert.equal(overlayHtml.includes("scheduleCategory"), true);
assert.equal(overlayHtml.includes("scheduleLeadTime"), true);
assert.equal(overlayJs.includes("scheduleCategorySelect"), true);
assert.equal(overlayJs.includes("scheduleLeadTimeSelect"), true);
// UCA-041: projects + multi-conversation v3 schema + project panel
assert.equal(overlayJs.includes("STORAGE_KEY_V3"), true);
assert.equal(overlayJs.includes("projectStore"), true);
assert.equal(overlayJs.includes("loadProjectStore"), true);
assert.equal(overlayJs.includes("renderConversationFromState"), true);
assert.equal(overlayJs.includes("switchConversation"), true);
assert.equal(overlayJs.includes("switchProject"), true);
assert.equal(overlayJs.includes("createProject"), true);
assert.equal(overlayJs.includes("listConversationsForCurrentProject"), true);
assert.equal(overlayJs.includes("renderProjectPanel"), true);
assert.equal(overlayHtml.includes("projectPanel"), true);
assert.equal(overlayHtml.includes("projectDropdown"), true);
assert.equal(overlayHtml.includes("historyList"), true);
assert.equal(overlayHtml.includes("projectSelectorBtn"), true);

const taskEventStream = await read("src/desktop/renderer/task-event-stream.js");
assert.equal(taskEventStream.includes("formatTaskEventSummary"), true);
assert.equal(taskEventStream.includes("applyTaskEventPatch"), true);
assert.equal(taskEventStream.includes("subscribeTaskEvents"), true);

const preload = await read("src/desktop/renderer/preload.cjs");
assert.equal(preload.includes("readClipboardText"), true);
assert.equal(preload.includes(IPC_CHANNELS.shellReady), true);
assert.equal(preload.includes(IPC_CHANNELS.shellWindowFocused), true);
assert.equal(preload.includes("submitDroppedFiles"), true);
assert.equal(preload.includes("uca:shell-submit-dropped-files"), true);
assert.equal(preload.includes("uca:shell-notify"), true);
assert.equal(preload.includes("onNotificationReceived"), true);
assert.equal(preload.includes("readTextFile"), true);
assert.equal(preload.includes("writeClipboardText"), true);

const mainProcess = await read("src/desktop/tray/electron-main.mjs");
assert.equal(mainProcess.includes("did-finish-load"), true);
assert.equal(mainProcess.includes("browserWindow.on(\"focus\""), true);
assert.equal(mainProcess.includes("webContents.send(IPC_CHANNELS.shellReady"), true);
assert.equal(mainProcess.includes("startNotificationWatcher"), true);

const scheduleParser = await read("src/desktop/renderer/schedule-parser.js");
assert.equal(scheduleParser.includes("buildScheduleActionFromText"), true);
assert.equal(scheduleParser.includes('type: "at"'), true);

const { isScheduleIntentText } = await import(pathToFileURL(path.join(repoRoot, "src/desktop/renderer/schedule-parser.js")));
assert.equal(isScheduleIntentText("总结一下今天的时政要闻"), false);
assert.equal(isScheduleIntentText("明天上午9点提醒我开会"), true);

const notificationHtml = await read("src/desktop/renderer/notification.html");
assert.equal(notificationHtml.includes("UCA Notification"), true);

const notificationJs = await read("src/desktop/renderer/notification.js");
assert.equal(notificationJs.includes("onNotificationReceived"), true);
assert.equal(notificationJs.includes("lastPayload?.navigate"), true);
assert.equal(notificationJs.includes("navigateConsole"), true);

console.log("Overlay composer verification passed.");
