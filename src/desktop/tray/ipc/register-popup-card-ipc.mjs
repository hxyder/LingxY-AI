export function registerPopupCardIpc({
  ipcMain,
  IPC_CHANNELS,
  popupCardManager,
  onResolve
}) {
  if (!ipcMain?.handle) throw new TypeError("registerPopupCardIpc requires ipcMain.");
  if (!IPC_CHANNELS) throw new TypeError("registerPopupCardIpc requires IPC_CHANNELS.");
  if (!popupCardManager) throw new TypeError("registerPopupCardIpc requires popupCardManager.");
  if (typeof popupCardManager.showCard !== "function") throw new TypeError("registerPopupCardIpc requires popupCardManager.showCard.");
  if (typeof popupCardManager.closeCard !== "function") throw new TypeError("registerPopupCardIpc requires popupCardManager.closeCard.");
  if (typeof popupCardManager.togglePin !== "function") throw new TypeError("registerPopupCardIpc requires popupCardManager.togglePin.");
  if (typeof popupCardManager.resizeCard !== "function") throw new TypeError("registerPopupCardIpc requires popupCardManager.resizeCard.");
  if (typeof popupCardManager.resolveCard !== "function") throw new TypeError("registerPopupCardIpc requires popupCardManager.resolveCard.");

  ipcMain.handle(IPC_CHANNELS.popupCardShow, (_event, payload = {}) => popupCardManager.showCard(payload));
  ipcMain.handle(IPC_CHANNELS.popupCardClose, (_event, cardId, options = {}) => {
    return popupCardManager.closeCard(cardId, options?.reason ?? "user");
  });
  ipcMain.handle(IPC_CHANNELS.popupCardTogglePin, (_event, cardId, pinned) => popupCardManager.togglePin(cardId, pinned));
  ipcMain.handle(IPC_CHANNELS.popupCardResize, (_event, cardId, height) => popupCardManager.resizeCard(cardId, height));
  ipcMain.handle(IPC_CHANNELS.popupCardResolve, async (_event, cardId, meta = {}) => {
    const info = popupCardManager.resolveCard(cardId, meta);
    if (!info.ok) return { ok: false };
    if (typeof onResolve === "function") {
      try { await onResolve(info.card); } catch { /* main-process caller owns logging */ }
    }
    return { ok: true };
  });
}
