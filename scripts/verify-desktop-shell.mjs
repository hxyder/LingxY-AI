import { buildDesktopShellBootstrapState } from "../src/desktop/tray/bootstrap.mjs";
import { createDesktopRuntimeHost } from "../src/desktop/tray/runtime-host.mjs";
import { createOverlayViewModel } from "../src/desktop/overlay/view-model.mjs";
import { createConsoleViewModel } from "../src/desktop/console/view-model.mjs";
import {
  DESKTOP_UNKNOWN_ACTOR,
  desktopActorForSender,
  desktopActorForWindowId
} from "../src/desktop/tray/desktop-actor.mjs";
import { readdirSync, readFileSync } from "node:fs";

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

if (desktopActorForWindowId("dock") !== "desktop_shell"
    || desktopActorForWindowId("overlay") !== "desktop_overlay"
    || desktopActorForWindowId("console") !== "desktop_console"
    || desktopActorForWindowId("preview") !== DESKTOP_UNKNOWN_ACTOR
    || desktopActorForSender({ id: "unknown" }, new Map()) !== DESKTOP_UNKNOWN_ACTOR) {
  throw new Error("Desktop IPC actor mapping must be explicit and fail closed for unknown senders.");
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
const dockGeometry = readFileSync(new URL("../src/desktop/tray/dock-geometry.mjs", import.meta.url), "utf8");
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
const startDesktop = readFileSync(new URL("../scripts/start-desktop.mjs", import.meta.url), "utf8");
const desktopSettings = readFileSync(new URL("../src/desktop/tray/desktop-settings.mjs", import.meta.url), "utf8");
const desktopWindowBounds = readFileSync(new URL("../src/desktop/tray/desktop-window-bounds.mjs", import.meta.url), "utf8");
const desktopWindowLifecycle = readFileSync(new URL("../src/desktop/shell/desktop-window-lifecycle.mjs", import.meta.url), "utf8");
const ipcModuleDir = new URL("../src/desktop/main/ipc/", import.meta.url);
const ipcModules = readdirSync(ipcModuleDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.mjs$/u.test(entry.name))
  .map((entry) => readFileSync(new URL(entry.name, ipcModuleDir), "utf8"))
  .join("\n");
const mainProcessIpc = `${electronMain}\n${ipcModules}`;
if (!electronMain.includes("createPersistentRuntime")
    || !electronMain.includes("ensureEmbeddedServiceRuntime")
    || !electronMain.includes("embedded_runtime_start_failed")) {
  throw new Error("Desktop shell must self-host the local runtime when 127.0.0.1 service is not already running.");
}
if (!/spawn\(process\.execPath,\s*\["scripts\/start-runtime\.mjs"\]/.test(startDesktop)
    || !/LINGXY_DESKTOP_DISABLE_EMBEDDED_SERVICE\s*=\s*"1"/.test(startDesktop)) {
  throw new Error("Dev desktop launcher must host runtime in Node and disable Electron embedded runtime fallback.");
}
if (!/AbortSignal\.timeout\(5000\)/.test(startDesktop)
    || !/function waitForRuntime\(timeoutMs = 45_000\)/.test(startDesktop)) {
  throw new Error("Dev desktop launcher readiness polling must tolerate slow /health responses before warning.");
}
if (!electronMain.includes("resolveDesktopActorForSender(sender, windows)")
    || /function desktopActorForSender[\s\S]{0,220}return\s+["']desktop_shell["']/.test(electronMain)) {
  throw new Error("desktopActorForSender must delegate to the shared fail-closed actor resolver.");
}
if (!/export const DOCK_SIZE_PX = 48/.test(dockGeometry)
    || !/export const DOCK_EDGE_SNAP_PX = 16/.test(dockGeometry)
    || !/function normalizeDockBounds/.test(dockGeometry)) {
  throw new Error("Dock geometry helper must own fixed size, edge snap, and normalization.");
}

if (!/dock:\s*\{\s*minWidth:\s*DOCK_SIZE_PX,\s*minHeight:\s*DOCK_SIZE_PX,\s*maxWidth:\s*DOCK_SIZE_PX,\s*maxHeight:\s*DOCK_SIZE_PX\s*\}/.test(desktopSettings)) {
  throw new Error("Dock bounds clamp must keep the BrowserWindow fixed at 48x48.");
}

if (!desktopWindowBounds.includes("export function lockWindowRendererZoom")
    || !desktopWindowBounds.includes("setZoomFactor?.(1)")
    || !desktopWindowBounds.includes("setVisualZoomLevelLimits?.(1, 1)")
    || !desktopWindowLifecycle.includes('"zoom-changed"')) {
  throw new Error("Dock renderer zoom must be locked to prevent tiny-window scrollbars.");
}

if (!desktopWindowLifecycle.includes('"dom-ready"')
    || !/DOCK_HUD_SCROLL_LOCK_CSS[\s\S]{0,220}position:\s*fixed\s*!important/.test(desktopWindowBounds)
    || !/canvas#orbCanvas[\s\S]{0,160}width:\s*100%\s*!important/.test(desktopWindowBounds)) {
  throw new Error("Dock scroll lock must be injected early and force viewport-sized HUD content.");
}

if (!/windowId === dockWindowId[\s\S]{0,640}normalizeDockBounds\(tentativeDockBounds, dockDisplay/.test(desktopWindowBounds)
    || !/width:\s*Number\.isFinite\(bounds\.width\)\s*\?\s*Math\.round\(bounds\.width\)\s*:\s*DOCK_SIZE_PX/.test(desktopWindowBounds)
    || !/snap:\s*options\.mode === "move"/.test(desktopWindowBounds)) {
  throw new Error("Dock move bounds must use the shared geometry helper and snap to display edges.");
}

if (!/if \(windowId === "dock"\) return true;/.test(desktopSettings)) {
  throw new Error("Dock always-on-top must not be disabled by stale window preferences.");
}

if (!/if \(windowId === DOCK_WINDOW_ID\) \{[\s\S]{0,180}enforceDockWindowInvariants\(target\)/.test(mainProcessIpc)) {
  throw new Error("Dock resize IPC must repair invariants instead of resizing the fixed HUD.");
}

if (!/const dockBounds = getManagedWindowBounds\(DOCK_WINDOW_ID, dockWin\)/.test(mainProcessIpc)
    || /const dockBounds = dockWin\.getBounds\(\)/.test(mainProcessIpc)) {
  throw new Error("Echo bubble must anchor to dock content bounds, not outer BrowserWindow bounds.");
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
  "uca:project-files-pick",
  "uca:project-files-attach",
  "uca:project-files-remove-index",
  "uca:preview-cache-clear",
  "uca:office-addins-setup",
  "uca:echo-kws-detect",
  "uca:echo-keyword-enroll",
  "uca:echo-wake-profile-update",
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
