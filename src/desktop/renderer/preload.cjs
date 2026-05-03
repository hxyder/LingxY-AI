const { contextBridge, ipcRenderer, clipboard, shell, webUtils } = require("electron");
const { promises: fs } = require("node:fs");

contextBridge.exposeInMainWorld("ucaShell", {
  getShellStatus() {
    return ipcRenderer.invoke("uca:shell-status");
  },
  showWindow(windowId) {
    return ipcRenderer.invoke("uca:shell-show-window", windowId);
  },
  hideWindow(windowId) {
    return ipcRenderer.invoke("uca:shell-hide-window", windowId);
  },
  readClipboardText() {
    return clipboard.readText();
  },
  writeClipboardText(text) {
    clipboard.writeText(text ?? "");
  },
  openPath(targetPath) {
    return shell.openPath(targetPath);
  },
  openExternal(url) {
    return shell.openExternal(url);
  },
  showItemInFolder(targetPath) {
    shell.showItemInFolder(targetPath);
  },
  async readTextFile(targetPath, maxChars = 4000) {
    const content = await fs.readFile(targetPath, "utf8");
    if (typeof maxChars !== "number" || maxChars <= 0) {
      return content;
    }
    return content.slice(0, maxChars);
  },
  // Read a binary file (typically an image) as a base64 data URL so the
  // renderer can drop it into an <img src="…"> without needing a file://
  // protocol handler. Caller supplies the mime type (we don't sniff).
  // 5 MB hard cap — the preview pane doesn't need to drag a 20 MB PNG
  // through the v8 heap.
  async readFileAsDataUrl(targetPath, mimeType) {
    const stat = await fs.stat(targetPath);
    if (stat.size > 5 * 1024 * 1024) {
      throw new Error(`file too large for inline preview (${Math.round(stat.size / 1024 / 1024)}MB)`);
    }
    const buffer = await fs.readFile(targetPath);
    return `data:${mimeType ?? "application/octet-stream"};base64,${buffer.toString("base64")}`;
  },
  // UCA-182 Phase 4: pdfjs-dist ships its worker as a .mjs file inside
  // node_modules. The renderer cannot import it directly (CSP / module
  // graph), so the main process resolves the on-disk path and hands
  // back a file:// URL the worker boot script can fetch.
  getPdfWorkerUrl() {
    return ipcRenderer.invoke("uca:get-pdf-worker-url");
  },
  resolveDroppedFilePaths(files) {
    return (files ?? [])
      .map((file) => {
        try {
          return webUtils.getPathForFile(file);
        } catch {
          return "";
        }
      })
      .filter((filePath) => typeof filePath === "string" && filePath.length > 0);
  },
  submitDroppedFiles(filePaths) {
    return ipcRenderer.invoke("uca:shell-submit-dropped-files", filePaths);
  },
  notify(payload) {
    return ipcRenderer.invoke("uca:shell-notify", payload);
  },
  navigateConsole(payload) {
    return ipcRenderer.invoke("uca:shell-navigate-console", payload ?? {});
  },
  onNavigateConsole(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("uca:shell-navigate-console", listener);
    return () => ipcRenderer.removeListener("uca:shell-navigate-console", listener);
  },
  moveWindowBy(windowId, deltaX, deltaY) {
    return ipcRenderer.invoke("uca:shell-move-window-by", { windowId, deltaX, deltaY });
  },
  resizeWindowBy(windowId, deltaWidth, deltaHeight) {
    return ipcRenderer.invoke("uca:shell-resize-window-by", { windowId, deltaWidth, deltaHeight });
  },
  setIgnoreMouseEvents(windowId, ignore, options = {}) {
    return ipcRenderer.invoke("uca:shell-set-ignore-mouse-events", {
      windowId,
      ignore: Boolean(ignore),
      forward: options.forward !== false
    });
  },
  onShortcutTriggered(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("uca:shortcut-triggered", listener);
    return () => ipcRenderer.removeListener("uca:shortcut-triggered", listener);
  },
  onShellReady(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("uca:shell-ready", listener);
    return () => ipcRenderer.removeListener("uca:shell-ready", listener);
  },
  onWindowFocused(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("uca:shell-window-focused", listener);
    return () => ipcRenderer.removeListener("uca:shell-window-focused", listener);
  },
  onOverlayAutoHide(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("uca:overlay-auto-hide", listener);
    return () => ipcRenderer.removeListener("uca:overlay-auto-hide", listener);
  },
  onContextReceived(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("uca:shell-context-received", listener);
    return () => ipcRenderer.removeListener("uca:shell-context-received", listener);
  },
  onClipboardChanged(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("uca:shell-clipboard-changed", listener);
    return () => ipcRenderer.removeListener("uca:shell-clipboard-changed", listener);
  },
  onNotificationReceived(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("uca:shell-notification-received", listener);
    return () => ipcRenderer.removeListener("uca:shell-notification-received", listener);
  },
  setNoteRecordingState(payload) {
    return ipcRenderer.invoke("uca:note-recording-state", payload ?? {});
  },
  getNoteRecordingState() {
    return ipcRenderer.invoke("uca:get-note-recording-state");
  },
  onNoteRecordingState(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("uca:note-recording-state", listener);
    return () => ipcRenderer.removeListener("uca:note-recording-state", listener);
  },
  getDesktopAudioSource() {
    return ipcRenderer.invoke("uca:get-desktop-audio-source");
  },
  getActiveWindowContext(options = {}) {
    return ipcRenderer.invoke("uca:capture-active-window-context", options);
  },
  // ── Shell settings ──
  getSettings() {
    return ipcRenderer.invoke("uca:get-settings");
  },
  setEchoMode(enabled) {
    return ipcRenderer.invoke("uca:set-echo-mode", Boolean(enabled));
  },
  onSettingsChanged(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("uca:shell-settings-changed", listener);
    return () => ipcRenderer.removeListener("uca:shell-settings-changed", listener);
  },
  // ── Dock context menu ──
  showDockMenu() {
    return ipcRenderer.invoke("uca:show-dock-menu");
  },
  // ── Echo mode wake / bubble HUD ──
  sendEchoWake(payload) {
    return ipcRenderer.invoke("uca:echo-wake", payload ?? {});
  },
  onEchoWake(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("uca:echo-wake", listener);
    return () => ipcRenderer.removeListener("uca:echo-wake", listener);
  },
  showEchoBubble(payload) {
    return ipcRenderer.invoke("uca:echo-bubble-show", payload ?? {});
  },
  onEchoBubble(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("uca:echo-bubble-show", listener);
    return () => ipcRenderer.removeListener("uca:echo-bubble-show", listener);
  },
  registerCtrlEnter(tag) {
    return ipcRenderer.invoke("uca:register-ctrl-enter", tag ?? "echo-session");
  },
  unregisterCtrlEnter() {
    return ipcRenderer.invoke("uca:unregister-ctrl-enter");
  },
  onCtrlEnter(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("uca:ctrl-enter", listener);
    return () => ipcRenderer.removeListener("uca:ctrl-enter", listener);
  },
  onEchoSessionEnd(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("uca:echo-session-end", listener);
    return () => ipcRenderer.removeListener("uca:echo-session-end", listener);
  },
  onEchoShortcutWake(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("uca:echo-shortcut-wake", listener);
    return () => ipcRenderer.removeListener("uca:echo-shortcut-wake", listener);
  },
  onStartWakeEnrollment(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("uca:start-wake-enrollment", listener);
    return () => ipcRenderer.removeListener("uca:start-wake-enrollment", listener);
  },
  showPopupCard(payload) {
    return ipcRenderer.invoke("uca:popup-card-show", payload ?? {});
  },
  closePopupCard(cardId, options) {
    return ipcRenderer.invoke("uca:popup-card-close", cardId, options ?? {});
  },
  resolvePopupCard(cardId, meta) {
    return ipcRenderer.invoke("uca:popup-card-resolve", cardId, meta ?? {});
  },
  togglePopupCardPin(cardId, pinned) {
    return ipcRenderer.invoke("uca:popup-card-toggle-pin", cardId, Boolean(pinned));
  },
  resizePopupCard(cardId, height) {
    return ipcRenderer.invoke("uca:popup-card-resize", cardId, Math.max(0, Number(height) || 0));
  },
  onPopupCardInit(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("uca:popup-card-init", listener);
    return () => ipcRenderer.removeListener("uca:popup-card-init", listener);
  },
  onPopupCardResolved(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("uca:popup-card-resolved", listener);
    return () => ipcRenderer.removeListener("uca:popup-card-resolved", listener);
  },

  // UCA-182 Phase 14: dedicated preview window on the right edge of
  // the primary display. Overlay / console invoke showPreviewWindow
  // to surface an artefact or a running tool; the preview window
  // listens for init / delta / committed events.
  showPreviewWindow(payload) {
    return ipcRenderer.invoke("uca:preview-window-show", payload ?? {});
  },
  appendPreviewDelta(payload) {
    return ipcRenderer.invoke("uca:preview-window-append-delta", payload ?? {});
  },
  commitPreviewWindow(payload) {
    return ipcRenderer.invoke("uca:preview-window-commit", payload ?? {});
  },
  closePreviewWindow() {
    return ipcRenderer.invoke("uca:preview-window-close");
  },
  setPreviewWindowAlwaysOnTop(flag) {
    return ipcRenderer.invoke("uca:preview-window-pin", Boolean(flag));
  },
  previewMcpInstall(payload) {
    return ipcRenderer.invoke("uca:mcp-install-preview", payload ?? {});
  },
  runMcpInstall(payload) {
    return ipcRenderer.invoke("uca:mcp-install-run", payload ?? {});
  },
  saveMcpServer(payload) {
    return ipcRenderer.invoke("uca:mcp-server-save", payload ?? {});
  },
  deleteMcpServer(id) {
    return ipcRenderer.invoke("uca:mcp-server-delete", id ?? "");
  },
  toggleMcpServer(payload) {
    return ipcRenderer.invoke("uca:mcp-server-toggle", payload ?? {});
  },
  saveMcpServerConfig(payload) {
    return ipcRenderer.invoke("uca:mcp-server-config", payload ?? {});
  },
  approveApproval(payload) {
    return ipcRenderer.invoke("uca:approval-approve", payload ?? {});
  },
  rejectApproval(payload) {
    return ipcRenderer.invoke("uca:approval-reject", payload ?? {});
  },
  onPreviewWindowInit(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("uca:preview-window-init", listener);
    return () => ipcRenderer.removeListener("uca:preview-window-init", listener);
  },
  onPreviewWindowDelta(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("uca:preview-window-delta", listener);
    return () => ipcRenderer.removeListener("uca:preview-window-delta", listener);
  },
  onPreviewWindowCommitted(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("uca:preview-window-committed", listener);
    return () => ipcRenderer.removeListener("uca:preview-window-committed", listener);
  }
});
