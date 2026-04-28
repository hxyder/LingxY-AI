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

console.log("Desktop shell scaffold verification passed.");
