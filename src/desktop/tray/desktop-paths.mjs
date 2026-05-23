import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const EXPLORER_HANDOFF_FILE_PATTERN = /^prompt-handoff-.*\.json$/i;
export const NOTIFICATION_FILE_PATTERN = /^notification-.*\.json$/i;

export function explorerHandoffDir() {
  return path.join(os.homedir(), "AppData", "Local", "UCA", "handoffs", "explorer");
}

export function notificationDir() {
  return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "UCA", "notifications");
}

export function desktopScriptsDir() {
  return path.join(__dirname, "..", "..", "..", "scripts");
}

export function desktopScriptPath(script) {
  return path.join(desktopScriptsDir(), script);
}

export function screenshotCapturePath(now = Date.now()) {
  return path.join(os.tmpdir(), "UCA", "screenshots", `capture-${now}.png`);
}

export function guiSmokeExplorerSourcePath(processId = process.pid) {
  return path.join(os.tmpdir(), `lingxy-gui-smoke-explorer-${processId}.txt`);
}

export function guiSmokeHandoffPath(handoffDir, now = Date.now()) {
  return path.join(handoffDir, `prompt-handoff-gui-smoke-${now}.json`);
}

export function guiSmokeUserDataDir(processId = process.pid) {
  return path.join(os.tmpdir(), `lingxy-electron-gui-smoke-${processId}`);
}
