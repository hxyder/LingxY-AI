export const WINDOW_IDS = Object.freeze({
  dock: "dock",
  overlay: "overlay",
  console: "console",
  notification: "notification"
});

export const IPC_CHANNELS = Object.freeze({
  shellReady: "uca:shell-ready",
  shellWindowFocused: "uca:shell-window-focused",
  shellContextReceived: "uca:shell-context-received",
  shellStatus: "uca:shell-status",
  shellShowWindow: "uca:shell-show-window",
  shellHideWindow: "uca:shell-hide-window",
  shellSubmitDroppedFiles: "uca:shell-submit-dropped-files",
  shellNotify: "uca:shell-notify",
  shellNotificationReceived: "uca:shell-notification-received",
  shellMoveWindowBy: "uca:shell-move-window-by",
  shellClipboardChanged: "uca:shell-clipboard-changed",
  shellNavigateConsole: "uca:shell-navigate-console",
  overlayToggle: "uca:overlay-toggle",
  consoleOpen: "uca:console-open",
  shortcutTriggered: "uca:shortcut-triggered",
  contextPreviewRequested: "uca:context-preview-requested"
});

export const DEFAULT_SHORTCUTS = Object.freeze([
  {
    id: "toggle-overlay",
    accelerator: "Ctrl+Shift+U",
    description: "Open or focus the fixed overlay (no auto-capture)"
  },
  {
    id: "capture-and-ask",
    accelerator: "Ctrl+Shift+Space",
    description: "Capture current selection or active file, then open overlay"
  },
  {
    id: "voice-wake",
    accelerator: "Ctrl+Shift+V",
    description: "Open overlay and start voice input immediately"
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
      id: WINDOW_IDS.dock,
      title: "UCA Dock",
      route: "/dock",
      singleton: true,
      startsHidden: false,
      width: 64,
      height: 64
    },
    {
      id: WINDOW_IDS.overlay,
      title: "UCA Overlay",
      route: "/overlay",
      singleton: true,
      startsHidden: true,
      width: 600,
      height: 520
    },
    {
      id: WINDOW_IDS.console,
      title: "UCA Console",
      route: "/console",
      singleton: true,
      startsHidden: true,
      width: 1280,
      height: 820
    },
    {
      id: WINDOW_IDS.notification,
      title: "UCA Notification",
      route: "/notification",
      singleton: true,
      startsHidden: true,
      width: 360,
      height: 132
    }
  ],
  shortcuts: DEFAULT_SHORTCUTS,
  ipcChannels: Object.values(IPC_CHANNELS)
});
