#!/usr/bin/env node
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");
const readDesktopTrayIpcModules = () => readdirSync(path.join(repoRoot, "src/desktop/tray/ipc"), { withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.mjs$/u.test(entry.name))
  .map((entry) => readFileSync(path.join(repoRoot, "src/desktop/tray/ipc", entry.name), "utf8"));

const overlayHtml = read("src/desktop/renderer/overlay.html");
const overlayJs = read("src/desktop/renderer/overlay.js");
const dockJs = read("src/desktop/renderer/dock.js");
const audioDevice = read("src/desktop/renderer/audio-device.mjs");
const audioView = read("src/desktop/renderer/overlay-audio-view.mjs");
const preload = read("src/desktop/renderer/preload.cjs");
const main = [
  read("src/desktop/tray/electron-main.mjs"),
  read("src/desktop/tray/desktop-window-actions.mjs"),
  read("src/desktop/tray/desktop-permission-handler.mjs"),
  ...readDesktopTrayIpcModules()
].join("\n");
const manifest = read("src/desktop/shared/manifest.mjs");
const audioRoutes = read("src/service/core/http-routes/audio-routes.mjs");
const wakeMatch = read("src/shared/echo-wake-match.mjs");
const sherpaScript = read("scripts/local-sherpa-kws.py");
const transcriptLocale = read("src/service/audio/transcript-locale.mjs");
const localSurface = read("scripts/verify-local-http-surface.mjs");
const userSmoke = read("docs/release/user_interaction_smoke_checklist.md");

for (const id of [
  "voiceToggleBtn",
  "voiceCard",
  "tabVoiceBtn",
  "tabNoteBtn",
  "voiceChips",
  "voiceStatus",
  "voiceTranscript",
  "voiceLang",
  "voiceCancelBtn",
  "voiceStopBtn",
  "voiceStartBtn",
  "composerMicBtn",
  "noteTimer",
  "noteMicTag",
  "noteSysTag",
  "noteTranscriptBox",
  "noteLang",
  "noteCancelBtn",
  "noteFinishBtn"
]) {
  assert.ok(overlayHtml.includes(`id="${id}"`), `overlay voice/note HTML missing #${id}`);
}

assert.ok((overlayHtml.match(/class="wave-bar"/g) ?? []).length >= 9,
  "voice card should keep the animated audio wave affordance");

for (const listener of [
  "voiceToggleBtn?.addEventListener(\"click\"",
  "voiceStartBtn?.addEventListener(\"click\"",
  "voiceStopBtn?.addEventListener(\"click\"",
  "voiceCancelBtn?.addEventListener(\"click\"",
  "tabVoiceBtn?.addEventListener(\"click\"",
  "tabNoteBtn?.addEventListener(\"click\"",
  "noteCancelBtn?.addEventListener(\"click\"",
  "noteFinishBtn?.addEventListener(\"click\""
]) {
  assert.ok(overlayJs.includes(listener), `overlay missing listener: ${listener}`);
}

for (const voiceInvariant of [
  "function resetVoiceState()",
  "requestAudioInputStream({",
  "applyVoiceRecordingView({",
  "resetVoiceTranscriptView(voiceTranscript",
  "startVoiceLocalRecorder(stream)",
  "startVoicePreviewLoop()",
  "stopVoiceLocalRecorder({ transcribe",
  "transcribeAudioBlob(blob",
  "transcribeAudioBlobStreaming(blob",
  "selectedVoiceLanguage()",
  "liveRecognizerLanguage()",
  "transcriptionOutputLocale()",
  "voiceCard.addEventListener(\"drop\"",
  "attachDroppedFilesToVoice(filePaths)"
]) {
  assert.ok(overlayJs.includes(voiceInvariant), `voice state machine missing invariant: ${voiceInvariant}`);
}

for (const echoInvariant of [
  "DEFAULT_WAKE_PROFILE",
  "function buildWakeProfile(settings = {})",
  "function applyEchoSettings(settings = {})",
  "停顿后自动发送；Enter 立即发送",
  "function startVoiceForDroppedFiles()",
  "preserveContext: true",
  "getWakeDisplayName()"
]) {
  const source = echoInvariant === "function applyEchoSettings(settings = {})"
    || echoInvariant === "停顿后自动发送；Enter 立即发送"
    || echoInvariant === "function startVoiceForDroppedFiles()"
    || echoInvariant === "preserveContext: true"
    || echoInvariant === "getWakeDisplayName()"
    ? dockJs
    : wakeMatch;
  assert.ok(source.includes(echoInvariant), `echo wake profile missing invariant: ${echoInvariant}`);
}

for (const viewInvariant of [
  "export function formatNoteElapsed",
  "export function setVoiceCardMode",
  "export function resetVoiceTranscriptView",
  "export function applyVoiceRecordingView"
]) {
  assert.ok(audioView.includes(viewInvariant), `overlay audio view helper missing invariant: ${viewInvariant}`);
}

for (const deviceInvariant of [
  "export function describeAudioInputFailure",
  "permissions?.query?.({ name: \"microphone\" })",
  "mediaDevices.getUserMedia({ audio: true })",
  "getUserMedia_timeout",
  "classificationAudioInputError",
  "permission_denied_preflight",
  "stopStream(stream)"
]) {
  const expected = deviceInvariant === "classificationAudioInputError"
    ? "classifyAudioInputError"
    : deviceInvariant;
  assert.ok(audioDevice.includes(expected), `audio device helper missing invariant: ${expected}`);
}

for (const noteInvariant of [
  "const NOTE_MAX_DURATION_MS",
  "async function enterNoteMode()",
  "function startNoteMicCapture(",
  "function startNoteSysCapture()",
  "overlayShellClient?.getDesktopAudioSource?.()",
  "startNoteMicRecorder(stream",
  "noteMediaRecorder = new MediaRecorder",
  "async function finishNote()",
  "overlayShellClient?.setNoteRecordingState?."
]) {
  assert.ok(overlayJs.includes(noteInvariant), `note recorder missing invariant: ${noteInvariant}`);
}

for (const bridge of [
  "openOverlayVoice(payload = {})",
  "setNoteRecordingState(payload)",
  "getNoteRecordingState()",
  "onNoteRecordingState(callback)",
  "getDesktopAudioSource()",
  "detectEchoKeyword(payload)",
  "enrollEchoKeyword(payload)",
  "getEchoDiagnostics()",
  "startWakeEnrollment()",
  "setEchoWakeProfile(profile)",
  "transcribeNoteAudio(payload)",
  "transcribeNoteAudioStreaming(payload, callback)",
  "note-transcribe-stream-event"
]) {
  assert.ok(preload.includes(bridge), `preload missing audio bridge: ${bridge}`);
}

for (const channel of [
  "shellOpenOverlayVoice",
  "echoKwsDetect",
  "echoKeywordEnroll",
  "echoDiagnostics",
  "echoWakeEnrollmentStart",
  "echoWakeProfileUpdate",
  "noteTranscribe",
  "noteTranscribeStream",
  "noteTranscribeStreamEvent"
]) {
  assert.ok(manifest.includes(channel), `IPC manifest missing ${channel}`);
}

for (const mainBridge of [
  "function openOverlayVoice(payload = {})",
  "IPC_CHANNELS.shellOpenOverlayVoice",
  "IPC_CHANNELS.echoKwsDetect",
  "IPC_CHANNELS.echoKeywordEnroll",
  "IPC_CHANNELS.echoDiagnostics",
  "IPC_CHANNELS.echoWakeEnrollmentStart",
  "IPC_CHANNELS.echoWakeProfileUpdate",
  "IPC_CHANNELS.noteTranscribe",
  "IPC_CHANNELS.noteTranscribeStream",
  "IPC_CHANNELS.noteTranscribeStreamEvent",
  "uca:get-desktop-audio-source",
  "setPermissionRequestHandler",
  "permission === \"audioCapture\"",
  "permission === \"microphone\"",
  "\"CommandOrControl+Return\", \"Return\"",
  "output_locale"
]) {
  assert.ok(main.includes(mainBridge), `main process missing audio bridge: ${mainBridge}`);
}

for (const route of [
  "GET\" && url.pathname === \"/echo/kws/status\"",
  "GET\" && url.pathname === \"/echo/enrollment/status\"",
  "GET\" && url.pathname === \"/note/transcribe/status\"",
  "POST\" && url.pathname === \"/echo/kws\"",
  "POST\" && url.pathname === \"/echo/enroll-keyword\"",
  "POST\" && url.pathname === \"/note/transcribe\""
]) {
  assert.ok(audioRoutes.includes(route), `audio routes missing ${route}`);
}

assert.ok(audioRoutes.includes("transcriptionPromptForLanguage") && audioRoutes.includes("Use Simplified Chinese"),
  "audio routes must pass an output-locale prompt so zh-CN transcriptions do not drift to Traditional Chinese");
assert.ok(transcriptLocale.includes("opencc-js/t2cn") && transcriptLocale.includes("normalizeTranscriptionTextForLocale"),
  "audio transcription: locale normalizer must use OpenCC for Traditional-to-Simplified post-processing");
assert.ok(audioRoutes.includes("normalizeTranscriptionTextForLocale") && audioRoutes.includes("normalizeTranscriptionEventForLocale"),
  "audio routes must normalize both one-shot and streaming transcription text by requested output locale");
assert.ok(dockJs.includes("keywords: echoWakeProfile.phrases"),
  "echo KWS: dock must pass the saved wake profile phrases into local KWS detection");
assert.ok(dockJs.includes("../../shared/echo-wake-match.mjs") && wakeMatch.includes("export function matchesWake"),
  "echo KWS: Dock and fixtures must share the production wake matcher");
assert.ok(dockJs.includes("const ECHO_VAD_SPEECH_MULTIPLIER = 2;"),
  "echo KWS: VAD speech multiplier must stay loose enough for soft wake utterances");
assert.ok(main.includes("params.set(\"keywords\"") && main.includes("pathname: \"/echo/kws\""),
  "echo KWS: main process must forward wake-profile keywords to the local service route");
assert.ok(audioRoutes.includes("parseWakeKeywordsParam") && audioRoutes.includes("--keywords"),
  "echo KWS: audio route must pass forwarded wake-profile keywords to the sherpa helper");
assert.ok(audioRoutes.includes("detectWakeKeywordWithSherpaDaemon") && sherpaScript.includes("--server"),
  "echo KWS: local sherpa must expose a reusable daemon path with one-shot fallback");
assert.ok(sherpaScript.includes("class KwsSpotterCache") && sherpaScript.includes("spotter_cache=spotter_cache"),
  "echo KWS: sherpa daemon must cache KeywordSpotter instances instead of only keeping Python alive");
assert.ok(overlayJs.includes("function toggleComposerVoiceInput()")
  && overlayJs.includes("if (payload.shortcutId === \"voice-wake\")")
  && overlayJs.includes("toggleComposerVoiceInput();"),
  "overlay voice: Ctrl+Shift+V must route to the lightweight composer mic path");
assert.ok(overlayJs.includes("if (!payload.preserveContext)") && main.includes("preserveContext: Boolean(payload?.preserveContext)"),
  "overlay voice: dock/file handoff must be able to start voice without clearing pending context");
assert.ok(main.includes("surface: settings?.echoMode ? \"echo_receipt\" : \"overlay\"")
  && dockJs.includes("result.surface === \"echo_receipt\"")
  && dockJs.includes("sendEchoWake"),
  "dock drop: main owns normal/Echo surface policy, while Echo stays in hidden voice handoff");
assert.ok(main.includes("preserveContext: Boolean(payload.preserveContext)")
  && overlayJs.includes("overlayShellClient?.onEchoWake"),
  "Echo wake: preserveContext must survive dock -> main -> overlay handoff");
assert.ok(overlayJs.includes("async function submitComposerInput()")
  && overlayJs.includes("await stopVoiceRecognition()")
  && overlayJs.includes("void submitComposerInput();"),
  "overlay voice: composer Enter/send must stop dictation before submitting");
assert.ok(overlayJs.includes("voiceToggleBtn?.addEventListener(\"click\"")
  && overlayJs.includes("void enterNoteMode();"),
  "overlay voice: quick voice button must open the recording-note path, not the legacy voice panel");

for (const inventory of [
  "POST\", \"/echo/enroll-keyword\"",
  "POST\", \"/echo/kws\"",
  "GET\", \"/echo/kws/status\"",
  "GET\", \"/echo/enrollment/status\"",
  "GET\", \"/note/transcribe/status\"",
  "POST\", \"/note/transcribe\""
]) {
  assert.ok(localSurface.includes(inventory), `local HTTP surface inventory missing ${inventory}`);
}

for (const manualRow of [
  "| Overlay voice input |",
  "| Voice attachments |",
  "| Note recording |",
  "| Echo mode |"
]) {
  assert.ok(userSmoke.includes(manualRow), `manual user smoke checklist missing ${manualRow}`);
}

console.log("ok verify-audio-entrypoints");
