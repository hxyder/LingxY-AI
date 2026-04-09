export const WINDOW_IDS = Object.freeze({
  overlay: "overlay",
  console: "console"
});

export const IPC_CHANNELS = Object.freeze({
  shellReady: "uca:shell-ready",
  shellWindowFocused: "uca:shell-window-focused",
  shellStatus: "uca:shell-status",
  shellShowWindow: "uca:shell-show-window",
  shellHideWindow: "uca:shell-hide-window",
  overlayToggle: "uca:overlay-toggle",
  consoleOpen: "uca:console-open",
  shortcutTriggered: "uca:shortcut-triggered",
  contextPreviewRequested: "uca:context-preview-requested"
});

export const DEFAULT_SHORTCUTS = Object.freeze([
  {
    id: "toggle-overlay",
    accelerator: "Ctrl+Shift+Space",
    description: "Open or focus the fixed overlay"
  },
  {
    id: "open-console",
    accelerator: "Ctrl+Shift+O",
    description: "Open the main console workspace"
  },
  {
    id: "toggle-presenter-mode",
    accelerator: "Ctrl+Alt+P",
    description: "Toggle Presenter Mode"
  },
  {
    id: "capture-screenshot",
    accelerator: "Ctrl+Shift+S",
    description: "Capture a screenshot for OCR"
  }
]);

export const DESKTOP_SHELL_MANIFEST = Object.freeze({
  appId: "uca.desktop",
  trayTooltip: "Universal Context Agent",
  windows: [
    {
      id: WINDOW_IDS.overlay,
      title: "UCA Overlay",
      route: "/overlay",
      singleton: true,
      startsHidden: true,
      width: 420,
      height: 580
    },
    {
      id: WINDOW_IDS.console,
      title: "UCA Console",
      route: "/console",
      singleton: true,
      startsHidden: true,
      width: 1280,
      height: 820
    }
  ],
  shortcuts: DEFAULT_SHORTCUTS,
  ipcChannels: Object.values(IPC_CHANNELS)
});
