import { buildDesktopShellBootstrapState } from "../src/desktop/tray/bootstrap.mjs";
import { createDesktopRuntimeHost } from "../src/desktop/tray/runtime-host.mjs";
import { createOverlayViewModel } from "../src/desktop/overlay/view-model.mjs";
import { createConsoleViewModel } from "../src/desktop/console/view-model.mjs";

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
if (!dockWindow || dockWindow.width !== 52 || dockWindow.height !== 52) {
  throw new Error("Dock window must use the reduced 52x52 hitbox.");
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
  "uca:routing-config-update",
  "uca:output-config-update",
  "uca:feature-config-update",
  "uca:email-settings-update",
  "uca:email-account-save",
  "uca:email-account-delete",
  "uca:email-digest-check",
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
