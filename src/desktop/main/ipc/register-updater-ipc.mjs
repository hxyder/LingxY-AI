export function registerUpdaterIpc({
  ipcMain,
  IPC_CHANNELS,
  updateStrategies = [],
  getAutoUpdaterController,
  patchUpdateStrategy
} = {}) {
  if (!ipcMain?.handle) throw new Error("ipcMain is required to register updater IPC handlers.");
  if (!IPC_CHANNELS) throw new Error("IPC_CHANNELS is required to register updater IPC handlers.");
  if (typeof getAutoUpdaterController !== "function") throw new Error("getAutoUpdaterController is required.");
  if (typeof patchUpdateStrategy !== "function") throw new Error("patchUpdateStrategy is required.");

  ipcMain.handle(IPC_CHANNELS.shellUpdaterStatus, async () => {
    const autoUpdaterController = getAutoUpdaterController();
    if (!autoUpdaterController) return { available: false };
    return { available: true, ...autoUpdaterController.getStatus() };
  });

  ipcMain.handle(IPC_CHANNELS.shellUpdaterSetStrategy, async (_event, payload = {}) => {
    const next = String(payload?.strategy ?? "").toLowerCase();
    if (!updateStrategies.includes(next)) {
      return { ok: false, error: "invalid_strategy" };
    }
    try {
      patchUpdateStrategy(next);
    } catch (err) {
      return { ok: false, error: "config_persist_failed", message: err?.message };
    }
    return { ok: true, strategy: next };
  });

  ipcMain.handle(IPC_CHANNELS.shellUpdaterCheckNow, async () => {
    const autoUpdaterController = getAutoUpdaterController();
    if (!autoUpdaterController) return { ok: false, error: "updater_unavailable" };
    const result = await autoUpdaterController.checkForUpdates({ trigger: "user" });
    return { ok: true, result };
  });

  ipcMain.handle(IPC_CHANNELS.shellUpdaterApply, async (_event, payload = {}) => {
    const autoUpdaterController = getAutoUpdaterController();
    if (!autoUpdaterController) return { ok: false, error: "updater_unavailable" };
    try {
      autoUpdaterController.applyUpdate({
        silent: Boolean(payload?.silent),
        restart: payload?.restart !== false
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message ?? "apply_failed" };
    }
  });
}
