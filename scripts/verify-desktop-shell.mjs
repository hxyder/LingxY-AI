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
// Dock window must match the visible orb size (48x48). A previous oversized
// hitbox left invisible padding around the orb, while fixed CSS pixels under
// Chromium page zoom created native scrollbars in the tiny HUD window.
if (!dockWindow || dockWindow.width !== 48 || dockWindow.height !== 48) {
  throw new Error("Dock window must match the 48x48 orb size (no invisible padding).");
}
if (dockWindow.locksRendererZoom !== true) {
  throw new Error("Dock window must declare renderer zoom locking in the manifest.");
}

const dockHtml = readFileSync(new URL("../src/desktop/renderer/dock.html", import.meta.url), "utf8");
if (!/html\s*\{[\s\S]*?width:\s*100vw;[\s\S]*?height:\s*100vh;[\s\S]*?overflow:\s*hidden;/.test(dockHtml)
    || !/body\s*\{[\s\S]*?width:\s*100vw;[\s\S]*?height:\s*100vh;[\s\S]*?overflow:\s*hidden/.test(dockHtml)) {
  throw new Error("Dock renderer document must be viewport-sized and non-scrollable.");
}

if (!/#dockButton\s*\{[\s\S]*?width:\s*100vw;[\s\S]*?height:\s*100vh;/.test(dockHtml)
    || !/canvas\s*\{[\s\S]*?width:\s*100%;[\s\S]*?height:\s*100%;/.test(dockHtml)) {
  throw new Error("Dock orb must fill the viewport without fixed CSS-pixel overflow.");
}

if (/#dockButton:hover\s*\{[^}]*scale\(\s*1\./.test(dockHtml)
    || /#dockButton\.dragover\s*\{[^}]*scale\(\s*1\./.test(dockHtml)) {
  throw new Error("Dock hover/dragover states must not enlarge the 48x48 document and trigger scrollbars.");
}

const electronMain = readFileSync(new URL("../src/desktop/tray/electron-main.mjs", import.meta.url), "utf8");
if (!/dock:\s*\{\s*minWidth:\s*48,\s*minHeight:\s*48,\s*maxWidth:\s*48,\s*maxHeight:\s*48\s*\}/.test(electronMain)) {
  throw new Error("Dock bounds clamp must keep the BrowserWindow fixed at 48x48.");
}

if (!electronMain.includes("function lockWindowRendererZoom")
    || !electronMain.includes("setZoomFactor?.(1)")
    || !electronMain.includes("setVisualZoomLevelLimits?.(1, 1)")
    || !electronMain.includes('"zoom-changed"')) {
  throw new Error("Dock renderer zoom must be locked to prevent tiny-window scrollbars.");
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
