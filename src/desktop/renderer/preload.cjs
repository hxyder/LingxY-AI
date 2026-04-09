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
  }
});
