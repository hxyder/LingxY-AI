#!/usr/bin/env node
/**
 * verify-ui-extras.mjs — defensive coverage for the cluster of UX
 * additions made during the post-Batch-6 rounds. These features were
 * added without dedicated verify scripts and are easy to silent-break
 * during a subsequent refactor (the original Codex incident showed
 * exactly that pattern with verify-palette / verify-tasks-page).
 *
 * Each assertion checks the minimum DOM / JS / CSS contract — file
 * paths can move and identifiers can be renamed without fanfare, but
 * the surface the user touches must keep working. Failures here mean
 * "you removed something the user was relying on; double-check before
 * shipping".
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readCssWithImports } from "./lib/css-imports.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");
const readDesktopTrayIpcModules = () => readdirSync(path.join(root, "src/desktop/main/ipc"), { withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.mjs$/u.test(entry.name))
  .map((entry) => readFileSync(path.join(root, "src/desktop/main/ipc", entry.name), "utf8"));

const consoleHtml = read("src/desktop/renderer/console.html");
const consoleJs = read("src/desktop/renderer/console.js");
const conversationCache = read("src/desktop/renderer/conversation-cache.mjs");
const consoleFloatingUi = read("src/desktop/renderer/console-floating-ui.mjs");
const consoleChatAttachments = read("src/desktop/renderer/console-chat-attachments.mjs");
const consoleMcpView = read("src/desktop/renderer/console-mcp-view.mjs");
const consolePreload = read("src/desktop/renderer/preload.cjs");
const runtimeTaskClient = read("src/desktop/renderer/shared/runtime-task-client.mjs");
const consoleConnectorsClient = read("src/desktop/renderer/console/console-connectors-client.mjs");
const consoleNotesRuntimeClient = read("src/desktop/renderer/console/console-notes-runtime-client.mjs");
const consoleSkillsClient = read("src/desktop/renderer/console/console-skills-client.mjs");
const echoRuntimeClient = read("src/desktop/renderer/shared/echo-runtime-client.mjs");
const runtimePreflightClient = read("src/desktop/renderer/shared/runtime-preflight-client.mjs");
const consoleChatSidebar = read("src/desktop/renderer/console-chat-sidebar.mjs");
const consoleProjectsView = read("src/desktop/renderer/console-projects-view.mjs");
const capabilityChecklist = read("src/desktop/renderer/capability-checklist.mjs");
const evidenceSourcesView = read("src/desktop/renderer/evidence-sources-view.mjs");
const toolDisplayView = read("src/desktop/renderer/tool-display.mjs");
const currentContextIntent = read("src/shared/current-context-intent.mjs");
const dockHtml = read("src/desktop/renderer/dock.html");
const dockJs = read("src/desktop/renderer/dock.js");
const dockShellClient = read("src/desktop/renderer/dock-shell-client.mjs");
const dockGeometry = read("src/desktop/tray/dock-geometry.mjs");
const electronMain = read("src/desktop/tray/electron-main.mjs");
const desktopDiagnostics = read("src/desktop/tray/desktop-diagnostics.mjs");
const desktopSettings = read("src/desktop/tray/desktop-settings.mjs");
const desktopWindowConfig = read("src/desktop/tray/desktop-window-config.mjs");
const desktopWindowBounds = read("src/desktop/tray/desktop-window-bounds.mjs");
const desktopWindowLifecycle = read("src/desktop/shell/desktop-window-lifecycle.mjs");
const desktopWindowActions = read("src/desktop/shell/desktop-window-actions.mjs");
const desktopOverlayPayloads = read("src/desktop/tray/desktop-overlay-payloads.mjs");
const desktopNotifications = read("src/desktop/tray/desktop-notifications.mjs");
const mainProcessIpc = [electronMain, ...readDesktopTrayIpcModules()].join("\n");
const popupCardHtml = read("src/desktop/renderer/popup-card.html");
const popupCardJs = read("src/desktop/renderer/popup-card.js");
const popupCardShellClient = read("src/desktop/renderer/popup-card-shell-client.js");
const desktopManifest = read("src/desktop/shared/manifest.mjs");
const overlayHtml = read("src/desktop/renderer/overlay.html");
const overlayJs = read("src/desktop/renderer/overlay.js");
const taskEventStream = read("src/desktop/renderer/task-event-stream.js");
const livePreview = read("src/desktop/renderer/live-preview.js");
const livePreviewShellClient = read("src/desktop/renderer/live-preview-shell-client.js");
const echoBubbleHtml = read("src/desktop/renderer/echo-bubble.html");
const echoBubbleJs = read("src/desktop/renderer/echo-bubble.js");
const echoBubbleShellClient = read("src/desktop/renderer/echo-bubble-shell-client.js");
const previewWindowHtml = read("src/desktop/renderer/preview-window.html");
const previewWindowJs = read("src/desktop/renderer/preview-window.js");
const previewShellClient = read("src/desktop/renderer/preview/shell-preview-client.js");
const previewRuntimeClient = read("src/desktop/renderer/preview/runtime-preview-client.js");
const iframeRemotePreviewHandler = read("src/desktop/renderer/preview/handlers/iframe-remote.js");
const textPreviewHandler = read("src/desktop/renderer/preview/handlers/text.js");
const csvPreviewHandler = read("src/desktop/renderer/preview/handlers/csv.js");
const imagePreviewHandler = read("src/desktop/renderer/preview/handlers/image.js");
const pdfPreviewHandler = read("src/desktop/renderer/preview/handlers/pdf.js");
const previewStreaming = read("src/desktop/renderer/preview/streaming.js");
const sharedCss = readCssWithImports(root, "src/desktop/renderer/shared.css");
const sharedUi = read("src/desktop/renderer/shared-ui.mjs");
const chatBlocks = read("src/desktop/renderer/chat-blocks.mjs");
const taskRuntime = read("src/service/core/task-runtime.mjs");
const conversationLifecycle = read("src/service/core/task-runtime/conversation-lifecycle.mjs");
const taskSubmission = read("src/service/core/task-runtime/task-submission.mjs");
const taskCancellation = read("src/service/core/task-runtime/task-cancellation.mjs");
const notesStore = read("src/service/store/notes-store.mjs");
const noteProjectConversationRoutes = read("src/service/core/http-routes/note-project-conversation-routes.mjs");
const taskRoutes = read("src/service/core/http-routes/task-routes.mjs");
const connectorRoutes = read("src/service/core/http-routes/connector-routes.mjs");

// ── Toast system ───────────────────────────────────────────────────────
assert.ok(/id="consoleToastHost"/.test(consoleHtml), "toast: #consoleToastHost missing in console.html");
assert.ok(/createConsoleToastController/.test(consoleFloatingUi) && /showToast\s*\(/.test(consoleFloatingUi),
  "toast: toast controller missing");
assert.ok(/showToast:\s*showConsoleToast/.test(consoleJs), "toast: console must bind showConsoleToast");
assert.ok(/\.toast-host\b/.test(sharedCss), "toast: .toast-host CSS missing");
assert.ok(/\.toast--err|\.toast--ok|\.toast--info/.test(sharedCss), "toast: kind variants missing");

// ── Capability checklist ──────────────────────────────────────────────
assert.ok(/buildCapabilityChecklist/.test(capabilityChecklist) && /capabilityChecklistSummary/.test(capabilityChecklist),
  "capability checklist: shared renderer helper missing");
assert.ok(/from\s+["']\.\/capability-checklist\.mjs["']/.test(consoleJs) && /buildCapabilityChecklist/.test(consoleJs),
  "capability checklist: console must render status from the shared helper");
assert.ok(/data-capability-suggestion/.test(consoleJs) && /completeOnboardingSuggestion/.test(consoleJs),
  "capability checklist: suggestion-backed actions must reuse onboarding actions");
assert.ok(/data-capability-panel/.test(consoleJs) && /data-capability-mcp/.test(consoleJs),
  "capability checklist: settings and MCP actions must be wired");
assert.ok(/\.capability-checklist-item\b/.test(sharedCss),
  "capability checklist: shared CSS missing");

// ── Right-click context menu ───────────────────────────────────────────
assert.ok(/id="chatCtxMenu"/.test(consoleHtml), "ctx-menu: #chatCtxMenu missing in console.html");
assert.ok(/id="overlayCtxMenu"/.test(overlayHtml), "ctx-menu: #overlayCtxMenu missing in overlay.html");
assert.ok(/createConsoleContextMenuController/.test(consoleFloatingUi) && /installConsoleChatContextMenu/.test(consoleFloatingUi),
  "ctx-menu: console floating UI helpers missing");
assert.ok(/openMenu:\s*openCtxMenu/.test(consoleJs) && /installConsoleChatContextMenu/.test(consoleJs),
  "ctx-menu: console must bind shared context menu controller");
assert.ok(/function openOverlayCtxMenu\s*\(|openOverlayCtxMenu\s*=/.test(overlayJs), "ctx-menu: openOverlayCtxMenu() missing");
assert.ok(/\.ctx-menu\b/.test(sharedCss) && /\.ctx-menu\b/.test(overlayHtml),
  "ctx-menu: .ctx-menu CSS missing in either console or overlay");
assert.ok(/\.bubble\.user\s+\.context-chip\s*\{[\s\S]*?color:\s*#0d0d0d/i.test(overlayHtml),
  "overlay context chips: user bubble chips must force readable dark text");
assert.ok(/body\[data-theme="dark"\]\s+\.bubble\.user\s+\.context-chip\s*\{[\s\S]*?color:\s*#0d0d0d/i.test(overlayHtml),
  "overlay context chips: dark-theme user bubble chips must not inherit white text");

// ── Image attachment thumbnails ────────────────────────────────────────
assert.ok(/from\s+["']\.\/console-chat-attachments\.mjs["']/.test(consoleJs),
  "thumbnail: console must bind shared attachment controller");
assert.ok(/loadAttachmentThumbnail/.test(consoleChatAttachments), "thumbnail: loadAttachmentThumbnail missing");
assert.ok(/ATTACH_THUMB_PLACEHOLDER/.test(consoleChatAttachments), "thumbnail: placeholder svg constant missing");
assert.ok(/\.chip-attach--image|\.chip-attach-thumb/.test(sharedCss), "thumbnail: image-chip CSS missing");

// ── New-note title prompt ──────────────────────────────────────────────
assert.ok(/ntp-new-prompt/.test(consoleJs) && /ntp-title-input/.test(consoleJs),
  "+note title: console picker missing inline title prompt");
assert.ok(/onp-new-prompt/.test(overlayJs) && /onp-title-input/.test(overlayJs),
  "+note title: overlay picker missing inline title prompt");
assert.ok(/title:\s*body\.title/.test(noteProjectConversationRoutes) || /body\.title/.test(noteProjectConversationRoutes),
  "+note title: /notes/append-chip handler must forward title");
assert.ok(/title\s*=\s*null\s*\}\s*\)/.test(notesStore) || /title\s*=\s*null/.test(notesStore),
  "+note title: notes-store appendChip must accept title arg");
assert.ok(/saveNotesViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.saveNotes/.test(consoleJs),
  "notes save: console must use desktop shell bridge");
assert.ok(/upsertNoteViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.upsertNote/.test(consoleJs),
  "notes upsert: console must use desktop shell bridge");
assert.ok(/deleteNoteViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.deleteNote/.test(consoleJs),
  "notes delete: console must use desktop shell bridge");
assert.ok(/restoreNoteViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.restoreNote/.test(consoleJs),
  "notes restore: console must use desktop shell bridge");
assert.ok(/appendNoteChipViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.appendNoteChip/.test(consoleJs),
  "notes append-chip: console must use desktop shell bridge");
assert.ok(/appendNoteChipViaShell/.test(overlayJs) && /(?:consoleShellClient|overlayShellClient)\.appendNoteChip/.test(overlayJs),
  "notes append-chip: overlay must use desktop shell bridge");
assert.ok(!/fetchJson\(\s*["'`]\/notes\/append-chip["'`]\s*,\s*\{[\s\S]{0,160}method:\s*["'`]POST/.test(consoleJs),
  "notes append-chip: console must not POST /notes/append-chip directly via fetchJson");
assert.ok(!/fetchJson\(\s*["'`]\/notes\/append-chip["'`]\s*,\s*\{[\s\S]{0,160}method:\s*["'`]POST/.test(overlayJs),
  "notes append-chip: overlay must not POST /notes/append-chip directly via fetchJson");
assert.ok(!/fetch\(\s*`\$\{runtimeBaseUrl\}\/notes(?:\/(?:upsert|delete|restore|append-chip))?`\s*,\s*\{[\s\S]{0,180}method:\s*["'`]POST/.test(consoleJs),
  "notes editor: console must not POST notes mutation routes directly via fetch");
assert.ok(/createConsoleNotesRuntimeClient/.test(consoleJs)
    && /notesRuntimeClient\.fetchNotes/.test(consoleJs)
    && /notesRuntimeClient\.completeChat/.test(consoleJs)
    && /\/notes/.test(consoleNotesRuntimeClient)
    && /\/chat\/complete/.test(consoleNotesRuntimeClient),
  "notes runtime reads: console notes runtime request construction must stay in the notes runtime client");
assert.ok(/createConsoleSkillsClient/.test(consoleJs)
    && /consoleSkillsClient\.previewInstallFromGitHub/.test(consoleJs)
    && /consoleSkillsClient\.installFromGitHub/.test(consoleJs)
    && /\/skills\/install\/github\/preview/.test(consoleSkillsClient)
    && /\/skills\/install\/github/.test(consoleSkillsClient),
  "skills install: GitHub install request construction must stay in the skills client");
assert.ok(/saveProjectStoreViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.saveProjectStore/.test(consoleJs),
  "project store: console must use desktop shell bridge for saves");
assert.ok(/saveProjectStoreViaShell/.test(overlayJs) && /(?:consoleShellClient|overlayShellClient)\.saveProjectStore/.test(overlayJs),
  "project store: overlay must use desktop shell bridge for saves");
assert.ok(/attachProjectFilesViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.attachProjectFiles/.test(consoleJs),
  "project files: console must use desktop shell bridge for attach/index");
assert.ok(/removeProjectFileIndexViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.removeProjectFileIndex/.test(consoleJs),
  "project files: console must use desktop shell bridge for index removal");
assert.ok(/projectAttachFilesBtn/.test(consoleJs) && /pickProjectFiles/.test(consoleJs),
  "project files: console must expose an explicit picker before attach/index");
assert.ok(/openFile/.test(mainProcessIpc) && /openDirectory/.test(mainProcessIpc) && /Add files or folders to this project/.test(mainProcessIpc),
  "project files: desktop picker must allow both local files and folders");
assert.ok(/<span>Files<\/span>/.test(consoleJs)
    && /Current chat/.test(consoleJs)
    && /User uploads/.test(consoleJs)
    && /Project uploads/.test(consoleJs)
    && /Project generated/.test(consoleJs)
    && /Project attachments/.test(consoleJs)
    && /currentProjectArtifacts\(project\.id\)/.test(consoleJs)
    && /currentProjectMessageFiles\(project\.id\)/.test(consoleJs)
    && /conversation-artifact--current-conversation/.test(consoleJs),
  "project files: chat Files drawer must distinguish current-chat files from all selected-project files");
assert.ok(/data-chat-project-files-add/.test(consoleJs) && /data-conversation-artifact-open/.test(consoleJs),
  "project files: chat Files drawer must add project files/folders and preview project files inline");
assert.ok(/conversation-artifact--project-file/.test(sharedCss)
    && /conversation-artifact--user-file/.test(sharedCss)
    && /conversation-artifact--current-conversation/.test(sharedCss)
    && /conversation-artifacts-manage/.test(sharedCss),
  "project files: chat context file strip must have dedicated styling");
assert.ok(!/fetchJson\(\s*["'`]\/projects\/store["'`]\s*,\s*\{[\s\S]{0,180}method:\s*["'`]POST/.test(consoleJs),
  "project store: console must not POST /projects/store directly via fetchJson");
assert.ok(!/fetchJson\(\s*["'`]\/projects\/store["'`]\s*,\s*\{[\s\S]{0,180}method:\s*["'`]POST/.test(overlayJs),
  "project store: overlay must not POST /projects/store directly via fetchJson");
assert.ok(!/fetchJson\(\s*`\/projects\/[^`]+\/files\/attach`/.test(consoleJs),
  "project files: console must not POST project file attach route directly via fetchJson");
assert.ok(!/fetchJson\(\s*`\/projects\/[^`]+\/files\/remove-index`/.test(consoleJs),
  "project files: console must not POST project file remove-index route directly via fetchJson");
assert.ok(/clearPreviewCacheViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.clearPreviewCache/.test(consoleJs),
  "preview cache clear: console must use desktop shell bridge");
assert.ok(!/fetchJson\(\s*["'`]\/preview\/cache\/clear["'`]\s*,\s*\{[\s\S]{0,120}method:\s*["'`]POST/.test(consoleJs),
  "preview cache clear: console must not POST /preview/cache/clear directly");
assert.ok(/setupOfficeAddinsViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.setupOfficeAddins/.test(consoleJs),
  "office add-in setup: console must use desktop shell bridge");
assert.ok(!/fetchJson\(\s*["'`]\/setup\/office-addins["'`]\s*,\s*\{[\s\S]{0,180}method:\s*["'`]POST/.test(consoleJs),
  "office add-in setup: console must not POST /setup/office-addins directly");
assert.ok(/detectEchoKeywordViaShell/.test(dockJs)
    && /dockShellClient\.detectEchoKeyword/.test(dockJs)
    && /detectEchoKeyword/.test(dockShellClient),
  "echo KWS: dock must use desktop shell client bridge");
assert.ok(/enrollEchoKeywordViaShell/.test(dockJs)
    && /dockShellClient\.enrollEchoKeyword/.test(dockJs)
    && /enrollEchoKeyword/.test(dockShellClient),
  "echo enrollment: dock must use desktop shell client bridge");
assert.ok(!/fetch\(\s*`\$\{serviceBaseUrl\}\/echo\/kws`\s*,\s*\{[\s\S]{0,180}method:\s*["'`]POST/.test(dockJs),
  "echo KWS: dock must not POST /echo/kws directly");
assert.ok(/createEchoRuntimeClient/.test(dockJs)
    && /createEchoRuntimeClient/.test(overlayJs)
    && /\/echo\/speak/.test(echoRuntimeClient)
    && /\/echo\/speak\/cancel/.test(echoRuntimeClient)
    && /\/echo\/kws\/status/.test(echoRuntimeClient),
  "echo runtime: overlay/dock echo request construction must stay in the echo runtime client");
assert.ok(!/const\s+seed\s*=\s*pendingCapture\?\.capture\s*\?\?\s*conversationState\?\.seedCapture/.test(overlayJs),
  "overlay send: pendingCapture must not seed conversation before context resolver runs");
assert.ok(/if\s*\(text\)\s*\{\s*ensureConversation\(null,\s*conversationState\?\.seedCommand\s*\?\?\s*text\);/.test(overlayJs),
  "overlay send: conversation should be created without pre-resolving pending context");
assert.ok(!/await\s+(?:consoleShellClient|overlayShellClient)\.notify\(\{\s*title:\s*"LingxY processing"/.test(overlayJs),
  "overlay submit: task-submitted notification must not block the SSE/first-output path");
assert.ok(/void\s+(?:consoleShellClient|overlayShellClient)\.notify\?\.\(\{\s*title:\s*"LingxY processing"/.test(overlayJs),
  "overlay submit: task-submitted notification should be fire-and-forget");
assert.ok(!/fetch\(\s*`\$\{serviceBaseUrl\}\/echo\/enroll-keyword\?/.test(dockJs),
  "echo enrollment: dock must not POST /echo/enroll-keyword directly");
assert.ok(/html\s*\{[\s\S]{0,120}position:\s*fixed;[\s\S]{0,80}inset:\s*0;[\s\S]{0,180}overflow:\s*hidden;/.test(dockHtml),
  "dock: html must be fixed and non-scrollable");
assert.ok(/body\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?inset:\s*0;[\s\S]*?overflow:\s*hidden\s*!important/.test(dockHtml),
  "dock: body must be fixed and non-scrollable");
assert.ok(/contain:\s*layout\s+paint\s+style/.test(dockHtml) && /pointer-events:\s*none/.test(dockHtml),
  "dock: HUD content must be structurally contained and canvas must not expand the hit region");
assert.ok(/function\s+setManagedWindowBounds/.test(desktopWindowBounds) && /setContentBounds/.test(desktopWindowBounds) && /getContentBounds/.test(desktopWindowBounds),
  "dock: main process must manage the fixed orb by content bounds");
assert.ok(/DOCK_SIZE_PX = 48/.test(dockGeometry)
    && /DOCK_EDGE_SNAP_PX = 16/.test(dockGeometry)
    && /normalizeDockBounds/.test(dockGeometry),
  "dock: fixed HUD geometry must live in a shared pure helper");
assert.ok(/width:\s*100vw/.test(dockHtml) && /height:\s*100vh/.test(dockHtml)
    && /setZoomFactor\?\.\(1\)/.test(desktopWindowBounds)
    && /"zoom-changed"/.test(desktopWindowLifecycle)
    && /"before-input-event"/.test(desktopWindowLifecycle),
  "dock: renderer must be viewport-sized and zoom-locked to avoid HUD scrollbars");
assert.ok(/insertCSS\(/.test(desktopWindowBounds) && /overflow:\s*hidden\s*!important/.test(desktopWindowBounds),
  "dock: main process must inject a HUD scroll lock after renderer load");
assert.ok(/resetDockScrollPosition/.test(dockJs) && /addEventListener\(["']wheel["'][\s\S]{0,160}preventDefault/.test(dockJs),
  "dock: renderer must prevent wheel/scroll drift in the tiny HUD window");
assert.ok(/addEventListener\(["']pointerdown["']/.test(dockJs)
    && /setPointerCapture/.test(dockJs)
    && /releasePointerCapture/.test(dockJs),
  "dock: drag must use pointer capture so it remains responsive when the pointer leaves the tiny HUD");
assert.ok(!/Math\.abs\(dx\)\s*>\s*3\s*\|\|\s*Math\.abs\(dy\)\s*>\s*3/.test(dockJs),
  "dock: drag movement must not require every move event to cross a per-frame threshold");
assert.ok(/thickFrame:\s*false/.test(desktopWindowConfig) && /screen\.on\(["']display-/.test(electronMain),
  "dock: Windows HUD flags and display-change repair must be present");
assert.ok(/if \(windowId === "dock"\) return true;/.test(desktopSettings)
    && /getManagedWindowBounds\(DOCK_WINDOW_ID, dockWin\)/.test(mainProcessIpc),
  "dock: always-on-top and nearby HUD anchoring must use dock invariants");
assert.ok(/(?:consoleShellClient|overlayShellClient)\.transcribeNoteAudio/.test(overlayJs),
  "note transcribe: overlay must use desktop shell bridge");
assert.ok(/(?:consoleShellClient|overlayShellClient)\.transcribeNoteAudioStreaming/.test(overlayJs),
  "note transcribe stream: overlay must use desktop shell streaming bridge");
assert.ok(!/fetch\(\s*`\$\{serviceBaseUrl\}\/note\/transcribe/.test(overlayJs),
  "note transcribe: overlay must not POST /note/transcribe directly");
assert.ok(/openOverlayVoice/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.openOverlayVoice/.test(consoleJs),
  "console voice: chat composer must use desktop shell voice bridge");
assert.ok(/openOverlayForNoteVoice/.test(consoleJs)
    && /(?:consoleShellClient|overlayShellClient)\.openOverlayVoice\(\{\s*mode:\s*"note",\s*autoStart:\s*true\s*\}\)/.test(consoleJs),
  "console notes voice: notes button must use desktop shell note bridge");
assert.ok(/function openOverlayVoice\(/.test(desktopWindowActions) && /shellOpenOverlayVoice/.test(mainProcessIpc),
  "voice bridge: desktop-window-actions must own openOverlayVoice routing");
assert.ok(/payload\.autoStart !== false/.test(overlayJs),
  "voice bridge: overlay must honor shell voice autoStart option");
assert.ok(/if \(!isEchoTask\(taskId\) && !shouldSurfaceTaskPopupCards\(\)\) return;/.test(overlayJs),
  "echo result cards: Echo tasks must surface a completion card even when overlay visibility is ambiguous");
assert.ok(/ensureStreamingAnswerPlaceholder\(\{[\s\S]{0,180}label:\s*"正在处理请求…"/.test(overlayJs)
    && /reveal:\s*!isEchoTask\(frameTaskId\)/.test(overlayJs),
  "overlay streaming: tool steps must anchor above an answer placeholder without forcing Echo tasks to open the overlay");
assert.ok(/case ["']file_read_started["']/.test(taskEventStream)
    && /case ["']file_read_progress["']/.test(taskEventStream)
    && /case ["']file_read_finished["']/.test(taskEventStream),
  "file-read tool progress events must have user-readable renderer labels");
assert.ok(/resolveCard\(["']voice_continue["']/.test(popupCardJs)
    && /action === ["']voice_continue["']/.test(overlayJs)
    && /pendingContinuationTaskId = taskId/.test(overlayJs)
    && /toggleComposerVoiceInput\(\)/.test(overlayJs),
  "echo result cards: pressing V on a result card must start a voice follow-up without opening the overlay");
assert.ok(/else if \(voiceMode \|\| voiceRecording\)[\s\S]{0,80}submitEchoVoiceCommand\(\)/.test(overlayJs),
  "echo result cards: popup-card V starts composer voice capture, so global Enter must submit even when the full voice panel is hidden");
assert.ok(/async function submitEchoVoiceCommand\(\)[\s\S]{0,2600}let deferredForMoreSpeech = false;[\s\S]{0,1800}deferredForMoreSpeech = true;[\s\S]{0,320}scheduleEchoVoiceAutoSubmit\(ECHO_COMMAND_SILENCE_MS[\s\S]{0,1800}echoVoiceAutoSubmitInFlight = false;[\s\S]{0,160}if \(deferredForMoreSpeech\) return;/.test(overlayJs),
  "echo voice state machine: when speech is still active, deferred auto-submit must keep the Echo session and timer alive");
assert.ok(/function renderActions\(buttons = \[\]\)[\s\S]{0,420}seenActions[\s\S]{0,260}actionKey[\s\S]{0,260}seenActions\.has\(dedupeKey\)[\s\S]{0,160}continue/.test(popupCardJs)
    && /seenLabels/.test(popupCardJs)
    && /seenLabels\.has\(labelKey\)/.test(popupCardJs)
    && /function openOverlayAction/.test(popupCardJs)
    && /actionKey:\s*["']open_overlay["']/.test(popupCardJs),
  "popup-card actions must dedupe by stable semantic action keys and visible labels instead of repeating open-dialog actions");
assert.ok(/popup-card-shell-client\.js/.test(popupCardHtml)
    && /window\.ucaShell/.test(popupCardShellClient)
    && /popupCardShellClient/.test(popupCardJs)
    && !/window\.ucaShell/.test(popupCardJs),
  "popup-card shell bridge calls must stay behind the popup-card shell client");
assert.ok(/from\s+["']\.\/dock-shell-client\.mjs["']/.test(dockJs)
    && /window\.ucaShell/.test(dockShellClient)
    && /dockShellClient/.test(dockJs)
    && !/window\.ucaShell/.test(dockJs),
  "dock shell bridge calls must stay behind the dock shell client");
assert.ok(/live-preview-shell-client\.js/.test(consoleHtml)
    && /live-preview-shell-client\.js/.test(overlayHtml)
    && /window\.ucaShell/.test(livePreviewShellClient)
    && /livePreviewShellClient/.test(livePreview)
    && !/window\.ucaShell/.test(livePreview),
  "live-preview shell bridge calls must stay behind the live-preview shell client");
assert.ok(/echo-bubble-shell-client\.js/.test(echoBubbleHtml)
    && /window\.ucaShell/.test(echoBubbleShellClient)
    && /echoBubbleShellClient/.test(echoBubbleJs)
    && /echoBubbleShellClient/.test(echoBubbleHtml)
    && !/window\.ucaShell/.test(echoBubbleJs)
    && !/window\.ucaShell/.test(echoBubbleHtml),
  "echo-bubble shell bridge calls must stay behind the echo-bubble shell client");
assert.ok(/<option value="zh-CN" selected>中文（普通话，保留英文词）<\/option>/.test(overlayHtml),
  "voice language: overlay voice input must default to simplified Chinese with English words preserved");
assert.ok(/if \(\s*\/\^zh\/i\.test\([\s\S]{0,120}\)\) return "zh-CN";/.test(overlayJs),
  "voice language: auto Chinese browser locale must normalize to zh-CN");
assert.ok(/from\s+["']\.\.\/\.\.\/shared\/current-context-intent\.mjs["']/.test(overlayJs)
    && /commandTargetsCurrentBrowserContext/.test(currentContextIntent)
    && /commandTargetsCurrentFileContext/.test(currentContextIntent),
  "voice/current-page: overlay and service code must share structural current context signals");
assert.ok(/command:\s*uiText\("Analyze the full current page and summarize the key points\.",\s*"分析当前页面的完整内容并总结要点"\)/.test(overlayJs)
    && /command:\s*uiText\("Translate the current page to English\.",\s*"把当前页面翻译成中文"\)/.test(overlayJs),
  "current-page quick actions: commands must preserve current-page intent instead of embedding URL text");
assert.ok(/const explicitBrowserContextRequest = commandTargetsCurrentBrowserContext\(commandText\);/.test(overlayJs)
    && /const activeBrowserCapture = explicitBrowserContextRequest[\s\S]{0,120}\? await resolveActiveWindowBrowserCapture\(\)/.test(overlayJs)
    && /explicitBrowserContextRequest && !activeBrowserCapture/.test(overlayJs),
  "current-page routing: active browser capture must be gated by explicit current-page intent");
assert.ok(/getActiveWindowContext\(\{[\s\S]{0,220}preferLastExternal:\s*false[\s\S]{0,220}current_page_submit/.test(overlayJs)
    && /EXPLICIT_BROWSER_CONTEXT_FALLBACK_MAX_AGE_MS\s*=\s*30\s*\*\s*1000/.test(overlayJs)
    && /freshPendingActiveWindowContext\(EXPLICIT_BROWSER_CONTEXT_FALLBACK_MAX_AGE_MS\)/.test(overlayJs)
    && /params\.set\("require_url_match", "1"\)/.test(overlayJs)
    && /isBrowserWindowCandidate/.test(overlayJs)
    && /isBrowserProcessName/.test(overlayJs)
    && /未读取到地址栏，将尝试匹配浏览器扩展最近捕捉的页面内容/.test(overlayJs)
    && /pendingActiveWindowContextCapturedAt/.test(overlayJs),
  "current-page routing: explicit current-page submits must refresh without stale external fallback, recover title-only browser windows, and only use a fresh pending external hint");
assert.ok(!/command:\s*`[^`]*页面[^`]*\$\{activeWindow\.url\}/.test(overlayJs),
  "current-page quick actions: URL must stay as structured context, not user command text");

// ── MCP explicit install button ────────────────────────────────────────
assert.ok(/data-mcp-install-click/.test(consoleMcpView), "mcp install: missing data-mcp-install-click button");
assert.ok(/data-mcp-install-source-click/.test(consoleMcpView),
  "mcp install: missing package-source install handoff for unavailable builtin MCP packages");
assert.ok(/installRequired/.test(consoleMcpView) && /installSource/.test(consoleMcpView),
  "mcp install: console must route package-missing MCP servers into the sandbox install flow");
assert.ok(/mcp-install-btn/.test(consoleMcpView) && /mcp-install-btn/.test(sharedCss),
  "mcp install: .mcp-install-btn class or CSS missing");
assert.ok(/id="mcpServerTestBtn"/.test(consoleHtml), "mcp preflight: test button missing");
assert.ok(/consolePreflightClient\.testMcpServerConfig/.test(consoleJs)
    && /\/config\/mcp\/test/.test(runtimePreflightClient),
  "mcp preflight: console must use runtime preflight client for /config/mcp/test");
assert.ok(/id="mcpInstallPackageDir"/.test(consoleHtml) && /id="mcpInstallPreviewBtn"/.test(consoleHtml),
  "mcp install preview: packageDir input and preview button missing");
assert.ok(/id="mcpInstallSource"/.test(consoleHtml) && /id="mcpInstallPlanBtn"/.test(consoleHtml),
  "mcp install plan: source input and plan button missing");
assert.ok(/id="mcpInstallRunBtn"/.test(consoleHtml) && /id="mcpInstallRunState"/.test(consoleHtml),
  "mcp install run: install button and state missing");
assert.ok(/consolePreflightClient\.planMcpInstall/.test(consoleJs)
    && /\/config\/mcp\/install\/plan/.test(runtimePreflightClient),
  "mcp install plan: console must use runtime preflight client for dry-run plan endpoint");
assert.ok(/applyMcpInstallPlanToForm/.test(consoleJs) && /Install is not executed here/.test(consoleJs),
  "mcp install plan: plan must populate packageDir without executing install");
assert.ok(/runMcpInstallSource/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.runMcpInstall/.test(consoleJs),
  "mcp install run: console must use desktop shell bridge");
assert.ok(!/fetchJson\(\s*["'`]\/config\/mcp\/install\/run/.test(consoleJs),
  "mcp install run: console must not call execution route directly");
assert.ok(/Installed\. Review fields before saving/.test(consoleJs),
  "mcp install run: install result must still require review before saving");
assert.ok(/previewMcpInstallCandidate/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.previewMcpInstall/.test(consoleJs),
  "mcp install preview: console must use desktop shell bridge");
assert.ok(!/fetchJson\(\s*["'`]\/config\/mcp\/install\/preview/.test(consoleJs),
  "mcp install preview: console must not call file-reading preview route directly");
assert.ok(/applyMcpInstallPreviewToForm/.test(consoleJs) && /Review fields before saving/.test(consoleJs),
  "mcp install preview: preview must fill manual form and require review before saving");
assert.ok(/saveMcpServer/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.saveMcpServer/.test(consoleJs),
  "mcp config save: console must use desktop shell bridge");
assert.ok(/deleteMcpServer/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.deleteMcpServer/.test(consoleJs),
  "mcp config delete: console must use desktop shell bridge");
assert.ok(/testMcpServer/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.testMcpServer/.test(consoleJs),
  "mcp runtime test: console must use desktop shell bridge");
assert.ok(/toggleMcpServer/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.toggleMcpServer/.test(consoleJs),
  "mcp runtime toggle: console must use desktop shell bridge");
assert.ok(/saveMcpServerConfig/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.saveMcpServerConfig/.test(consoleJs),
  "mcp runtime config: console must use desktop shell bridge");
assert.ok(/请先测试，再启用/.test(consoleJs),
  "mcp runtime config: saving config must not silently enable the server");
assert.ok(!/fetchJson\(\s*["'`]\/config\/mcp\/servers/.test(consoleJs),
  "mcp config save: console must not call /config/mcp/servers directly");
assert.ok(!/fetch\(`\$\{state\.serviceBaseUrl\}\/ai\/mcp\/\$\{encodeURIComponent\(id\)\}\/(?:toggle|config)/.test(consoleJs),
  "mcp runtime mutation: console must not call /ai/mcp/:id/toggle or /config directly");
assert.ok(/approveApproval/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.approveApproval/.test(consoleJs),
  "approval approve: console must use desktop shell bridge");
assert.ok(/rejectApproval/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.rejectApproval/.test(consoleJs),
  "approval reject: console must use desktop shell bridge");
assert.ok(/approveApproval/.test(overlayJs) && /(?:consoleShellClient|overlayShellClient)\.approveApproval/.test(overlayJs),
  "approval approve: overlay must use desktop shell bridge");
assert.ok(/rejectApproval/.test(overlayJs) && /(?:consoleShellClient|overlayShellClient)\.rejectApproval/.test(overlayJs),
  "approval reject: overlay must use desktop shell bridge");
assert.ok(!/fetchJson\(`?\/approvals\/\$\{encodeURIComponent\([^)]*\)\}\/(?:approve|reject)/.test(consoleJs),
  "approval mutation: console must not call approval mutation routes directly");
assert.ok(!/fetchJson\(`?\/approvals\/\$\{encodeURIComponent\([^)]*\)\}\/(?:approve|reject)/.test(overlayJs),
  "approval mutation: overlay must not call approval mutation routes directly");
{
  const approvalBlock = overlayJs.match(/approveBtn\.addEventListener\("click", async \(\) => \{[\s\S]{0,2600}?\} catch \(error\)/)?.[0] ?? "";
  assert.ok(/activeTaskId = resumeTaskId/.test(approvalBlock) && /await refreshActiveTask\(\)/.test(approvalBlock),
    "approval resume: overlay must poll the resumed task after approve so terminal status clears the processing placeholder even if SSE raced ahead");
}
assert.ok(/id="skillEditValidation"/.test(consoleHtml),
  "skills: edit modal must expose validation feedback");
assert.ok(/data-skill-reveal/.test(consoleJs) && /data-skill-open/.test(consoleJs),
  "skills: discovered skill cards must expose open and reveal actions");
assert.ok(/data-skill-delete/.test(consoleJs),
  "skills: discovered editable skill cards must expose a delete action");
assert.ok(/renderSkillValidation/.test(consoleJs) && /skill\.errors/.test(consoleJs),
  "skills: console must render descriptor validation errors");
assert.ok(/(?:consoleShellClient|overlayShellClient)\.openPath/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\?\.showItemInFolder/.test(consoleJs),
  "skills: console skill file actions must use the desktop shell bridge");
assert.ok(/renderEvidenceSourcesHtml/.test(evidenceSourcesView) && /extractEvidenceSummaryFromTaskDetail/.test(evidenceSourcesView),
  "task detail: evidence source renderer must live in the shared renderer helper");
assert.ok(/function\s+renderTaskEvidenceSummary/.test(consoleJs) && /renderEvidenceSourcesHtml/.test(consoleJs),
  "task detail: console must render structured evidence summaries through the shared renderer");
assert.ok(/data-evidence-url/.test(evidenceSourcesView) && /data-evidence-path/.test(evidenceSourcesView),
  "task detail: evidence sources must expose web open and local reveal actions");
assert.ok(/local_shallow_source_count/.test(evidenceSourcesView) && /listed only/.test(evidenceSourcesView),
  "task detail: evidence sources must distinguish shallow file enumeration from content evidence");
assert.ok(/indexed_file_source_count/.test(evidenceSourcesView) && /tag:\s*"indexed"/.test(evidenceSourcesView),
  "task detail: evidence sources must distinguish indexed file hits from fresh local reads");
assert.ok(/local_deep_text_source_count/.test(evidenceSourcesView) && /folder_recursive_text/.test(evidenceSourcesView),
  "task detail: evidence sources must surface deep local file coverage");
assert.ok(/appendConsoleChatEvidenceSources/.test(consoleJs) && /data-chat-evidence-sources/.test(consoleJs),
  "chat: console must append structured evidence summaries to assistant messages");
assert.ok(/appendConsoleChatContentEvidenceFromTask/.test(consoleJs) && /data-chat-content-evidence/.test(consoleJs)
    && /extractContentEvidenceFromTaskDetail/.test(consoleJs),
  "chat: console must append input content evidence to assistant messages");
assert.ok(/renderToolCallSourcesHtml/.test(evidenceSourcesView) && /data-tool-call-sources/.test(evidenceSourcesView),
  "chat tools: evidence source chips must be rendered by the shared evidence helper");
assert.ok(/payload\.sources/.test(consoleJs) && /renderToolCallSourcesHtml/.test(consoleJs),
  "chat tools: console tool cards must render per-tool evidence sources from event payloads");
assert.ok(/renderEvidenceSourcesHtml/.test(overlayJs) && /appendOverlayEvidenceSources/.test(overlayJs) && /evidence_summary/.test(overlayJs),
  "overlay: runtime evidence summaries must render through the shared evidence source helper");
assert.ok(/renderContentEvidenceHtml/.test(overlayJs) && /appendOverlayContentEvidence/.test(overlayJs)
    && /extractContentEvidenceFromTaskDetail/.test(overlayJs),
  "overlay: input content evidence must render through the shared evidence source helper");
assert.ok(/renderToolCallSourcesHtml/.test(overlayJs) && /frame\.data\?\.sources/.test(overlayJs),
  "overlay: tool-step bubbles must render per-call evidence sources from event payloads");
assert.ok(/formatToolDisplayName/.test(toolDisplayView) && /read_file_text/.test(toolDisplayView)
    && /from\s+["']\.\/tool-display\.mjs["']/.test(consoleJs)
    && /from\s+["']\.\/tool-display\.mjs["']/.test(overlayJs),
  "tool display: console and overlay must share user-facing tool labels");
assert.ok(/from\s+["']\.\/chat-blocks\.mjs["']/.test(consoleJs) && /from\s+["']\.\/chat-blocks\.mjs["']/.test(overlayJs),
  "chat blocks: console and overlay must share the rich block renderer");
assert.ok(/renderChatMessageBlocksHtml/.test(chatBlocks) && /md-table/.test(chatBlocks) && /md-diagram/.test(chatBlocks) && /sanitizeSvgMarkup/.test(chatBlocks),
  "chat blocks: renderer must support tables, diagram blocks, and sanitized SVG");
assert.ok(/\.md-table\b/.test(sharedCss) && /\.md-svg-figure\b/.test(sharedCss),
  "chat blocks: shared CSS must style rich table and SVG blocks");
assert.ok(/cite-chip/.test(chatBlocks) && /data-source-id/.test(chatBlocks) && /\.cite-chip\b/.test(sharedCss),
  "chat blocks: source citation ids must render as shared citation chips");
assert.ok(/revealEvidenceSource/.test(evidenceSourcesView) && /data-evidence-source-row/.test(evidenceSourcesView)
    && /data-citation-diagnostic="unresolved"/.test(evidenceSourcesView),
  "citations: evidence renderer must expose source rows and advisory unresolved-citation diagnostics");
assert.ok(/revealEvidenceSource/.test(consoleJs) && /\.cite-chip\[data-source-id\]/.test(consoleJs),
  "citations: console must reveal evidence rows when citation chips are clicked");
assert.ok(/revealEvidenceSource/.test(overlayJs) && /\.cite-chip\[data-source-id\]/.test(overlayJs),
  "citations: overlay must reveal evidence rows when citation chips are clicked");
assert.ok(/cite-source-row--flash/.test(sharedCss) && /cursor:\s*pointer/.test(sharedCss),
  "citations: citation chips and revealed source rows must have interactive styling");
assert.ok(/id="chatSidebarChatsTabBtn"/.test(consoleHtml) && /id="chatSidebarProjectsTabBtn"/.test(consoleHtml)
    && /id="chatSidebarScopeSelect"/.test(consoleHtml) && /选择项目/.test(consoleHtml)
    && /chat-sidebar-mode/.test(sharedCss) && /chat-sidebar-scope/.test(sharedCss),
  "chat projects: sidebar must expose ordinary conversations and projects as distinct tabs with a project selector");
assert.ok(/dataset\.chatSidebarMode/.test(consoleJs) && /data-chat-sidebar-mode="chats"[\s\S]{0,120}\.chat-sidebar-scope/.test(sharedCss),
  "chat projects: project selector must be structurally hidden in ordinary Chat mode");
assert.ok(/data-chat-sidebar-delete-id/.test(consoleChatSidebar) && /function\s+deleteConsoleConversation/.test(consoleJs)
    && /method:\s*["']DELETE["'][\s\S]{0,160}X-Lingxy-Desktop-Actor/.test(consoleJs),
  "chat projects: conversation rows must expose guarded soft-delete");
assert.ok(!/All conversations/.test(consoleHtml) && !/Personal chats/.test(consoleHtml) && !/data-tab="files"/.test(consoleHtml) && !/data-tab="projects"/.test(consoleHtml),
  "chat projects: UI must not expose a mixed conversation scope, top-level Files rail entry, or top-level Projects rail entry");
assert.ok(/CHAT_SIDEBAR_PROJECT_KEY/.test(consoleJs) && /CHAT_SIDEBAR_MODE_KEY/.test(consoleJs) && /let\s+chatSidebarProjectId/.test(consoleJs),
  "chat projects: console must persist chat sidebar project scope");
assert.ok(/function\s+filterConversationsByChatScope/.test(consoleJs) && /id\s*===\s*DEFAULT_PROJECT_ID/.test(consoleJs),
  "chat projects: ordinary Chat sidebar must include legacy default-project conversations while filtering out real projects");
assert.ok(/function\s+chatSidebarConversationScope/.test(consoleJs)
    && /scope:\s*scope/.test(consoleJs)
    && /params\.set\(["']scope["']/.test(conversationCache)
    && /conversationScope/.test(noteProjectConversationRoutes),
  "chat projects: ordinary Chat list/search must request a server-side ordinary scope instead of relying on client filtering");
assert.ok(/tabId\s*===\s*["']projects["'][\s\S]{0,260}switchTab\(["']chat["']\)/.test(consoleJs),
  "chat projects: external project navigation must route to Chat's project selector instead of a dashboard-like duplicate chat surface");
assert.ok(/savedView\s*===\s*["']projects["'][\s\S]{0,120}savedView\s*=\s*["']chat["']/.test(consoleJs)
    && /tabId\s*===\s*["']projects["']\s*\?\s*["']chat["']\s*:\s*tabId/.test(consoleJs),
  "chat projects: stale/special project management views must not trap normal startup navigation");
assert.ok(/function\s+getConsoleChatSubmitProjectId/.test(consoleJs) && /project_id:\s*projectId/.test(consoleJs),
  "chat projects: /task submit must carry structured project_id when scoped");
assert.ok(/getConsoleChatSubmitProjectId\(\)\s*\{[\s\S]{0,160}getChatSidebarConversationProjectId\(\)/.test(consoleJs),
  "chat projects: submissions must not leak a stale project id while the ordinary Chat tab is selected");
assert.ok(/function\s+renderConsoleChatEmptyState/.test(consoleJs) && !/consoleChatMessages\.innerHTML\s*=\s*`<div class="console-chat-empty">没有对话/.test(consoleJs),
  "chat empty: New chat must use the rich empty-state renderer instead of plain text");
assert.ok(/id="consoleChatArtifacts"/.test(consoleHtml) && /\.conversation-artifacts\b/.test(sharedCss),
  "chat artifacts: console must expose a conversation-scoped file strip");
assert.ok(/id="consoleChatFilesBtn"/.test(consoleHtml) && /aria-controls="consoleChatArtifacts"/.test(consoleHtml),
  "chat artifacts: files must be reachable from the Chat header instead of a top-level Files tab");
assert.ok(/consoleChatArtifactsExpanded/.test(consoleJs) && /data-chat-project-files-add/.test(consoleJs) && /function\s+attachFilesToProject/.test(consoleJs),
  "chat artifacts: Files button must expand a conversation/project context panel and allow project file/folder attach");
assert.ok(/currentProjectFiles\(project\.id/.test(consoleJs) && !/projectFiles\.slice\(0,\s*5\)/.test(consoleJs) && !/files\.slice\(0,\s*8\)/.test(consoleJs),
  "chat artifacts: Files drawer must render all selected project files and all fetched current-chat files without per-section UI truncation");
assert.ok(/conversationArtifactsMatch/.test(noteProjectConversationRoutes)
    && /getArtifactsForConversation/.test(noteProjectConversationRoutes)
    && /collectMessageFileEntries/.test(noteProjectConversationRoutes)
    && /user_files/.test(noteProjectConversationRoutes),
  "chat artifacts: conversation route must expose generated artifacts and user-sent files");
assert.ok(/function\s+refreshConsoleChatArtifacts/.test(consoleJs) && /\/conversation\/\$\{encodeURIComponent\(conversationId\)\}\/artifacts/.test(consoleJs),
  "chat artifacts: console must fetch the current conversation artifact index");
assert.ok(/refreshProjectWorkspace\(projectId,\s*\{\s*force:\s*true\s*\}/.test(consoleJs)
    && /renderConsoleChatArtifacts\(consoleChatArtifactItems\)/.test(consoleJs),
  "chat artifacts: project Files drawer must force-refresh and rerender selected-project files");
assert.ok(/setHtmlIfChanged\(consoleChatArtifacts/.test(consoleJs),
  "chat artifacts: renderer must avoid unnecessary innerHTML churn");
assert.ok(/appendConsoleChatTimelineNode\(node,\s*\{\s*taskId/.test(consoleJs)
    && /consoleChatAssistantWrapperForTask\(taskId\)/.test(consoleJs),
  "chat timeline: late tool cards must stay above the final assistant answer for their task");
assert.ok(/appendConsoleChatMessage\(["']user["'],\s*message\.content/.test(consoleJs)
    && /data-nav="prev"/.test(consoleJs) && /data-nav="next"/.test(consoleJs),
  "chat timeline: loaded backend user messages must reuse the user bubble renderer with previous/next navigation");
assert.ok(/workspaceTokenUsage/.test(consoleJs) && /chat-token-counter/.test(consoleJs)
    && /usage_summary:\s*taskUsageSummary\(task\)/.test(taskRoutes)
    && !/getTaskEvents\(task\.task_id\)/.test(taskRoutes),
  "token usage: chat and Settings token counters must aggregate task llm_usage summaries");
assert.ok(/data-conversation-artifact-open/.test(consoleJs) && /data-conversation-artifact-reveal/.test(consoleJs),
  "chat artifacts: file strip must expose open and reveal actions");
assert.ok(/artifactStatusInfo/.test(sharedUi) && /\.artifact-status\b/.test(sharedCss),
  "artifacts: renderer must expose metadata status badges");
assert.ok(/artifactStatusInfo\(artifact\.status\)/.test(consoleJs),
  "chat artifacts: file strip must render artifact.status metadata");
assert.ok(/function\s+currentOverlayProjectIdForSubmission/.test(overlayJs) && /function\s+attachOverlayProjectScope/.test(overlayJs),
  "overlay projects: overlay task submissions must use a shared project-scope helper");
assert.ok(/project_id:\s*projectId/.test(overlayJs) && /selectionMetadata:\s*\{[\s\S]{0,140}project_id:\s*projectId/.test(overlayJs),
  "overlay projects: task payloads must include project_id and selectionMetadata.project_id");
assert.ok(/selection_metadata:\s*\{[\s\S]{0,140}project_id:\s*projectId/.test(overlayJs),
  "overlay projects: contextPacket.selection_metadata must carry project_id");
assert.ok(/const\s+taskBody\s*=\s*attachOverlayProjectScope\(\s*(?:attachOverlaySubmissionMetadata\(\s*)?\{\s*[\s\S]{0,220}\.\.\.payload/.test(overlayJs)
    && /overlaySubmissionClient\.submitTask\(taskBody\)/.test(overlayJs),
  "overlay projects: main /task submission must wrap the runtime-client request body with project scope");
assert.ok(/const\s+clarifyPayload\s*=\s*attachOverlayProjectScope\(\{/.test(overlayJs),
  "overlay projects: /task/clarify submissions must preserve project scope");
assert.ok(/const\s+taskBody\s*=\s*attachOverlayProjectScope\(\s*(?:attachOverlaySubmissionMetadata\(payload\)|payload)\s*\)/.test(overlayJs),
  "overlay projects: note transcription task submission must preserve project scope");
assert.ok(/function\s+resolveActiveWindowFileSelection/.test(overlayJs)
    && /activeFileSelection/.test(overlayJs)
    && /contextDecision\.kind === "file_paths"/.test(overlayJs)
    && /filePaths:\s*contextDecision\.filePaths/.test(overlayJs),
  "active-window files: overlay must route explicit current-file/document commands through file submission");
assert.ok(/refreshProjectWorkspace/.test(consoleJs) && /\/projects\/\$\{encodeURIComponent\(projectId\)\}\/workspace/.test(consoleJs),
  "projects: internal project compatibility surface must read service-owned project workspace summaries");
assert.ok(/legacyProjectConversations/.test(consoleJs) && /projectStore\.conversations|store\.conversations/.test(consoleJs),
  "projects: legacy projectStore conversations must remain as fallback only");
assert.ok(/conversation\.conversation_id/.test(consoleProjectsView) && /conversation\.message_count/.test(consoleProjectsView),
  "projects: project conversation renderer must accept SQL conversation summaries");
assert.ok(/id="projectArtifactList"/.test(consoleHtml) && /id="projectArtifactCount"/.test(consoleHtml),
  "projects: internal project compatibility surface must retain the scoped files column");
assert.ok(/projectArtifactsMatch/.test(noteProjectConversationRoutes) && /listProjectArtifacts/.test(noteProjectConversationRoutes),
  "projects: project artifact route must aggregate conversation artifacts");
assert.ok(/currentProjectArtifacts/.test(consoleJs) && /projectWorkspaceDetail\?\.artifacts/.test(consoleJs),
  "projects: console must read project-scoped artifact index from ProjectWorkspace");
assert.ok(/renderProjectArtifactListHtml/.test(consoleProjectsView) && /data-project-artifact-open/.test(consoleProjectsView),
  "projects: renderer must show artifact open/reveal actions");
assert.ok(/artifactStatusInfo\(artifact\.status\)/.test(consoleProjectsView),
  "projects: scoped artifact list must render artifact.status metadata");
assert.ok(/attachedFilePaths\s*=\s*\[\]/.test(consoleProjectsView) && /Attached project file/.test(consoleProjectsView),
  "projects: Files column must show durable attached project files separately from generated artifacts");
assert.ok(/data-project-file-detach/.test(consoleProjectsView) && /removeProjectFileIndexViaShell/.test(consoleJs),
  "projects: attached project files must be removable through the guarded index-management route");
assert.ok(/data-project-file-clear-index/.test(consoleProjectsView) && /removeProjectFileIndexViaShell/.test(consoleJs),
  "projects: attached project file indexes must be clearable without detaching the file");
assert.ok(/data-project-file-reindex/.test(consoleProjectsView) && /attachProjectFilesViaShell/.test(consoleJs),
  "projects: attached project files must be reindexable through the desktop shell bridge");
assert.ok(/attachedProjectFilePaths/.test(consoleJs)
    && /projectMessageFiles/.test(consoleJs)
    && /projectArtifacts\.length\s*\+\s*projectMessageFiles\.length\s*\+\s*attachedProjectFilePaths\.length/.test(consoleJs),
  "projects: Files count must include generated files, user uploads, and durable attached project files");
assert.ok(/setHtmlIfChanged\(projectArtifactList/.test(consoleJs),
  "projects: project artifact list must avoid unnecessary innerHTML churn");
assert.ok(/updateSecurityState/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.updateSecurityState/.test(consoleJs),
  "security settings: console must use desktop shell bridge");
assert.ok(/updateBudget/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.updateBudget/.test(consoleJs),
  "budget settings: console must use desktop shell bridge");
assert.ok(!/fetchJson\(\s*["'`]\/security\/state["'`]\s*,\s*\{\s*method:\s*["'`]POST/.test(consoleJs),
  "security settings: console must not POST /security/state directly");
assert.ok(!/fetchJson\(\s*["'`]\/budget["'`]\s*,\s*\{\s*method:\s*["'`]POST/.test(consoleJs),
  "budget settings: console must not POST /budget directly");
assert.ok(/id="dataExportPanel"/.test(consoleHtml) && /id="exportBundleBtn"/.test(consoleHtml),
  "data export: settings panel and export button missing");
assert.ok(/id="diagnosticBundleBtn"/.test(consoleHtml),
  "diagnostics: diagnostic bundle button missing");
assert.ok(/exportBundleViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.exportBundle/.test(consoleJs),
  "data export: console must use desktop shell bridge");
assert.ok(/diagnosticBundleViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.diagnosticBundle/.test(consoleJs),
  "diagnostics: console must use desktop shell bridge");
assert.ok(/id="trashList"/.test(consoleHtml) && /id="trashRefreshBtn"/.test(consoleHtml),
  "trash: settings data panel must expose a Trash restore list");
assert.ok(/fetchDeletedTasks/.test(consoleJs)
    && /\/tasks\?deleted=only/.test(runtimeTaskClient)
    && /fetchJson\("\/notes\?deleted=only"\)/.test(consoleJs),
  "trash: console must read deleted tasks and notes explicitly");
assert.ok(/fetchTaskSummaries/.test(overlayJs)
    && /fetchTaskDetail/.test(overlayJs)
    && /\/tasks\/summary\?limit=/.test(runtimeTaskClient)
    && /\/task\/\$\{encodeURIComponent\(taskId\)\}/.test(runtimeTaskClient),
  "overlay tasks: task read request construction must stay in the shared runtime task client");
assert.ok(/loadConnectorsTabData/.test(consoleJs)
    && /loadInboxAccounts/.test(consoleJs)
    && /fetchInboxResource/.test(consoleJs)
    && /\/connectors\/connected-accounts/.test(consoleConnectorsClient)
    && /\/config\/email\/accounts/.test(consoleConnectorsClient)
    && /\/connectors\/accounts\/\$\{provider\}\/messages/.test(consoleConnectorsClient),
  "connectors/inbox: console must keep connector request construction in the connectors client");
assert.ok(/data-trash-restore-task/.test(consoleJs) && /restoreTaskViaShell/.test(consoleJs),
  "trash: task restore must use desktop shell bridge");
assert.ok(/data-trash-restore-note/.test(consoleJs) && /restoreNoteViaShell/.test(consoleJs),
  "trash: note restore must use desktop shell bridge");
assert.ok(/function\s+shouldRenderWorkspaceSlice/.test(consoleJs) && /workspaceRenderSignatures/.test(consoleJs),
  "console refresh: renderer must gate repeated workspace renders by data signature");
assert.ok(/async function refreshWorkspace\(options\s*=\s*\{\}\)/.test(consoleJs) && /options\.mode\s*\?\?\s*["']full["']/.test(consoleJs),
  "console refresh: refreshWorkspace must support full/background modes");
assert.ok(/refreshWorkspaceInFlight/.test(consoleJs),
  "console refresh: refreshWorkspace calls must be coalesced to avoid overlapping rerenders");
assert.ok(/fetchJsonWithFallback/.test(consoleJs) && /refresh failed/.test(consoleJs),
  "console refresh: endpoint failures must not blank the whole workspace");
assert.ok(/shouldLoadSettingsHeavyData[\s\S]{0,260}\/audit-log/.test(consoleJs),
  "console refresh: heavy audit log fetch must be gated to the settings surface");
assert.ok(/onWindowFocused[\s\S]{0,140}refreshWorkspace\(\{\s*mode:\s*["']background["']\s*\}\)/.test(consoleJs),
  "console refresh: focus refresh must be background-scoped to avoid full-tab flicker");
assert.ok(/setInterval\(\(\)\s*=>\s*void refreshWorkspace\(\{\s*mode:\s*["']background["']\s*\}\),\s*6000\)/.test(consoleJs),
  "console refresh: polling must use background mode instead of full re-render");
assert.ok(/renderWorkspaceAfterFetch\(\{\s*mode:\s*["']active["']\s*,\s*activeTabId:\s*tabId\s*\}\)/.test(consoleJs),
  "console refresh: tab switch must render the active workspace slice from cached state");
assert.ok(!/connWebhooksTitle|Coming soon[\s\S]{0,80}Webhook/.test(consoleHtml),
  "connectors: visible Webhooks placeholder must not ship without a working surface");
assert.ok(/TOOL_DISPLAY_LABELS/.test(toolDisplayView) && /formatConsoleToolDisplayName/.test(consoleJs),
  "chat tools: shared tool display helper must map raw tool ids to user-facing labels");
assert.ok(/render_svg:\s*"生成矢量图"/.test(toolDisplayView),
  "chat tools: SVG artifact tool must have a user-facing label");
assert.ok(/formatConsoleToolArgsPreview/.test(consoleJs) && /dataset\.toolId/.test(consoleJs),
  "chat tools: console must keep raw tool ids in data attributes while showing compact args");
assert.ok(/appendConsoleChatTimelineNode/.test(consoleJs) && /insertBefore\(node,\s*streamingWrapper\)/.test(consoleJs),
  "chat tools: console must keep the active streaming answer anchored after tool cards");
assert.ok(/\.chat-tool-card \.ttc-args[\s\S]{0,420}white-space:\s*nowrap/.test(sharedCss),
  "chat tools: tool cards must keep argument previews compact");
assert.ok(/collapseCompletedConsoleToolCards/.test(consoleJs) && /\.chat-tool-card\.is-collapsed\b/.test(sharedCss),
  "chat tools: completed tool cards must collapse after the final answer");
assert.ok(/function setConsoleToolCardCollapsed/.test(consoleJs)
    && /bindConsoleToolCardToggle/.test(consoleJs)
    && /setConsoleToolCardCollapsed\(card,\s*inferredState !== "err"\)/.test(consoleJs),
  "chat tools: non-error tool cards must stay compact and expandable");
assert.ok(/\.chat-tool-card:focus-visible/.test(sharedCss),
  "chat tools: collapsed tool cards must remain keyboard-expandable");
assert.ok(/function activateConsoleConversationShell/.test(consoleJs)
    && /activateConsoleConversationShell\(conversationId,\s*summary\)/.test(consoleJs)
    && /pendingNodes/.test(consoleJs),
  "chat history: selecting a conversation must activate the shell immediately and preserve optimistic messages during background detail load");
assert.ok(/function settleConsoleChatThinkingCard/.test(consoleJs)
    && /frame\.event === "text_delta"[\s\S]{0,120}settleConsoleChatThinkingCard\(\)/.test(consoleJs)
    && /frame\.event === "final_composer_started"[\s\S]{0,160}settleConsoleChatThinkingCard\(\)/.test(consoleJs),
  "chat reasoning: thinking cards must collapse as soon as answer composition/text streaming starts");
assert.ok(/isInternalToolInvocationText/.test(taskEventStream)
    && /looksLikeInternalToolInvocationText/.test(taskEventStream)
    && /TOOL_DISPLAY_LABELS/.test(taskEventStream),
  "chat tools: visible assistant text must gate serialized tool invocations through the shared tool registry");
assert.ok(/sanitizeAssistantVisibleText/.test(consoleJs) && /looksLikeInternalAssistantText/.test(consoleJs),
  "chat tools: console must not render serialized tool invocations as assistant prose");
assert.ok(/consoleChatSuppressedTextByTaskId/.test(consoleJs)
    && /function clearConsoleChatTerminalBuffers\(taskId\)/.test(consoleJs)
    && /clearConsoleChatTerminalBuffers[\s\S]{0,180}consoleChatSuppressedTextByTaskId\.delete\(taskId\)/.test(consoleJs)
    && /clearConsoleChatTerminalBuffers[\s\S]{0,220}pendingConsoleChatTextDeltas\.delete\(taskId\)/.test(consoleJs)
    && /frame\.event === "failed"[\s\S]{0,220}clearConsoleChatTerminalBuffers\(taskId\)/.test(consoleJs)
    && /frame\.event === "cancelled"[\s\S]{0,220}clearConsoleChatTerminalBuffers\(taskId\)/.test(consoleJs)
    && /frame\.event === "success" \|\| frame\.event === "partial_success"[\s\S]{0,360}clearConsoleChatTerminalBuffers\(taskId\)/.test(consoleJs),
  "chat tools: console must clear suppressed internal-text buffers on terminal events");
assert.ok(/sanitizeAssistantVisibleText/.test(overlayJs) && /looksLikeInternalAssistantText/.test(overlayJs),
  "chat tools: overlay must not render serialized tool invocations as assistant prose");
assert.ok(/formatToolArgsPreview/.test(overlayJs) && !/const argsText = args == null \? "" : \(typeof args === "string" \? args : JSON\.stringify\(args/.test(overlayJs),
  "chat tools: overlay tool steps must use compact argument previews instead of dumping JSON");
assert.ok(!/body:\s*payload\.message\s*\?\?\s*JSON\.stringify\(payload\)/.test(taskEventStream),
  "task events: generic summaries must not expose raw payload JSON to users");
assert.ok(/rememberEchoTask/.test(overlayJs) && /showEchoResultHudOnce/.test(overlayJs),
  "echo mode: echo-submitted task results must surface through the Echo HUD");
assert.ok(/isEchoOriginEventFrame/.test(overlayJs) && /voice_session_id/.test(overlayJs),
  "echo mode: any task event carrying Echo origin metadata must keep the result HUD eligible");
assert.ok(/frame\.event === "success"[\s\S]{0,420}showEchoResultHudOnce/.test(overlayJs),
  "echo mode: terminal success events without inline_result must still surface through the Echo HUD");
assert.ok(!/addBubble\("assistant", `Artifact created:/.test(overlayJs),
  "overlay chat surface must not expose internal artifact_created event labels as assistant text");
assert.ok(/captureActiveWindowHintForVoice/.test(overlayJs) && /voice_wake/.test(overlayJs) && /echo_voice_wake/.test(overlayJs),
  "voice mode: voice and Echo sessions must capture active browser context before page-analysis commands");
assert.ok(/commandInput\.addEventListener\("keydown"[\s\S]{0,180}e\.stopPropagation\(\)[\s\S]{0,180}voiceMode && !noteActive[\s\S]{0,120}closeVoicePanel\(\{ submit: true \}\)/.test(overlayJs),
  "voice mode: Enter in the composer must route through the voice submit controller and not bubble into a second submit");
assert.ok(/captureActiveWindowHintForVoice[\s\S]{0,760}includeSelection:\s*true/.test(overlayJs)
    && /captureActiveWindowHintForVoice[\s\S]{0,820}allowClipboardFallback:\s*false/.test(overlayJs)
    && /captureActiveWindowHintForVoice[\s\S]{0,900}clipboardBaseline/.test(overlayJs)
    && /VOICE_CONTEXT_FALLBACK_MAX_AGE_MS\s*=\s*60\s*\*\s*1000/.test(overlayJs)
    && /maxExternalAgeMs:\s*VOICE_CONTEXT_FALLBACK_MAX_AGE_MS/.test(overlayJs)
    && /captureActiveWindowHintForVoice[\s\S]{0,1600}applyShellHandoff\(payload\)/.test(overlayJs),
  "voice mode: voice and Echo context capture must hand off selected text/files without promoting stale clipboard fallback");
assert.ok(/NOTE_SOURCE_CONTEXT_MAX_AGE_MS\s*=\s*60\s*\*\s*1000/.test(overlayJs)
    && /function fetchRecentBrowserContextForNote[\s\S]{0,260}if \(!sourceUrl && !sourceTitle\) return null;/.test(overlayJs)
    && /maxExternalAgeMs:\s*NOTE_SOURCE_CONTEXT_MAX_AGE_MS[\s\S]{0,120}captureMode:\s*"note_recording"/.test(overlayJs),
  "note/Echo source context: note enrichment must not reuse arbitrary stale browser contexts without a URL/title anchor");
assert.ok(/explicitBrowserContextRequest[\s\S]{0,180}resolveActiveWindowBrowserCapture/.test(overlayJs)
    && /resolveOverlayContextSubmission/.test(overlayJs)
    && /kind:\s*"missing_explicit_browser_context"/.test(read("src/shared/context-resolver.mjs")),
  "overlay context priority: explicit current-page requests must override passive clipboard/seed captures before submit");
assert.ok(/const echoTask = isEchoTask\(taskId\);/.test(overlayJs)
    && /inlinePreview: echoTask \? fullBody : null/.test(overlayJs)
    && /allowLongBody: echoTask/.test(overlayJs)
    && /forcePopup: echoTask/.test(overlayJs),
  "echo result cards: Echo success cards must carry the complete answer without requiring overlay open");
assert.ok(/conversationId: taskOwnerConversationId\(taskConversationMap, taskId\)/.test(overlayJs)
    && /pendingContinuationConversationId/.test(overlayJs)
    && /conversationId: payload\?\.conversationId/.test(popupCardJs),
  "echo result cards: popup-card continuations must preserve the originating conversation id");
assert.ok(/function normalizeBatchEntry\(payload\)[\s\S]{0,260}conversationId: payload\.conversationId \?\? null/.test(desktopNotifications)
    && /conversationId: only\.conversationId \?\? null/.test(desktopNotifications)
    && /conversationId: card\.payload\?\.conversationId \?\? card\.meta\?\.conversationId/.test(electronMain),
  "echo result cards: notification batching and resolve broadcasts must not drop conversationId");
assert.ok(/lines\.length <= limit[\s\S]{0,180}more line\(s\)\. Open the conversation for the full result/.test(desktopNotifications),
  "popup result cards: long bodies must disclose truncation instead of silently hiding content");
assert.ok(/payload\.allowLongBody === true && payload\.forcePopup === true[\s\S]{0,80}return lines/.test(desktopNotifications)
    && /\(payload\.forcePopup === true && payload\.allowLongBody === true\)/.test(desktopNotifications)
    && /forcePopup: only\.forcePopup/.test(desktopNotifications),
  "echo result cards: forcePopup long-body cards must render the full body instead of batch-truncated preview lines");
assert.ok(/appendTurn\("assistant", memorySnippet\);[\s\S]{0,120}if \(!isEchoTask\(task\.task_id\)\) \{[\s\S]{0,100}maybeRevealOverlay\(\{ markEngaged: true \}\)/.test(overlayJs),
  "echo artifact completion: generated files from Echo tasks must not force-open the overlay");
assert.ok(/frame\.event === "success"[\s\S]{0,320}fireSuccessPopupCardOnce/.test(overlayJs),
  "echo result cards: terminal-only success events must still surface a full popup result card");
assert.ok(/popupSuccessCardTaskId === taskId && !terminal/.test(overlayJs)
    && /dedupeKey: `notify:\$\{taskId\}`/.test(overlayJs)
    && /frame\.event === "success"[\s\S]{0,320}terminal: true/.test(overlayJs),
  "echo result cards: terminal success must be allowed to update a prior inline_result popup card");
assert.ok(!/clearTaskConversationBinding\(taskConversationMap, frameTaskId\)/.test(overlayJs),
  "echo result cards: terminal cleanup must not discard task-to-conversation bindings needed by delayed continuations");
assert.ok(/const shouldOpenOverlay = payload\?\.openWindow === "overlay" \|\| payload\?\.handoff;/.test(popupCardJs)
    && /else if \(!shouldOpenOverlay\)[\s\S]{0,160}detailAction/.test(popupCardJs)
    && /\(payload\?\.taskId \|\| payload\?\.openWindow\) && !shouldOpenOverlay/.test(popupCardJs)
    && /function detailAction/.test(popupCardJs),
  "popup cards: open-overlay actions must not duplicate the generic detail button");
assert.ok(/<option value="zh-CN" selected>中文（普通话，保留英文词）<\/option>/.test(overlayHtml)
    && /selectedVoiceLanguage/.test(overlayJs)
    && /liveRecognizerLanguage/.test(overlayJs),
  "voice mode: language selection must default to simplified Chinese and separate live recognizer locale from final transcription");
assert.ok(/id="voiceEchoSettingsPanel"/.test(consoleHtml) && /setEchoWakeProfile/.test(consoleJs),
  "echo mode: Console settings must expose the Echo wake profile instead of leaving settings.echoWake invisible");
assert.ok(/id="echoDiagnosticsPanel"/.test(consoleHtml)
    && /getEchoDiagnostics/.test(consoleJs)
    && /startWakeEnrollment/.test(consoleJs)
    && /Transcription/.test(consoleJs)
    && /Fallback enabled/.test(consoleJs)
    && /personal template fallback remains active/.test(consoleJs),
  "echo mode: Console settings must expose non-hot-path diagnostics and wake enrollment controls");
assert.ok(/void refreshDesktopLocationChip\(\);[\s\S]{0,80}setTimeout\(\(\) => \{ void refreshDesktopLocationChip\(\); \}, 9_000\);[\s\S]{0,100}setInterval\(\(\) => \{ void refreshDesktopLocationChip\(\); \}, 30 \* 60 \* 1000\);/.test(consoleJs),
  "location: Console must re-sync after startup background refresh and then refresh periodically");
assert.ok(/const settings = await loadSettings\(\);[\s\S]{0,420}if \(!settings\?\.echoMode\)[\s\S]{0,100}showWindow\("overlay"\)/.test(mainProcessIpc),
  "dock file drop: normal mode must open overlay while Echo mode only hands off files for V-to-ask");
assert.ok(/surface:\s*settings\?\.echoMode \? "echo_receipt" : "overlay"/.test(mainProcessIpc)
    && /const ECHO_DOCK_DROP_VOICE_READY_MS = 30_000;/.test(desktopOverlayPayloads)
    && /voiceContinueTtlMs:\s*settings\?\.echoMode \? ECHO_DOCK_DROP_VOICE_READY_MS : 0/.test(mainProcessIpc)
    && !/announceDroppedFiles[\s\S]{0,700}showWindow\?\.\("overlay"\)/.test(read("src/desktop/renderer/dock.js")),
  "dock file drop: main owns mode policy; dock only renders the returned receipt surface");
assert.ok(/startNewConversation\(\{ preservePendingInputContext \}\)/.test(overlayJs)
    && /const hasPendingInputContext = Boolean\(pendingFileSelection\?\.filePaths\?\.length \|\| pendingCapture\?\.capture\)/.test(overlayJs)
    && /const isEchoReceipt = payload\.surface === "echo_receipt" \|\| payload\.mode === "echo"/.test(overlayJs)
    && /if \(isEchoReceipt\) \{[\s\S]{0,80}renderVoiceChips\(\);[\s\S]{0,40}return;[\s\S]{0,40}\}/.test(overlayJs)
    && /已收到 \$\{fileCount\} 个文件。按 V 直接说话/.test(read("src/desktop/renderer/dock.js"))
    && /onWakeDetected\("voice", "dock_file_voice", \{[\s\S]{0,120}preserveContext:\s*true/.test(read("src/desktop/renderer/dock.js")),
  "echo dock drop: file handoff must survive V wake and surface a HUD receipt without opening overlay");
assert.ok(/consoleChatAttachmentPayload/.test(consoleJs)
    && /normalizeAttachmentSubmission\(\{ filePaths \}\)/.test(consoleJs)
    && /export function normalizeAttachmentSubmission/.test(read("src/shared/context-resolver.mjs"))
    && /\.\.\.consoleChatAttachmentPayload\(attachedFilePaths\)/.test(consoleJs),
  "console chat attachments: all-image attachments must route through imagePaths instead of the slower file ingest path");
assert.ok(/activeFilePaths\.every\(isImageFilePath\)/.test(read("src/shared/context-resolver.mjs"))
    && /reason: allImages \? "explicit_image_context" : "explicit_file_context"/.test(read("src/shared/context-resolver.mjs")),
  "overlay active current-file image selections must use imagePaths instead of the slower file ingest path");
assert.ok(!/id="providerOnboardingList"/.test(consoleHtml),
  "provider settings must not show global capability onboarding cards inside AI Providers");
assert.equal((consoleHtml.match(/Add any OpenAI-compatible or Anthropic API\. Saved instantly/g) ?? []).length, 1,
  "provider setup helper text must appear once, not be duplicated by onboarding cards");
assert.ok(!/data-settings-nav="(?:skillsSettingsPanel|codeCliSettingsPanel|emailSettingsPanel)"/.test(consoleHtml),
  "settings nav must not link to panels that are mounted under Connectors");
assert.ok(/data-connectors-nav="skillsSettingsPanel"/.test(consoleHtml)
    && /data-connectors-nav="codeCliSettingsPanel"/.test(consoleHtml)
    && /data-connectors-nav="connEmailTitle"/.test(consoleHtml),
  "connectors must provide sidebar navigation for email, skills, and Code CLI surfaces");
assert.ok(/\.chat-preview-pane \.lp-iframe\b/.test(sharedCss),
  "chat preview: inline preview iframe must have stable dimensions outside the standalone live-preview shell");
assert.ok(/exportBundle:\s*["']uca:export-bundle["']/.test(desktopManifest),
  "data export: IPC channel missing from desktop manifest");
assert.ok(/data-evidence-url[\s\S]{0,220}shell\.openUrl\?\.\(url,\s*\{\s*ask:\s*true,\s*source:\s*["']evidence_source["']\s*\}/.test(evidenceSourcesView),
  "evidence source links must use the unified ask-before-open URL policy instead of forcing the system browser");
assert.ok(/diagnosticBundle:\s*["']uca:diagnostic-bundle["']/.test(desktopManifest),
  "diagnostics: IPC channel missing from desktop manifest");
assert.ok(/rendererErrorReport:\s*["']uca:renderer-error["']/.test(desktopManifest),
  "diagnostics: renderer error IPC channel missing from desktop manifest");
assert.ok(/exportBundle\(payload\)/.test(consolePreload) && /ipcRenderer\.invoke\("uca:export-bundle"/.test(consolePreload),
  "data export: preload bridge missing");
assert.ok(/diagnosticBundle\(payload\)/.test(consolePreload) && /ipcRenderer\.invoke\("uca:diagnostic-bundle"/.test(consolePreload),
  "diagnostics: preload bridge missing");
assert.ok(/addEventListener\?\.\("error"/.test(consolePreload) && /addEventListener\?\.\("unhandledrejection"/.test(consolePreload),
  "diagnostics: preload must capture renderer errors locally");
assert.ok(/ipcMain\.handle\(IPC_CHANNELS\.exportBundle/.test(mainProcessIpc) && /\/export\/bundle/.test(mainProcessIpc),
  "data export: electron main handler must call /export/bundle");
assert.ok(/ipcMain\.handle\(IPC_CHANNELS\.diagnosticBundle/.test(mainProcessIpc) && /\/diagnostics\/bundle/.test(mainProcessIpc),
  "diagnostics: electron main handler must call /diagnostics/bundle");
assert.ok(/ipcMain\.handle\(IPC_CHANNELS\.rendererErrorReport/.test(mainProcessIpc)
    && /appendDesktopDiagnosticError/.test(mainProcessIpc)
    && /desktop-errors\.jsonl/.test(desktopDiagnostics),
  "diagnostics: electron main must persist renderer error reports locally");
assert.ok(/crashReporter\.start\(\{[\s\S]{0,220}uploadToServer:\s*false/.test(desktopDiagnostics),
  "diagnostics: crashReporter must be local-only");
assert.ok(!/fetchJson\(\s*["'`]\/export\/bundle["'`]\s*,\s*\{\s*method:\s*["'`]POST/.test(consoleJs),
  "data export: console must not POST /export/bundle directly");
assert.ok(!/fetchJson\(\s*["'`]\/diagnostics\/bundle["'`]\s*,\s*\{\s*method:\s*["'`]POST/.test(consoleJs),
  "diagnostics: console must not POST /diagnostics/bundle directly");
assert.ok(/createSchedule/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.createSchedule/.test(consoleJs),
  "scheduler create: console must use desktop shell bridge");
assert.ok(/updateSchedule/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.updateSchedule/.test(consoleJs),
  "scheduler update: console must use desktop shell bridge");
assert.ok(/deleteSchedule/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.deleteSchedule/.test(consoleJs),
  "scheduler delete: console must use desktop shell bridge");
assert.ok(/runScheduleNow/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.runSchedule/.test(consoleJs),
  "scheduler run-now: console must use desktop shell bridge");
assert.ok(/createScheduleViaShell/.test(overlayJs) && /(?:consoleShellClient|overlayShellClient)\.createSchedule/.test(overlayJs),
  "scheduler create: overlay must use desktop shell bridge");
assert.ok(!/fetchJson\(\s*["'`]\/schedules["'`]\s*,\s*\{\s*method:\s*["'`]POST/.test(consoleJs),
  "scheduler create: console must not POST /schedules directly");
assert.ok(!/fetchJson\(\s*["'`]\/schedules["'`]\s*,\s*\{\s*method:\s*["'`]POST/.test(overlayJs),
  "scheduler create: overlay must not POST /schedules directly");
assert.ok(!/fetchJson\(\s*`\/schedules\/\$\{encodeURIComponent\([^)]*\)\}`\s*,\s*\{\s*method:\s*["'`](PATCH|DELETE)/.test(consoleJs),
  "scheduler mutation: console must not PATCH/DELETE /schedules/:id directly");
assert.ok(!/fetchJson\(\s*`\/schedules\/\$\{encodeURIComponent\([^)]*\)\}\/runs`\s*,\s*\{\s*method:\s*["'`]POST/.test(consoleJs),
  "scheduler run-now: console must not POST /schedules/:id/runs directly");
assert.ok(/saveTemplateViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.saveTemplate/.test(consoleJs),
  "template save: console must use desktop shell bridge");
assert.ok(/importTemplateViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.importTemplate/.test(consoleJs),
  "template import: console must use desktop shell bridge");
assert.ok(/deleteTemplateViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.deleteTemplate/.test(consoleJs),
  "template delete: console must use desktop shell bridge");
assert.ok(/resumeDagExecutionViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.resumeDagExecution/.test(consoleJs),
  "DAG resume: console must use desktop shell bridge");
assert.ok(/saveTemplateViaShell/.test(overlayJs) && /(?:consoleShellClient|overlayShellClient)\.saveTemplate/.test(overlayJs),
  "template save: overlay must use desktop shell bridge");
assert.ok(!/fetchJson\(\s*["'`]\/templates["'`]\s*,\s*\{\s*method:\s*["'`]POST/.test(consoleJs),
  "template save: console must not POST /templates directly");
assert.ok(!/fetchJson\(\s*["'`]\/templates["'`]\s*,\s*\{\s*method:\s*["'`]POST/.test(overlayJs),
  "template save: overlay must not POST /templates directly");
assert.ok(!/fetchJson\(\s*["'`]\/templates\/import["'`]\s*,\s*\{\s*method:\s*["'`]POST/.test(consoleJs),
  "template import: console must not POST /templates/import directly");
assert.ok(!/fetchJson\(\s*`\/templates\/\$\{encodeURIComponent\([^)]*\)\}`\s*,\s*\{\s*method:\s*["'`]DELETE/.test(consoleJs),
  "template delete: console must not DELETE /templates/:id directly");
assert.ok(!/fetchJson\(\s*`\/dag\/executions\/\$\{encodeURIComponent\([^)]*\)\}\/resume`\s*,\s*\{\s*method:\s*["'`]POST/.test(consoleJs),
  "DAG resume: console must not POST /dag/executions/:id/resume directly");
assert.ok(/saveProviderViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.saveProvider/.test(consoleJs),
  "provider save: console must use desktop shell bridge");
assert.ok(/deleteProviderViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.deleteProvider/.test(consoleJs),
  "provider delete: console must use desktop shell bridge");
assert.ok(!/fetchJson\(\s*["'`]\/config\/providers["'`]\s*,\s*\{\s*method:\s*["'`]POST/.test(consoleJs),
  "provider save: console must not POST /config/providers directly");
assert.ok(!/fetchJson\(\s*`\/config\/providers\/\$\{encodeURIComponent\([^)]*\)\}`\s*,\s*\{\s*method:\s*["'`]DELETE/.test(consoleJs),
  "provider delete: console must not DELETE /config/providers/:id directly");
assert.ok(/saveCodeCliAdapterViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.saveCodeCliAdapter/.test(consoleJs),
  "Code CLI adapter save: console must use desktop shell bridge");
assert.ok(/deleteCodeCliAdapterViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.deleteCodeCliAdapter/.test(consoleJs),
  "Code CLI adapter delete: console must use desktop shell bridge");
assert.ok(!/fetchJson\(\s*["'`]\/config\/code-cli\/adapters["'`]\s*,\s*\{\s*method:\s*["'`]POST/.test(consoleJs),
  "Code CLI adapter save: console must not POST /config/code-cli/adapters directly");
assert.ok(!/fetchJson\(\s*`\/config\/code-cli\/adapters\/\$\{encodeURIComponent\([^)]*\)\}`\s*,\s*\{\s*method:\s*["'`]DELETE/.test(consoleJs),
  "Code CLI adapter delete: console must not DELETE /config/code-cli/adapters/:id directly");
assert.ok(/saveSkillRegistryViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.saveSkillRegistry/.test(consoleJs),
  "skill registry save: console must use desktop shell bridge");
assert.ok(/deleteSkillRegistryViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.deleteSkillRegistry/.test(consoleJs),
  "skill registry delete: console must use desktop shell bridge");
assert.ok(/updateSkillStateViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.updateSkillState/.test(consoleJs),
  "skill state toggle: console must use desktop shell bridge");
assert.ok(!/fetchJson\(\s*["'`]\/config\/skills\/registries["'`]\s*,\s*\{\s*method:\s*["'`]POST/.test(consoleJs),
  "skill registry save: console must not POST /config/skills/registries directly");
assert.ok(!/fetchJson\(\s*`\/config\/skills\/registries\/\$\{encodeURIComponent\([^)]*\)\}`\s*,\s*\{\s*method:\s*["'`]DELETE/.test(consoleJs),
  "skill registry delete: console must not DELETE /config/skills/registries/:id directly");
assert.ok(/data-skill-state-registry/.test(consoleJs) && /Use this/.test(consoleJs) && /Stop/.test(consoleJs),
  "skill state toggle: discovered skill cards must expose Use this/Stop controls");
assert.ok(/updateRoutingConfigViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.updateRoutingConfig/.test(consoleJs),
  "routing config: console must use desktop shell bridge");
assert.ok(/updateOutputConfigViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.updateOutputConfig/.test(consoleJs),
  "output config: console must use desktop shell bridge");
assert.ok(/updateFeatureConfigViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.updateFeatureConfig/.test(consoleJs),
  "feature config: console must use desktop shell bridge");
assert.ok(!/fetchJson\(\s*["'`]\/config\/routing["'`]\s*,\s*\{\s*method:\s*["'`]POST/.test(consoleJs),
  "routing config: console must not POST /config/routing directly");
assert.ok(!/fetchJson\(\s*["'`]\/config\/output["'`]\s*,\s*\{\s*method:\s*["'`]POST/.test(consoleJs),
  "output config: console must not POST /config/output directly");
assert.ok(!/fetchJson\(\s*["'`]\/config\/features["'`]\s*,\s*\{\s*method:\s*["'`]POST/.test(consoleJs),
  "feature config: console must not POST /config/features directly");
assert.ok(/updateEmailSettingsViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.updateEmailSettings/.test(consoleJs),
  "email settings: console must use desktop shell bridge");
assert.ok(!/fetchJson\(\s*["'`]\/config\/email\/settings["'`]\s*,\s*\{\s*method:\s*["'`]POST/.test(consoleJs),
  "email settings: console must not POST /config/email/settings directly");
assert.ok(/saveEmailAccountViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.saveEmailAccount/.test(consoleJs),
  "email account save: console must use desktop shell bridge");
assert.ok(/deleteEmailAccountViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.deleteEmailAccount/.test(consoleJs),
  "email account delete: console must use desktop shell bridge");
assert.ok(!/fetchJson\(\s*["'`]\/config\/email\/accounts["'`]\s*,\s*\{\s*method:\s*["'`]POST/.test(consoleJs),
  "email account save: console must not POST /config/email/accounts directly via fetchJson");
assert.ok(!/fetch\(\s*`\$\{state\.serviceBaseUrl\}\/config\/email\/accounts`\s*,\s*\{\s*method:\s*["'`]POST/.test(consoleJs),
  "email account save: console must not POST /config/email/accounts directly via fetch");
assert.ok(!/fetchJson\(\s*`\/config\/email\/accounts\/\$\{encodeURIComponent\([^)]*\)\}`\s*,\s*\{\s*method:\s*["'`]DELETE/.test(consoleJs),
  "email account delete: console must not DELETE /config/email/accounts/:id directly via fetchJson");
assert.ok(!/fetch\(\s*`\$\{state\.serviceBaseUrl\}\/config\/email\/accounts\/\$\{encodeURIComponent\([^)]*\)\}`\s*,\s*\{\s*method:\s*["'`]DELETE/.test(consoleJs),
  "email account delete: console must not DELETE /config/email/accounts/:id directly via fetch");
assert.ok(/checkEmailDigestViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.checkEmailDigest/.test(consoleJs),
  "email digest check: console must use desktop shell bridge");
assert.ok(!/fetch\(\s*`\$\{state\.serviceBaseUrl\}\/email\/digest\/check`\s*,\s*\{\s*method:\s*["'`]POST/.test(consoleJs),
  "email digest check: console must not POST /email/digest/check directly");
assert.ok(/\.mcp-install-preview\b/.test(sharedCss),
  "mcp install preview: CSS wrapper missing");
assert.ok(/id="skillRegistryTestBtn"/.test(consoleHtml), "skill preflight: test button missing");
assert.ok(/consolePreflightClient\.testSkillRegistryConfig/.test(consoleJs)
    && /\/config\/skills\/test/.test(runtimePreflightClient),
  "skill preflight: console must use runtime preflight client for /config/skills/test");
assert.ok(/function setPreflightState\s*\(/.test(consoleJs), "preflight state: helper missing");
assert.ok((consoleJs.match(/setPreflightState\s*\(/g) ?? []).length >= 8,
  "preflight state: MCP/Skill test and save paths must use setPreflightState");
assert.ok(/\.preflight-state--ok\b/.test(sharedCss)
    && /\.preflight-state--err\b/.test(sharedCss)
    && /\.preflight-state--pending\b/.test(sharedCss),
  "preflight state: ok/err/pending CSS classes missing");
assert.ok(/Actual startup tested/.test(consoleJs),
  "mcp preflight: success copy must clarify descriptor-only validation");
assert.ok(!/mcpServerState\.textContent\s*=\s*["'`]Looks valid/.test(consoleJs),
  "mcp preflight: raw Looks valid text must use state helper");
assert.ok(!/skillRegistryState\.textContent\s*=\s*["'`]Looks valid/.test(consoleJs),
  "skill preflight: raw Looks valid text must use state helper");
assert.ok(/showFieldError\s*\(/.test(consoleJs) && /clearFieldErrors\s*\(/.test(consoleJs),
  "preflight field errors: console must render inline field errors");
assert.ok(/\.field-error\b/.test(sharedCss), "preflight field errors: .field-error CSS missing");
assert.ok(/writeSkillMarkdownViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.writeSkillMarkdown/.test(consoleJs),
  "skill editor write: console must use desktop shell bridge");
assert.ok(/readSkillMarkdownViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.readSkillMarkdown/.test(consoleJs),
  "skill editor read: console must use desktop shell bridge");
assert.ok(/createSkillViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.createSkill/.test(consoleJs),
  "skill lifecycle create: console must use desktop shell bridge");
assert.ok(/duplicateSkillViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.duplicateSkill/.test(consoleJs),
  "skill lifecycle duplicate: console must use desktop shell bridge");
assert.ok(/deleteSkillViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.deleteSkill/.test(consoleJs),
  "skill lifecycle delete: console must use desktop shell bridge");
assert.ok(/rollbackSkillViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.rollbackSkill/.test(consoleJs),
  "skill lifecycle rollback: console must use desktop shell bridge");
assert.ok(/listSkillHistoryViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.listSkillHistory/.test(consoleJs),
  "skill lifecycle history: console must use desktop shell bridge");
assert.ok(/testSkillViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.testSkill/.test(consoleJs),
  "skill lifecycle test: console must use desktop shell bridge");
assert.ok(/id="skillCreateBtn"/.test(consoleHtml)
    && /id="skillEditRollbackBtn"/.test(consoleHtml)
    && /id="skillEditTestBtn"/.test(consoleHtml)
    && /id="skillEditHistorySelect"/.test(consoleHtml),
  "skill lifecycle: create, history, rollback, and test controls missing");
assert.ok(/data-skill-duplicate/.test(consoleJs),
  "skill lifecycle: discovered skill cards must expose duplicate action");
assert.ok(/data-skill-delete/.test(consoleJs),
  "skill lifecycle: discovered skill cards must expose delete action");
assert.ok(!/fetchJson\(\s*["'`]\/skills\/write["'`]\s*,\s*\{\s*method:\s*["'`]POST/.test(consoleJs),
  "skill editor write: console must not POST /skills/write directly");
assert.ok(!/fetchJson\(\s*[`'"]\/skills\/read\b/.test(consoleJs),
  "skill editor read: console must not GET /skills/read directly");
assert.ok(!/fetchJson\(\s*[`'"]\/skills\/(?:create|duplicate|delete|rollback|history|test)\b/.test(consoleJs),
  "skill lifecycle: console must not call skill lifecycle routes directly");
assert.ok(/saveAutoSkillViaShell/.test(overlayJs) && /(?:consoleShellClient|overlayShellClient)\.saveAutoSkill/.test(overlayJs),
  "auto skill save: overlay must use desktop shell bridge");
assert.ok(!/fetchJson\(\s*["'`]\/skills\/save["'`]\s*,\s*\{\s*method:\s*["'`]POST/.test(overlayJs),
  "auto skill save: overlay must not POST /skills/save directly");

// ── Per-user-message ↑/↓ nav ───────────────────────────────────────────
assert.ok(/chat-msg-nav\b/.test(sharedCss) && /chat-msg-nav-btn/.test(consoleJs),
  "user nav: console ↑/↓ buttons missing");
assert.ok(/bubble-nav\b/.test(overlayHtml) && /bubble-nav-btn/.test(overlayJs),
  "user nav: overlay ↑/↓ buttons missing");
assert.ok(/function navigateUserMessage/.test(consoleJs), "user nav: navigateUserMessage missing");
assert.ok(/function navigateUserBubble/.test(overlayJs), "user nav: navigateUserBubble missing");

// ── Streaming caret ────────────────────────────────────────────────────
assert.ok(/\.chat-msg-bubble\.streaming::after/.test(sharedCss), "streaming caret: console CSS missing");
assert.ok(/\.bubble\.assistant\.streaming::after/.test(overlayHtml), "streaming caret: overlay CSS missing");

// ── Live artifact preview coverage ─────────────────────────────────────
for (const toolId of ["write_file", "generate_document", "edit_file", "render_diagram", "render_svg"]) {
  assert.ok(livePreview.includes(`"${toolId}"`),
    `live preview: ${toolId} must be a previewable artifact tool`);
}
assert.ok(/toolName === "render_diagram"/.test(previewStreaming)
    && /renderDiagramStream/.test(previewStreaming)
    && /extractStringField\(rawJson,\s*"code"\)/.test(previewStreaming),
  "live preview: render_diagram must stream diagram source before final artifact render");
assert.ok(/toolName === "render_svg"/.test(previewStreaming)
    && /renderSvgStream/.test(previewStreaming)
    && /extractStringField\(rawJson,\s*"svg"\)/.test(previewStreaming),
  "live preview: render_svg must stream SVG source before final artifact render");
assert.ok(/function renderDocumentDraft/.test(previewStreaming)
    && /function renderPagedDocumentDraft/.test(previewStreaming)
    && /function renderXlsxDraft/.test(previewStreaming)
    && /function renderPptxDraft/.test(previewStreaming),
  "live preview: generate_document must render realistic draft previews for document, spreadsheet, and slide artifacts");
assert.ok(/const initialJson = args && Object\.keys\(args\)\.length > 0/.test(previewWindowJs)
    && /livePreviewStreaming\.renderDelta/.test(previewWindowJs),
  "live preview: preview window must render initial tool args before provider deltas arrive");
assert.ok(/\.lp-document-draft/.test(previewWindowHtml)
    && /\.lp-sheet-draft/.test(previewWindowHtml)
    && /\.lp-slide-draft/.test(previewWindowHtml),
  "live preview: preview window must style realistic document/xlsx/pptx drafts");
assert.ok(/function artifactPathFromToolPayload/.test(overlayJs)
    && /Array\.isArray\(payload\?\.artifact_paths\)/.test(overlayJs)
    && /artifactPath:\s*artifactPathFromToolPayload\(frame\.data\)/.test(overlayJs),
  "live preview: overlay must commit from canonical artifact_paths arrays, not only legacy metadata.path");
assert.ok(/if \(!state\.toolName\)[\s\S]{0,260}state\.toolName = toolName[\s\S]{0,260}setStatus\("running"\)/.test(previewWindowJs),
  "live preview: preview window must bootstrap from early tool_input_delta before tool_call_started");
assert.ok(/runTaskBindingIsolation/.test(previewWindowJs)
    && /state\.taskId && taskId && state\.taskId !== taskId/.test(previewWindowJs),
  "live preview: preview window must ignore cross-task deltas/commits once bound to a task");
assert.ok(/function artifactPathFromConsoleToolPayload/.test(consoleJs)
    && consoleJs.includes("Array.isArray(payload?.artifact_paths)")
    && consoleJs.includes("payload.artifact_paths.find")
    && consoleJs.includes("const artifactPath = artifactPathFromConsoleToolPayload(payload);"),
  "live preview: console must commit from canonical artifact_paths arrays, not only metadata.path");

// ── Bubble timestamps ──────────────────────────────────────────────────
assert.ok(/function formatRelativeTime\s*\(/.test(sharedUi), "timestamps: shared formatRelativeTime() missing");
assert.ok(/formatRelativeTime/.test(consoleJs), "timestamps: console must import/use formatRelativeTime()");
assert.ok(/formatRelativeTime/.test(overlayJs), "timestamps: overlay must import/use formatRelativeTime()");
assert.ok(/refreshChatTimestamps/.test(consoleJs) && /refreshChatTimestamps/.test(overlayJs),
  "timestamps: refresh tick missing on either surface");
assert.ok(/\.chat-msg-time\b/.test(sharedCss), "timestamps: .chat-msg-time CSS missing");

// ── Auto-title conversations ───────────────────────────────────────────
assert.ok(/function deriveConversationTitle\s*\(/.test(conversationLifecycle),
  "auto-title: deriveConversationTitle() missing in conversation-lifecycle");
assert.ok(/from\s+["']\.\/conversation-lifecycle\.mjs["']/.test(taskSubmission),
  "auto-title: task-submission must delegate conversation lifecycle helpers");
assert.ok(/runtime\.store\?\.updateConversation\b|runtime\.store\.updateConversation\b/.test(taskSubmission),
  "auto-title: must call updateConversation on first message");

// ── Stop button: force cancel ──────────────────────────────────────────
assert.ok(/cancelTask\s*\(\s*\{[^}]*force\s*=/.test(taskCancellation),
  "stop button: cancelTask must accept force arg");
assert.ok(/cancellationRequestedTaskId/.test(overlayJs),
  "stop button: overlay must track cancellationRequestedTaskId");
assert.ok(/send-btn--cancelling/.test(overlayHtml) && /send-btn--cancelling/.test(overlayJs),
  "stop button: cancelling visual state missing in overlay");
assert.ok(/consoleChatActiveTaskId/.test(consoleJs),
  "stop button: console must track consoleChatActiveTaskId");
assert.ok(/btn-stop\b/.test(consoleJs) && /\.btn\.btn-stop/.test(sharedCss),
  "stop button: console btn-stop class wiring missing");
assert.ok(/cancelTaskViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.cancelTask/.test(consoleJs),
  "task cancel: console must use desktop shell bridge");
assert.ok(/retryTaskViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.retryTask/.test(consoleJs),
  "task retry: console must use desktop shell bridge");
assert.ok(/deleteTaskViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.deleteTask/.test(consoleJs),
  "task delete: console must use desktop shell bridge");
assert.ok(/cancelTaskViaShell/.test(overlayJs) && /(?:consoleShellClient|overlayShellClient)\.cancelTask/.test(overlayJs),
  "task cancel: overlay must use desktop shell bridge");
assert.ok(/retryTaskViaShell/.test(overlayJs) && /(?:consoleShellClient|overlayShellClient)\.retryTask/.test(overlayJs),
  "task retry: overlay must use desktop shell bridge");
const taskControlSources = `${consoleJs}\n${overlayJs}`;
assert.ok(!/fetchJson\(\s*`\/task\/\$\{[^}]+\}\/cancel`\s*,\s*\{[\s\S]{0,220}method:\s*["'`]POST/.test(taskControlSources),
  "task cancel: renderers must not POST /task/:id/cancel directly");
assert.ok(!/fetchJson\(\s*`\/task\/\$\{[^}]+\}\/retry`\s*,\s*\{[\s\S]{0,220}method:\s*["'`]POST/.test(taskControlSources),
  "task retry: renderers must not POST /task/:id/retry directly");
assert.ok(!/fetchJson\(\s*`\/task\/\$\{[^}]+\}`\s*,\s*\{[\s\S]{0,180}method:\s*["'`]DELETE/.test(consoleJs),
  "task delete: console must not DELETE /task/:id directly");

// ── FW-028 Task/Conversation IA boundary ───────────────────────────────
assert.ok(/id="taskRecentConversationsPanel"/.test(consoleHtml),
  "task/conversation IA: compatibility panel missing in console.html");
assert.ok(/id="taskRecentConversationsPanel" hidden/.test(consoleHtml),
  "task/conversation IA: Tasks must not surface conversations as its empty-state primary content");
assert.ok(/Task runs are execution records/.test(consoleJs),
  "task/conversation IA: empty task detail must explain that tasks are execution records");
assert.ok(/setTaskDetailPanelVisible\("taskRecentConversationsPanel", false\)/.test(consoleJs),
  "task/conversation IA: renderTaskDetail(null) must keep conversation browser hidden");
assert.ok(/function renderTaskConversationLink/.test(consoleJs) && /data-task-open-conversation/.test(consoleJs),
  "task/conversation IA: task detail must link to the owning conversation instead of embedding transcript browsing");
assert.ok(/\.task-conversation-link/.test(sharedCss) && /\.task-empty-detail/.test(sharedCss),
  "task/conversation IA: missing task/conversation boundary styles");
assert.ok(!/switchTab\("conversations"\)/.test(consoleJs),
  "task/conversation IA: UI must not route users into the hidden standalone Conversations tab");
assert.ok(!/data-tab="conversations"/.test(consoleHtml),
  "task/conversation IA: standalone Conversations rail item must be removed");

// ── Conversation context attachments ───────────────────────────────────
assert.ok(/data-chat-context-open/.test(consoleJs) && /data-chat-context-reveal/.test(consoleJs),
  "conversation context: console message file chips must be openable and revealable");
assert.ok(/openConversationArtifactPath/.test(consoleJs) && /revealConversationArtifactPath/.test(consoleJs),
  "conversation context: console file chips must use preview/open and reveal bridges");
assert.ok(!/window\.livePreview\.openForFile\s*=\s*function\s+consoleOpenForFile/.test(consoleJs),
  "conversation context: console must not override the global livePreview bridge");
assert.ok(/async function openConversationArtifactPath[\s\S]{0,180}openInlinePreviewInChat\(\{\s*filePath\s*\}/.test(consoleJs)
    && /consolePreviewOpenExternalBtn\?\.addEventListener/.test(consoleJs)
    && /consoleShellClient\?\.openPath/.test(consoleJs),
  "conversation context: clicking generated files must preview inline first, with explicit external open available");
assert.ok(/data-context-open-path/.test(overlayJs),
  "conversation context: overlay message file chips must be openable");
assert.ok(/contextOpenPath/.test(overlayJs) && /(?:consoleShellClient|overlayShellClient)\?\.openPath/.test(overlayJs),
  "conversation context: overlay file chips must use the shell open bridge");

// ── Connector edit (rename) ────────────────────────────────────────────
assert.ok(/data-connected-edit/.test(consoleJs),
  "connector edit: data-connected-edit button missing on connected cards");
assert.ok(/function handleConnectedAccountEdit/.test(consoleJs),
  "connector edit: handler missing");
assert.ok(/renameConnectedAccountViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.renameConnectedAccount/.test(consoleJs),
  "connector edit: console must use desktop shell bridge");
assert.ok(/setConnectedAccountDefaultViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.setConnectedAccountDefault/.test(consoleJs),
  "connector default: console must use desktop shell bridge");
assert.ok(/disconnectConnectedAccountViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.disconnectConnectedAccount/.test(consoleJs),
  "connected account disconnect: console must use desktop shell bridge");
assert.ok(/disconnectConnectorAccountViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.disconnectConnectorAccount/.test(consoleJs),
  "connector account disconnect: console must use desktop shell bridge");
assert.ok(/saveConnectorAccountConfigViaShell/.test(consoleJs) && /(?:consoleShellClient|overlayShellClient)\.saveConnectorAccountConfig/.test(consoleJs),
  "connector account config: console must use desktop shell bridge");
assert.ok(!/fetch\(\s*`\$\{state\.serviceBaseUrl\}\/connectors\/connected-accounts\/\$\{encodeURIComponent\([^)]*\)\}`\s*,\s*\{[\s\S]{0,180}method:\s*["'`]PATCH/.test(consoleJs),
  "connector edit: console must not PATCH /connectors/connected-accounts/:id directly");
assert.ok(!/fetch\(\s*`\$\{state\.serviceBaseUrl\}\/connectors\/connected-accounts\/\$\{encodeURIComponent\([^)]*\)\}\/defaults`\s*,\s*\{[\s\S]{0,180}method:\s*["'`]PATCH/.test(consoleJs),
  "connector default: console must not PATCH /connectors/connected-accounts/:id/defaults directly");
assert.ok(!/fetch\(\s*`\$\{state\.serviceBaseUrl\}\/connectors\/connected-accounts\/\$\{encodeURIComponent\([^)]*\)\}`\s*,\s*\{[\s\S]{0,180}method:\s*["'`]DELETE/.test(consoleJs),
  "connected account disconnect: console must not DELETE /connectors/connected-accounts/:id directly");
assert.ok(!/fetch\(\s*`\$\{state\.serviceBaseUrl\}\/connectors\/accounts\/\$\{[^}]+\}`\s*,\s*\{[\s\S]{0,180}method:\s*["'`]DELETE/.test(consoleJs),
  "connector account disconnect: console must not DELETE /connectors/accounts/:type directly");
assert.ok(!/fetch\(\s*`\$\{state\.serviceBaseUrl\}\/connectors\/accounts\/\$\{[^}]+\}\/config`\s*,\s*\{[\s\S]{0,180}method:\s*["'`]PATCH/.test(consoleJs),
  "connector account config: console must not PATCH /connectors/accounts/:type/config directly");
assert.ok(/PATCH.*connected-accounts.*\$/m.test(connectorRoutes)
  || /method === "PATCH" && \/\^\\\/connectors\\\/connected-accounts\\\/\[\^\\\/\]\+\$/.test(connectorRoutes)
  || /connected-accounts\/\[\^\\\/\]\+\$/.test(connectorRoutes),
  "connector edit: PATCH /connectors/connected-accounts/:id endpoint missing");
assert.ok(/upsertConnectedAccount/.test(connectorRoutes),
  "connector edit: route must call upsertConnectedAccount");

// ── Note font-size sweep + chip inheritance ────────────────────────────
assert.ok(/queryselectorAll\(".\[style\*='font-size'\]/i.test(consoleJs)
  || /querySelectorAll\("\[style\*='font-size'\]"\)/.test(consoleJs),
  "note font-size: applyFontSize must sweep [style*='font-size']");
assert.ok(/note-chat-chip[\s\S]{0,200}font-size:\s*inherit/.test(sharedCss),
  "note font-size: chip CSS must inherit");

// ── clearBubbles defensive guard ───────────────────────────────────────
assert.ok(/streamingBubble[\s\S]{0,200}classList\?\.contains\("streaming"\)/.test(overlayJs)
  || /classList\?\.contains\("streaming"\)/.test(overlayJs),
  "clearBubbles: must preserve a live .streaming bubble");

// ── Auto-scroll bottom-pin controller ──────────────────────────────────
assert.ok(/createBottomPinController/.test(consoleJs) && /createBottomPinController/.test(overlayJs),
  "scroll-pin: controller must exist on both surfaces");
assert.ok(/id="bubbleScrollDown"/.test(overlayHtml) && /id="consoleChatScrollDown"/.test(consoleHtml),
  "scroll-pin: scroll-to-bottom buttons missing");
assert.ok(/\.scroll-to-bottom\b/.test(sharedCss),
  "scroll-pin: .scroll-to-bottom CSS missing");

// ── Drop-zone visual feedback ──────────────────────────────────────────
assert.ok(/id="consoleChatDropZone"/.test(consoleHtml) && /id="overlayDropZone"/.test(overlayHtml),
  "drop-zone: zone DOM missing in either surface");
assert.ok(/\.chat-drop-zone\b/.test(sharedCss),
  "drop-zone: .chat-drop-zone CSS missing");

// ── Phase labels in timeline header ────────────────────────────────────
assert.ok(/TIMELINE_PHASES|setTimelinePhase/.test(overlayJs),
  "phase labels: TIMELINE_PHASES / setTimelinePhase missing");

// ── Step counter suffix ────────────────────────────────────────────────
assert.ok(/function formatStepSuffix/.test(read("src/desktop/renderer/task-event-stream.js")),
  "step counter: formatStepSuffix() missing in task-event-stream");
assert.ok(/createRuntimeHttpClient/.test(taskEventStream)
    && /fetchResponse/.test(taskEventStream)
    && !/\bfetch\s*\(/.test(taskEventStream),
  "task event stream: SSE request construction must use the shared runtime HTTP client");
assert.ok(/preview\/runtime-preview-client\.js/.test(previewWindowHtml)
    && /previewClient\.renderPreviewHtml/.test(iframeRemotePreviewHandler)
    && /\/file\/render-preview-html/.test(previewRuntimeClient)
    && !/\bfetch\s*\(/.test(iframeRemotePreviewHandler),
  "preview iframe remote: request construction must stay in the preview runtime client");
assert.ok(/preview\/shell-preview-client\.js/.test(previewWindowHtml)
    && /window\.ucaShell/.test(previewShellClient)
    && /previewShellClient/.test(previewWindowJs)
    && /previewShellClient/.test(textPreviewHandler)
    && /previewShellClient/.test(csvPreviewHandler)
    && /previewShellClient/.test(imagePreviewHandler)
    && /previewShellClient/.test(pdfPreviewHandler)
    && !/window\.ucaShell/.test(previewWindowJs)
    && !/window\.ucaShell/.test(textPreviewHandler)
    && !/window\.ucaShell/.test(csvPreviewHandler)
    && !/window\.ucaShell/.test(imagePreviewHandler)
    && !/window\.ucaShell/.test(pdfPreviewHandler),
  "preview shell bridge calls must stay behind the preview shell client");
assert.ok(/preview\/shell-preview-client\.js/.test(consoleHtml)
    && /preview\/runtime-preview-client\.js/.test(consoleHtml)
    && /statPath/.test(consolePreload)
    && /listDirectory/.test(consolePreload)
    && /fs\.readdir/.test(consolePreload)
    && /statPath/.test(previewShellClient)
    && /listDirectory/.test(previewShellClient),
  "console inline preview must load preview clients and expose directory stat/list through the shell bridge");
assert.ok(/id="consolePreviewBackBtn"/.test(consoleHtml)
    && /id="consolePreviewParentBtn"/.test(consoleHtml)
    && /inlinePreviewBackStack/.test(consoleJs)
    && /currentInlinePreviewParentPath/.test(consoleJs)
    && /data-directory-entry-open/.test(consoleJs)
    && /data-directory-entry-reveal/.test(consoleJs)
    && /\.directory-preview-row/.test(sharedCss),
  "console inline preview must support folder navigation, reveal actions, and back navigation");

// ── Step copy on row ───────────────────────────────────────────────────
assert.ok(/\.bubble\.step\s+\.step-copy/.test(overlayHtml),
  "step copy: .step-copy CSS missing");

// ── Quote scrolls input into view ──────────────────────────────────────
assert.ok(/composer-flash/.test(consoleJs) && /composer-flash/.test(overlayJs),
  "quote: composer-flash class missing on either surface");
assert.ok(/\.composer-flash\b|composer-flash\b/.test(sharedCss),
  "quote: composer-flash animation missing");

// ── Connectors browse button promotion ─────────────────────────────────
assert.ok(/id="connBrowseBtn"[^>]*btn-primary/.test(consoleHtml),
  "connectors: Browse catalog button must be btn-primary");

// ── IA Phase 2: chat sidebar ───────────────────────────────────────────
assert.ok(/class="chat-layout"/.test(consoleHtml),
  "phase 2: .chat-layout grid missing on Chat tab");
assert.ok(/id="chatSidebarList"/.test(consoleHtml),
  "phase 2: #chatSidebarList missing");
assert.ok(/id="chatSidebarSearch"/.test(consoleHtml),
  "phase 2: #chatSidebarSearch input missing");
assert.ok(/id="chatSidebarNewBtn"/.test(consoleHtml),
  "phase 2: #chatSidebarNewBtn (+ New) missing");
assert.ok(/function renderChatSidebar/.test(consoleJs),
  "phase 2: renderChatSidebar() missing in console.js");
assert.ok(/function refreshChatSidebar/.test(consoleJs),
  "phase 2: refreshChatSidebar() missing in console.js");
assert.ok(/from\s+["']\.\/console-chat-sidebar\.mjs["']/.test(consoleJs),
  "phase 2: chat sidebar renderer module must be imported by console.js");
assert.ok(/function renderChatSidebarListHtml\s*\(/.test(consoleChatSidebar),
  "phase 2: chat sidebar list renderer missing");
assert.ok(/function filterChatSidebarItems\s*\(/.test(consoleChatSidebar),
  "phase 2: chat sidebar search helper missing");
assert.ok(/function startNewConsoleChat/.test(consoleJs),
  "phase 2: startNewConsoleChat() must exist (shared by sidebar + page-head buttons)");
assert.ok(/\.chat-sidebar\b/.test(sharedCss) && /\.chat-sidebar-list\b/.test(sharedCss),
  "phase 2: chat-sidebar CSS missing");
// Projects tab Preview column retired
assert.ok(!/projects-col[^"]*"\s*>[^<]*<header[\s\S]{0,200}Preview<span class="zh">预览/.test(consoleHtml),
  "phase 2: Projects tab Preview column should be retired");

console.log("ok verify-ui-extras");
