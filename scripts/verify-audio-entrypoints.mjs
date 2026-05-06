#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");

const overlayHtml = read("src/desktop/renderer/overlay.html");
const overlayJs = read("src/desktop/renderer/overlay.js");
const dockJs = read("src/desktop/renderer/dock.js");
const audioDevice = read("src/desktop/renderer/audio-device.mjs");
const audioView = read("src/desktop/renderer/overlay-audio-view.mjs");
const preload = read("src/desktop/renderer/preload.cjs");
const main = read("src/desktop/tray/electron-main.mjs");
const manifest = read("src/desktop/shared/manifest.mjs");
const audioRoutes = read("src/service/core/http-routes/audio-routes.mjs");
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
  "const DEFAULT_WAKE_PROFILE",
  "function buildWakeProfile(settings = {})",
  "function applyEchoSettings(settings = {})",
  "停顿后自动发送；Ctrl+Enter 立即发送",
  "getWakeDisplayName()"
]) {
  assert.ok(dockJs.includes(echoInvariant), `dock echo wake profile missing invariant: ${echoInvariant}`);
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
  "window.ucaShell?.getDesktopAudioSource?.()",
  "startNoteMicRecorder(stream",
  "noteMediaRecorder = new MediaRecorder",
  "async function finishNote()",
  "window.ucaShell?.setNoteRecordingState?."
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
assert.ok(dockJs.includes("const ECHO_VAD_SPEECH_MULTIPLIER = 2;"),
  "echo KWS: VAD speech multiplier must stay loose enough for soft wake utterances");
assert.ok(main.includes("params.set(\"keywords\"") && main.includes("pathname: \"/echo/kws\""),
  "echo KWS: main process must forward wake-profile keywords to the local service route");
assert.ok(audioRoutes.includes("parseWakeKeywordsParam") && audioRoutes.includes("--keywords"),
  "echo KWS: audio route must pass forwarded wake-profile keywords to the sherpa helper");
assert.ok(audioRoutes.includes("detectWakeKeywordWithSherpaDaemon") && sherpaScript.includes("--server"),
  "echo KWS: local sherpa must expose a reusable daemon path with one-shot fallback");

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
