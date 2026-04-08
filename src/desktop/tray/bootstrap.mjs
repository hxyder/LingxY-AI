import { DESKTOP_SHELL_MANIFEST, IPC_CHANNELS } from "../shared/manifest.mjs";

export function validateShellManifest(manifest = DESKTOP_SHELL_MANIFEST) {
  if (!manifest.appId || !manifest.trayTooltip) {
    throw new Error("Desktop shell manifest is missing top-level identity fields.");
  }

  if (!Array.isArray(manifest.windows) || manifest.windows.length < 2) {
    throw new Error("Desktop shell manifest must define at least overlay and console windows.");
  }

  const windowIds = new Set(manifest.windows.map((windowDef) => windowDef.id));
  for (const requiredId of ["overlay", "console"]) {
    if (!windowIds.has(requiredId)) {
      throw new Error(`Missing required window definition: ${requiredId}`);
    }
  }

  if (!manifest.ipcChannels.includes(IPC_CHANNELS.overlayToggle)) {
    throw new Error("Desktop shell manifest must expose overlay toggle IPC.");
  }

  return true;
}

export function buildDesktopShellBootstrapState() {
  validateShellManifest();

  return {
    manifest: DESKTOP_SHELL_MANIFEST,
    lifecycle: {
      trayReady: false,
      windowsCreated: false,
      shortcutsRegistered: false,
      serviceBridgeAttached: false
    },
    nextActions: [
      "create tray host",
      "create hidden overlay window",
      "create hidden console window",
      "register global shortcuts",
      "attach service bridge"
    ]
  };
}
