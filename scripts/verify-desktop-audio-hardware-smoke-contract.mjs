#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

const pkg = JSON.parse(read("package.json"));
const optInRunner = read("scripts/run-electron-audio-hardware-smoke.mjs");
const guiRunner = read("src/desktop/smoke/desktop-gui-smoke-runner.mjs");
const overlay = read("src/desktop/renderer/overlay.js");
const roadmap = read("docs/architecture/post-runtime-upgrade-roadmap.md");

assert.equal(
  pkg.scripts["verify:desktop-audio-hardware-smoke"],
  "node scripts/run-electron-audio-hardware-smoke.mjs",
  "package.json must expose the opt-in desktop audio hardware smoke"
);
assert.ok(optInRunner.includes("LINGXY_DESKTOP_AUDIO_HARDWARE_SMOKE"),
  "audio hardware smoke runner must be gated by an explicit env flag");
assert.ok(optInRunner.includes("skipped; set LINGXY_DESKTOP_AUDIO_HARDWARE_SMOKE=1"),
  "audio hardware smoke runner must skip cleanly by default");
assert.ok(optInRunner.includes("scripts/run-electron-gui-smoke.mjs"),
  "audio hardware smoke must reuse the real Electron GUI smoke harness");

for (const expected of [
  "runAudioHardwarePermissionPath",
  "requestAudioInputStream({",
  "navigator.mediaDevices",
  "describeAudioInputFailure(input)",
  "new MediaRecorder(stream",
  "track.stop?.()"
]) {
  assert.ok(overlay.includes(expected), `overlay hardware smoke hook missing: ${expected}`);
}

assert.ok(guiRunner.includes("process.env.LINGXY_DESKTOP_AUDIO_HARDWARE_SMOKE === \"1\""),
  "desktop GUI smoke must only run hardware capture when explicitly enabled");
assert.ok(guiRunner.includes("overlay_audio_hardware_permission_capture"),
  "desktop GUI smoke must report a named hardware audio capture check");
assert.ok(!guiRunner.includes("overlay_audio_hardware_permission_capture_failed") || guiRunner.includes("audioHardwarePath?.message"),
  "hardware failures must carry actionable renderer diagnostics");

for (const required of [
  "VX-002: Optional Hardware Permission Smoke",
  "LINGXY_DESKTOP_AUDIO_HARDWARE_SMOKE=1",
  "npm run verify:desktop-audio-hardware-smoke",
  "default check suite does not hang or require hardware"
]) {
  assert.ok(roadmap.includes(required), `roadmap missing hardware smoke contract text: ${required}`);
}

console.log("[verify-desktop-audio-hardware-smoke-contract] opt-in audio hardware smoke contract OK");
