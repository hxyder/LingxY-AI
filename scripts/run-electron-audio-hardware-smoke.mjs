#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const enabled = process.env.LINGXY_DESKTOP_AUDIO_HARDWARE_SMOKE === "1";

if (!enabled) {
  console.log("[desktop-audio-hardware-smoke] skipped; set LINGXY_DESKTOP_AUDIO_HARDWARE_SMOKE=1 to record from local microphone hardware.");
  process.exit(0);
}

const child = spawn(process.execPath, ["scripts/run-electron-gui-smoke.mjs"], {
  cwd: repoRoot,
  env: {
    ...process.env,
    LINGXY_DESKTOP_AUDIO_HARDWARE_SMOKE: "1",
    LINGXY_ELECTRON_GUI_SMOKE_TIMEOUT_MS: process.env.LINGXY_ELECTRON_GUI_SMOKE_TIMEOUT_MS ?? "45000"
  },
  stdio: "inherit",
  windowsHide: true
});

child.on("error", (error) => {
  console.error(`[desktop-audio-hardware-smoke] failed to launch Electron GUI smoke: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`[desktop-audio-hardware-smoke] Electron GUI smoke terminated by ${signal}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
