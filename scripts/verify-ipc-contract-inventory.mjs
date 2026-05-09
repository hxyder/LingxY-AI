import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { IPC_CHANNELS } from "../src/desktop/shared/manifest.mjs";

const root = process.cwd();
const docPath = path.join(root, "docs/architecture/ipc-contract-inventory.md");
const mainPath = path.join(root, "src/desktop/tray/electron-main.mjs");
const preloadPath = path.join(root, "src/desktop/renderer/preload.cjs");

const expectedChannels = [
  "uca:approval-approve",
  "uca:approval-reject",
  "uca:auto-skill-save",
  "uca:budget-update",
  "uca:code-cli-adapter-delete",
  "uca:code-cli-adapter-save",
  "uca:connected-account-default-set",
  "uca:connected-account-disconnect",
  "uca:connected-account-rename",
  "uca:connector-account-config-save",
  "uca:connector-account-disconnect",
  "uca:console-open",
  "uca:context-preview-requested",
  "uca:dag-resume",
  "uca:diagnostic-bundle",
  "uca:echo-diagnostics",
  "uca:echo-keyword-enroll",
  "uca:echo-kws-detect",
  "uca:echo-wake-enrollment-start",
  "uca:echo-wake-profile-update",
  "uca:email-account-delete",
  "uca:email-account-save",
  "uca:email-digest-check",
  "uca:email-settings-update",
  "uca:export-bundle",
  "uca:feature-config-update",
  "uca:mcp-draft-import",
  "uca:mcp-install-preview",
  "uca:mcp-install-run",
  "uca:mcp-server-config",
  "uca:mcp-server-delete",
  "uca:mcp-server-save",
  "uca:mcp-server-test",
  "uca:mcp-server-toggle",
  "uca:note-append-chip",
  "uca:note-delete",
  "uca:note-restore",
  "uca:note-transcribe",
  "uca:note-transcribe-stream",
  "uca:note-transcribe-stream-event",
  "uca:note-upsert",
  "uca:notes-save",
  "uca:office-addins-setup",
  "uca:onboarding-suggestion-update",
  "uca:output-config-update",
  "uca:overlay-auto-hide",
  "uca:overlay-toggle",
  "uca:popup-card-close",
  "uca:popup-card-init",
  "uca:popup-card-resize",
  "uca:popup-card-resolve",
  "uca:popup-card-resolved",
  "uca:popup-card-show",
  "uca:popup-card-toggle-pin",
  "uca:preview-cache-clear",
  "uca:preview-window-append-delta",
  "uca:preview-window-close",
  "uca:preview-window-commit",
  "uca:preview-window-committed",
  "uca:preview-window-delta",
  "uca:preview-window-init",
  "uca:preview-window-show",
  "uca:project-files-attach",
  "uca:project-files-pick",
  "uca:project-files-remove-index",
  "uca:project-store-save",
  "uca:provider-delete",
  "uca:provider-save",
  "uca:renderer-error",
  "uca:routing-config-update",
  "uca:schedule-create",
  "uca:schedule-delete",
  "uca:schedule-run",
  "uca:schedule-update",
  "uca:security-state-update",
  "uca:shell-clipboard-changed",
  "uca:shell-context-received",
  "uca:shell-hide-window",
  "uca:shell-move-window-by",
  "uca:shell-navigate-console",
  "uca:shell-notification-received",
  "uca:shell-notify",
  "uca:shell-open-overlay-voice",
  "uca:shell-open-url",
  "uca:shell-ready",
  "uca:shell-resize-window-by",
  "uca:shell-set-ignore-mouse-events",
  "uca:shell-show-window",
  "uca:shell-status",
  "uca:shell-submit-dropped-files",
  "uca:shell-updater-apply",
  "uca:shell-updater-check-now",
  "uca:shell-updater-set-strategy",
  "uca:shell-updater-status",
  "uca:shell-window-focused",
  "uca:shortcut-triggered",
  "uca:skill-create",
  "uca:skill-delete",
  "uca:skill-duplicate",
  "uca:skill-history",
  "uca:skill-markdown-read",
  "uca:skill-markdown-write",
  "uca:skill-registry-delete",
  "uca:skill-registry-save",
  "uca:skill-rollback",
  "uca:skill-state-update",
  "uca:skill-test",
  "uca:task-cancel",
  "uca:task-delete",
  "uca:task-file-recovery-restore",
  "uca:task-restore",
  "uca:task-retry",
  "uca:template-delete",
  "uca:template-import",
  "uca:template-save"
];

const expectedHardcodedMainHandlers = [
  "uca:capture-active-window-context",
  "uca:echo-bubble-show",
  "uca:echo-wake",
  "uca:get-desktop-audio-source",
  "uca:get-note-recording-state",
  "uca:get-pdf-worker-url",
  "uca:get-settings",
  "uca:note-recording-state",
  "uca:preview-window-pin",
  "uca:register-ctrl-enter",
  "uca:set-echo-mode",
  "uca:show-dock-menu",
  "uca:unregister-ctrl-enter"
];

function fail(message) {
  console.error(`[ipc-inventory] ${message}`);
  process.exitCode = 1;
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function count(text, pattern) {
  return (text.match(pattern) ?? []).length;
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

const channels = sortedUnique(Object.values(IPC_CHANNELS));
assert(JSON.stringify(channels) === JSON.stringify(expectedChannels), "IPC_CHANNELS snapshot changed; update inventory intentionally.");

const doc = existsSync(docPath) ? readFileSync(docPath, "utf8") : "";
assert(doc.includes("IPC channel count: 115"), "IPC inventory missing channel count");
assert(doc.includes("src/desktop/shared/manifest.mjs"), "IPC inventory missing manifest source");

const main = readFileSync(mainPath, "utf8");
const preload = readFileSync(preloadPath, "utf8");

assert(count(main, /ipcMain\.handle\(/g) === 107, "main ipcMain.handle count changed");
assert(count(main, /\.\w*send\(/g) === 28, "main send reference count changed");
assert(count(preload, /ipcRenderer\.invoke\(/g) === 108, "preload invoke count changed");
assert(count(preload, /ipcRenderer\.on\(/g) === 22, "preload listener count changed");

const hardcodedMainHandlers = sortedUnique([...main.matchAll(/ipcMain\.handle\(\s*["']([^"']+)["']/g)].map((match) => match[1]));
assert(
  JSON.stringify(hardcodedMainHandlers) === JSON.stringify(expectedHardcodedMainHandlers),
  "hard-coded main IPC handler snapshot changed; update inventory intentionally."
);

if (!process.exitCode) {
  console.log("[ipc-inventory] IPC contract snapshot verified.");
}
