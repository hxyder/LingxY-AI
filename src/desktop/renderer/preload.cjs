const { contextBridge, ipcRenderer, clipboard, shell } = require("electron");

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
  openPath(targetPath) {
    return shell.openPath(targetPath);
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
