export function registerOfficeIpc({
  ipcMain,
  IPC_CHANNELS,
  getServiceBaseUrl,
  desktopActorForSender,
  postDesktopServiceJson,
  requestDesktopServiceJson
}) {
  if (!ipcMain?.handle) throw new TypeError("registerOfficeIpc requires ipcMain.");
  if (!IPC_CHANNELS) throw new TypeError("registerOfficeIpc requires IPC_CHANNELS.");
  if (typeof getServiceBaseUrl !== "function") throw new TypeError("registerOfficeIpc requires getServiceBaseUrl.");
  if (typeof desktopActorForSender !== "function") throw new TypeError("registerOfficeIpc requires desktopActorForSender.");
  if (typeof postDesktopServiceJson !== "function") throw new TypeError("registerOfficeIpc requires postDesktopServiceJson.");
  if (typeof requestDesktopServiceJson !== "function") throw new TypeError("registerOfficeIpc requires requestDesktopServiceJson.");

  ipcMain.handle(IPC_CHANNELS.officeAddinsSetupStatus, async (event) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    try {
      return await requestDesktopServiceJson({
        base,
        actor,
        pathname: "/setup/office-addins/status",
        method: "GET"
      });
    } catch (error) {
      return {
        ok: false,
        error: "office_addins_status_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.officeAddinsSetup, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    try {
      return await postDesktopServiceJson({
        base,
        actor,
        pathname: "/setup/office-addins",
        body: payload ?? {}
      });
    } catch (error) {
      return {
        ok: false,
        error: "office_addins_setup_failed",
        message: error?.message ?? String(error)
      };
    }
  });
}
