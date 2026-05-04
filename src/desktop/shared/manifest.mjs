export const WINDOW_IDS = Object.freeze({
  dock: "dock",
  overlay: "overlay",
  console: "console",
  notification: "notification",
  echoBubble: "echo-bubble",
  popupCard: "popup-card",
  preview: "preview"
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
  shellResizeWindowBy: "uca:shell-resize-window-by",
  shellSetIgnoreMouseEvents: "uca:shell-set-ignore-mouse-events",
  shellClipboardChanged: "uca:shell-clipboard-changed",
  shellNavigateConsole: "uca:shell-navigate-console",
  rendererErrorReport: "uca:renderer-error",
  overlayToggle: "uca:overlay-toggle",
  // Sent main → overlay renderer when the overlay window blurs and focus
  // has left the application entirely. The renderer runs the same
  // dismiss flow as the X button (stop voice, fold inline panels, etc.).
  overlayAutoHide: "uca:overlay-auto-hide",
  consoleOpen: "uca:console-open",
  shortcutTriggered: "uca:shortcut-triggered",
  contextPreviewRequested: "uca:context-preview-requested",
  popupCardShow: "uca:popup-card-show",
  popupCardClose: "uca:popup-card-close",
  popupCardResolve: "uca:popup-card-resolve",
  popupCardInit: "uca:popup-card-init",
  popupCardTogglePin: "uca:popup-card-toggle-pin",
  popupCardResolved: "uca:popup-card-resolved",
  popupCardResize: "uca:popup-card-resize",
  // UCA-182 Phase 14: dedicated preview BrowserWindow anchored to
  // the right edge of the primary display. The overlay chat window
  // no longer hosts the preview panel.
  previewWindowShow: "uca:preview-window-show",
  previewWindowAppendDelta: "uca:preview-window-append-delta",
  previewWindowCommit: "uca:preview-window-commit",
  previewWindowClose: "uca:preview-window-close",
  previewWindowInit: "uca:preview-window-init",
  previewWindowDelta: "uca:preview-window-delta",
  previewWindowCommitted: "uca:preview-window-committed",
  mcpInstallPreview: "uca:mcp-install-preview",
  mcpInstallRun: "uca:mcp-install-run",
  mcpServerSave: "uca:mcp-server-save",
  mcpServerDelete: "uca:mcp-server-delete",
  mcpServerToggle: "uca:mcp-server-toggle",
  mcpServerConfig: "uca:mcp-server-config",
  approvalApprove: "uca:approval-approve",
  approvalReject: "uca:approval-reject",
  securityStateUpdate: "uca:security-state-update",
  budgetUpdate: "uca:budget-update",
  exportBundle: "uca:export-bundle",
  diagnosticBundle: "uca:diagnostic-bundle",
  scheduleCreate: "uca:schedule-create",
  scheduleUpdate: "uca:schedule-update",
  scheduleDelete: "uca:schedule-delete",
  scheduleRun: "uca:schedule-run",
  templateSave: "uca:template-save",
  templateImport: "uca:template-import",
  templateDelete: "uca:template-delete",
  dagResume: "uca:dag-resume",
  providerSave: "uca:provider-save",
  providerDelete: "uca:provider-delete",
  onboardingSuggestionUpdate: "uca:onboarding-suggestion-update",
  codeCliAdapterSave: "uca:code-cli-adapter-save",
  codeCliAdapterDelete: "uca:code-cli-adapter-delete",
  skillRegistrySave: "uca:skill-registry-save",
  skillRegistryDelete: "uca:skill-registry-delete",
  autoSkillSave: "uca:auto-skill-save",
  skillMarkdownWrite: "uca:skill-markdown-write",
  routingConfigUpdate: "uca:routing-config-update",
  outputConfigUpdate: "uca:output-config-update",
  featureConfigUpdate: "uca:feature-config-update",
  emailSettingsUpdate: "uca:email-settings-update",
  emailAccountSave: "uca:email-account-save",
  emailAccountDelete: "uca:email-account-delete",
  emailDigestCheck: "uca:email-digest-check",
  notesSave: "uca:notes-save",
  noteUpsert: "uca:note-upsert",
  noteDelete: "uca:note-delete",
  noteRestore: "uca:note-restore",
  noteAppendChip: "uca:note-append-chip",
  projectStoreSave: "uca:project-store-save",
  previewCacheClear: "uca:preview-cache-clear",
  officeAddinsSetup: "uca:office-addins-setup",
  echoKwsDetect: "uca:echo-kws-detect",
  echoKeywordEnroll: "uca:echo-keyword-enroll",
  noteTranscribe: "uca:note-transcribe",
  noteTranscribeStream: "uca:note-transcribe-stream",
  noteTranscribeStreamEvent: "uca:note-transcribe-stream-event",
  connectedAccountRename: "uca:connected-account-rename",
  connectedAccountDefaultSet: "uca:connected-account-default-set",
  connectedAccountDisconnect: "uca:connected-account-disconnect",
  connectorAccountDisconnect: "uca:connector-account-disconnect",
  connectorAccountConfigSave: "uca:connector-account-config-save",
  taskCancel: "uca:task-cancel",
  taskRetry: "uca:task-retry",
  taskDelete: "uca:task-delete",
  taskRestore: "uca:task-restore"
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
    id: "note-wake",
    accelerator: "Ctrl+Shift+N",
    description: "Open overlay and start voice-note recording (mic + system audio) immediately"
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
  trayTooltip: "LingxY",
  windows: [
    {
      id: WINDOW_IDS.dock,
      title: "LingxY Dock",
      route: "/dock",
      singleton: true,
      startsHidden: false,
      // The dock content bounds stay exactly 48x48 so the user can drag the
      // orb fully into a screen edge/corner without invisible padding. The
      // renderer uses viewport-relative sizing so page zoom cannot create
      // scrollbars inside the tiny HUD window.
      width: 48,
      height: 48,
      locksRendererZoom: true
    },
    {
      id: WINDOW_IDS.overlay,
      title: "LingxY Overlay",
      route: "/overlay",
      singleton: true,
      startsHidden: true,
      width: 600,
      height: 520
    },
    {
      id: WINDOW_IDS.console,
      title: "LingxY Console",
      route: "/console",
      singleton: true,
      startsHidden: true,
      width: 1280,
      height: 820
    },
    // UCA-182 Phase 8: notification window retired. All in-app toasts
    // now go through the popup-card stack (see popup-card-manager.mjs).
    // The WINDOW_IDS.notification constant is retained for backward
    // compatibility with any remaining references; nothing registers
    // or shows a window with that id anymore.
    {
      id: WINDOW_IDS.echoBubble,
      title: "LingxY Echo Bubble",
      route: "/echo-bubble",
      singleton: true,
      startsHidden: true,
      width: 260,
      height: 64
    }
  ],
  shortcuts: DEFAULT_SHORTCUTS,
  ipcChannels: Object.values(IPC_CHANNELS)
});
