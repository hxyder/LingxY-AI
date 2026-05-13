import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { IPC_CHANNELS } from "../src/desktop/shared/manifest.mjs";

const root = process.cwd();
const docPath = path.join(root, "docs/architecture/ipc-contract-inventory.md");
// Phase 2A locks current handler/send/invoke/listener counts as a contract snapshot.
// In Phase 2B, if IPC handlers move into modules, scan electron-main.mjs plus those
// modules. The invariant is channel contract stability, not handler file location.
const mainPath = path.join(root, "src/desktop/tray/electron-main.mjs");
const ipcModuleRoot = path.join(root, "src/desktop/main/ipc");
const mainIpcHelperPaths = [
  path.join(root, "src/desktop/tray/desktop-window-messages.mjs"),
  path.join(root, "src/desktop/shell/desktop-window-lifecycle.mjs"),
  path.join(root, "src/desktop/shell/desktop-window-actions.mjs"),
  path.join(root, "src/desktop/shell/desktop-shortcut-router.mjs"),
  path.join(root, "src/desktop/tray/desktop-dock-menu.mjs"),
  path.join(root, "src/desktop/tray/desktop-clipboard-watcher.mjs"),
  path.join(root, "src/desktop/shell/desktop-preview-window-manager.mjs")
];
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
  "uca:runtime-labs-config-update",
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

const expectedExtractedIpcModules = [
  "src/desktop/main/ipc/register-admin-ipc.mjs",
  "src/desktop/main/ipc/register-approval-ipc.mjs",
  "src/desktop/main/ipc/register-audio-service-ipc.mjs",
  "src/desktop/main/ipc/register-connected-account-ipc.mjs",
  "src/desktop/main/ipc/register-diagnostics-ipc.mjs",
  "src/desktop/main/ipc/register-email-ipc.mjs",
  "src/desktop/main/ipc/register-mcp-ipc.mjs",
  "src/desktop/main/ipc/register-notes-project-ipc.mjs",
  "src/desktop/main/ipc/register-office-ipc.mjs",
  "src/desktop/main/ipc/register-pdf-ipc.mjs",
  "src/desktop/main/ipc/register-popup-card-ipc.mjs",
  "src/desktop/main/ipc/register-preview-ipc.mjs",
  "src/desktop/main/ipc/register-provider-config-ipc.mjs",
  "src/desktop/main/ipc/register-runtime-config-ipc.mjs",
  "src/desktop/main/ipc/register-scheduler-ipc.mjs",
  "src/desktop/main/ipc/register-shell-local-ipc.mjs",
  "src/desktop/main/ipc/register-shell-open-url-ipc.mjs",
  "src/desktop/main/ipc/register-shell-window-ipc.mjs",
  "src/desktop/main/ipc/register-skill-ipc.mjs",
  "src/desktop/main/ipc/register-task-ipc.mjs",
  "src/desktop/main/ipc/register-updater-ipc.mjs"
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

function walkJsFiles(dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkJsFiles(fullPath, files);
    } else if (/\.(?:mjs|js|cjs)$/.test(entry.name) && statSync(fullPath).isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

const channels = sortedUnique(Object.values(IPC_CHANNELS));
assert(JSON.stringify(channels) === JSON.stringify(expectedChannels), "IPC_CHANNELS snapshot changed; update inventory intentionally.");

const doc = existsSync(docPath) ? readFileSync(docPath, "utf8") : "";
assert(doc.includes("IPC channel count: 116"), "IPC inventory missing channel count");
assert(doc.includes("src/desktop/shared/manifest.mjs"), "IPC inventory missing manifest source");
for (const modulePath of expectedExtractedIpcModules) {
  assert(doc.includes(modulePath), `IPC inventory missing extracted IPC module ${modulePath}`);
}

const main = readFileSync(mainPath, "utf8");
const ipcModuleFiles = walkJsFiles(ipcModuleRoot);
const actualExtractedIpcModules = ipcModuleFiles
  .map((filePath) => path.relative(root, filePath).replace(/\\/g, "/"))
  .sort();
assert(
  JSON.stringify(actualExtractedIpcModules) === JSON.stringify(expectedExtractedIpcModules),
  "extracted IPC module snapshot changed; update inventory intentionally."
);
for (const filePath of ipcModuleFiles) {
  const source = readFileSync(filePath, "utf8");
  const relativePath = path.relative(root, filePath).replace(/\\/g, "/");
  assert(
    !/(?:from\s+|import\(\s*)["'](?:\.\.\/)+service\//.test(source) && !/["']src\/service\//.test(source),
    `${relativePath} must not import service modules directly; inject service bridge helpers from electron-main.mjs.`
  );
}
const mainProcessSources = [mainPath, ...mainIpcHelperPaths, ...ipcModuleFiles].map((filePath) => readFileSync(filePath, "utf8"));
const mainProcess = mainProcessSources.join("\n");
const preload = readFileSync(preloadPath, "utf8");

assert(count(mainProcess, /ipcMain\.handle\(/g) === 113, "main-process ipcMain.handle count changed");
assert(count(mainProcess, /\.\w*send\(/g) === 27, "main-process send reference count changed");
assert(count(preload, /ipcRenderer\.invoke\(/g) === 109, "preload invoke count changed");
assert(count(preload, /ipcRenderer\.on\(/g) === 22, "preload listener count changed");

const hardcodedMainHandlers = sortedUnique([...mainProcess.matchAll(/ipcMain\.handle\(\s*["']([^"']+)["']/g)].map((match) => match[1]));
assert(
  JSON.stringify(hardcodedMainHandlers) === JSON.stringify(expectedHardcodedMainHandlers),
  "hard-coded main IPC handler snapshot changed; update inventory intentionally."
);

if (!process.exitCode) {
  console.log("[ipc-inventory] IPC contract snapshot verified.");
}
