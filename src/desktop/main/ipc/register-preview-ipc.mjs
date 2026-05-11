export function registerPreviewIpc({
  ipcMain,
  IPC_CHANNELS,
  sendToPreview,
  getPreviewWindow,
  hidePreviewWindow,
  setPreviewWindowPinned
} = {}) {
  if (!ipcMain?.handle) throw new Error("ipcMain is required to register preview IPC handlers.");
  if (!IPC_CHANNELS) throw new Error("IPC_CHANNELS is required to register preview IPC handlers.");
  if (typeof sendToPreview !== "function") throw new Error("sendToPreview is required.");
  if (typeof getPreviewWindow !== "function") throw new Error("getPreviewWindow is required.");
  if (typeof hidePreviewWindow !== "function") throw new Error("hidePreviewWindow is required.");
  if (typeof setPreviewWindowPinned !== "function") throw new Error("setPreviewWindowPinned is required.");

  ipcMain.handle(IPC_CHANNELS.previewWindowShow, (_event, payload = {}) => {
    sendToPreview(IPC_CHANNELS.previewWindowInit, payload);
    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.previewWindowAppendDelta, (_event, payload = {}) => {
    sendToPreview(IPC_CHANNELS.previewWindowDelta, payload, { coalesce: true });
    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.previewWindowCommit, (_event, payload = {}) => {
    sendToPreview(IPC_CHANNELS.previewWindowCommitted, payload);
    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.previewWindowClose, () => {
    hidePreviewWindow();
    return { ok: true };
  });

  ipcMain.handle("uca:preview-window-pin", (_event, flag) => setPreviewWindowPinned(flag));

  return {
    openPreviewWindowForSmoke(payload = {}) {
      sendToPreview(IPC_CHANNELS.previewWindowInit, payload);
      return getPreviewWindow();
    }
  };
}
