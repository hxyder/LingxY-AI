export function registerDiagnosticsIpc({
  ipcMain,
  IPC_CHANNELS,
  getServiceBaseUrl,
  desktopActorForSender,
  postDesktopServiceJson,
  appendDesktopDiagnosticError,
  normalizePlainObject
} = {}) {
  if (!ipcMain?.handle) throw new Error("ipcMain is required to register diagnostics IPC handlers.");
  if (!IPC_CHANNELS) throw new Error("IPC_CHANNELS is required to register diagnostics IPC handlers.");
  if (typeof getServiceBaseUrl !== "function") throw new Error("getServiceBaseUrl is required.");
  if (typeof desktopActorForSender !== "function") throw new Error("desktopActorForSender is required.");
  if (typeof postDesktopServiceJson !== "function") throw new Error("postDesktopServiceJson is required.");
  if (typeof appendDesktopDiagnosticError !== "function") throw new Error("appendDesktopDiagnosticError is required.");
  if (typeof normalizePlainObject !== "function") throw new Error("normalizePlainObject is required.");

  ipcMain.handle(IPC_CHANNELS.diagnosticBundle, async (event) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    try {
      return await postDesktopServiceJson({
        base,
        actor,
        pathname: "/diagnostics/bundle"
      });
    } catch (error) {
      return {
        ok: false,
        error: "diagnostic_bundle_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.rendererErrorReport, async (event, payload = {}) => {
    await appendDesktopDiagnosticError("renderer_report", null, {
      actor: desktopActorForSender(event.sender),
      payload: normalizePlainObject(payload) ?? {}
    });
    return { ok: true };
  });
}
