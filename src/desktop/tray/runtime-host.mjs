import { buildDesktopShellBootstrapState, validateShellManifest } from "./bootstrap.mjs";

export function createDesktopRuntimeHost({
  serviceBaseUrl = "http://127.0.0.1:4310",
  entryPoint = "src/desktop/tray/electron-main.mjs"
} = {}) {
  const bootstrap = buildDesktopShellBootstrapState();
  const windows = new Map(bootstrap.manifest.windows.map((windowDef) => [windowDef.id, {
    ...windowDef,
    visible: !windowDef.startsHidden
  }]));

  validateShellManifest(bootstrap.manifest);

  return {
    manifest: bootstrap.manifest,
    entryPoint,
    serviceBaseUrl,
    lifecycle: {
      trayReady: false,
      windowsCreated: false,
      shortcutsRegistered: false,
      serviceBridgeAttached: false
    },
    start() {
      this.lifecycle.trayReady = true;
      this.lifecycle.windowsCreated = true;
      this.lifecycle.shortcutsRegistered = true;
      this.lifecycle.serviceBridgeAttached = true;
      return {
        ...this.lifecycle,
        windowCount: windows.size
      };
    },
    stop() {
      for (const windowState of windows.values()) {
        windowState.visible = false;
      }
      this.lifecycle.trayReady = false;
      this.lifecycle.windowsCreated = false;
      this.lifecycle.shortcutsRegistered = false;
      this.lifecycle.serviceBridgeAttached = false;
      return { ...this.lifecycle };
    },
    openWindow(windowId) {
      const windowState = windows.get(windowId);
      if (!windowState) {
        throw new Error(`Unknown window: ${windowId}`);
      }
      windowState.visible = true;
      return { ...windowState };
    },
    getWindow(windowId) {
      const windowState = windows.get(windowId);
      return windowState ? { ...windowState } : null;
    }
  };
}
