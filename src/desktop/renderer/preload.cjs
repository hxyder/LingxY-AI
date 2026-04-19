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
  }
});
