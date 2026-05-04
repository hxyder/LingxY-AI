import { buildDesktopShellBootstrapState } from "../src/desktop/tray/bootstrap.mjs";
import { createDesktopRuntimeHost } from "../src/desktop/tray/runtime-host.mjs";
import { createOverlayViewModel } from "../src/desktop/overlay/view-model.mjs";
import { createConsoleViewModel } from "../src/desktop/console/view-model.mjs";
import { readFileSync } from "node:fs";

const bootstrap = buildDesktopShellBootstrapState();
const overlay = createOverlayViewModel();
const consoleVm = createConsoleViewModel();
const host = createDesktopRuntimeHost();

if (bootstrap.manifest.shortcuts.length < 2) {
  throw new Error("Expected at least two desktop shortcuts.");
}

if (overlay.windowId !== "overlay") {
  throw new Error("Overlay view model is invalid.");
}

if (consoleVm.windowId !== "console") {
  throw new Error("Console view model is invalid.");
}

if (!bootstrap.entryPoint.endsWith("electron-main.mjs")) {
  throw new Error("Desktop shell entry point is missing.");
}

if (host.start().serviceBridgeAttached !== true) {
  throw new Error("Desktop runtime host did not attach service bridge.");
}

const dockWindow = bootstrap.manifest.windows.find((w) => w.id === "dock");
// Dock window must match the visible orb size (48×48). A previous 52×52
// hitbox left invisible padding around the orb, preventing the user from
// dragging it fully into a screen edge/corner. Hover scale(1.06) overflow
// is acceptable on transparent windows.
if (!dockWindow || dockWindow.width !== 48 || dockWindow.height !== 48) {
  throw new Error("Dock window must match the 48x48 orb size (no invisible padding).");
}

const electronMain = readFileSync(new URL("../src/desktop/tray/electron-main.mjs", import.meta.url), "utf8");
if (!/dock:\s*\{\s*minWidth:\s*48,\s*minHeight:\s*48,\s*maxWidth:\s*48,\s*maxHeight:\s*48\s*\}/.test(electronMain)) {
  throw new Error("Dock bounds clamp must keep the BrowserWindow fixed at 48x48.");
}

if (!/const dockMove = windowId === "dock" && options\.mode === "move"/.test(electronMain)
    || !/snapPx = 16/.test(electronMain)) {
  throw new Error("Dock move bounds must snap to display edges.");
}

if (!bootstrap.manifest.ipcChannels.includes("uca:shell-set-ignore-mouse-events")) {
  throw new Error("Dock click-through IPC channel is missing.");
}

if (!bootstrap.manifest.ipcChannels.includes("uca:mcp-install-run")) {
  throw new Error("MCP install run IPC channel is missing.");
}

if (!bootstrap.manifest.ipcChannels.includes("uca:mcp-install-preview")) {
  throw new Error("MCP install preview IPC channel is missing.");
}

for (const channel of [
  "uca:mcp-server-save",
  "uca:mcp-server-delete",
  "uca:mcp-server-toggle",
  "uca:mcp-server-config",
  "uca:approval-approve",
  "uca:approval-reject",
  "uca:security-state-update",
  "uca:budget-update",
  "uca:schedule-create",
  "uca:schedule-update",
  "uca:schedule-delete",
  "uca:schedule-run",
  "uca:template-save",
  "uca:template-import",
  "uca:template-delete",
  "uca:dag-resume",
  "uca:provider-save",
  "uca:provider-delete",
  "uca:code-cli-adapter-save",
  "uca:code-cli-adapter-delete",
  "uca:skill-registry-save",
  "uca:skill-registry-delete",
  "uca:auto-skill-save",
  "uca:skill-markdown-write",
  "uca:routing-config-update",
  "uca:output-config-update",
  "uca:feature-config-update",
  "uca:email-settings-update",
  "uca:email-account-save",
  "uca:email-account-delete",
  "uca:email-digest-check",
  "uca:notes-save",
  "uca:note-upsert",
  "uca:note-delete",
  "uca:note-append-chip",
  "uca:project-store-save",
  "uca:preview-cache-clear",
  "uca:office-addins-setup",
  "uca:echo-kws-detect",
  "uca:echo-keyword-enroll",
  "uca:note-transcribe",
  "uca:note-transcribe-stream",
  "uca:note-transcribe-stream-event",
  "uca:connected-account-rename",
  "uca:connected-account-default-set",
  "uca:connected-account-disconnect",
  "uca:connector-account-disconnect",
  "uca:connector-account-config-save",
  "uca:task-cancel",
  "uca:task-retry",
  "uca:task-delete"
]) {
  if (!bootstrap.manifest.ipcChannels.includes(channel)) {
    throw new Error(`Desktop guarded mutation IPC channel is missing: ${channel}`);
  }
}

console.log("Desktop shell scaffold verification passed.");
