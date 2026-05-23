export function registerBrowserExtensionIpc({
  ipcMain,
  IPC_CHANNELS,
  getServiceBaseUrl,
  desktopActorForSender,
  postDesktopServiceJson,
  requestDesktopServiceJson
}) {
  if (!ipcMain?.handle) throw new TypeError("registerBrowserExtensionIpc requires ipcMain.");
  if (!IPC_CHANNELS) throw new TypeError("registerBrowserExtensionIpc requires IPC_CHANNELS.");
  if (typeof getServiceBaseUrl !== "function") throw new TypeError("registerBrowserExtensionIpc requires getServiceBaseUrl.");
  if (typeof desktopActorForSender !== "function") throw new TypeError("registerBrowserExtensionIpc requires desktopActorForSender.");
  if (typeof postDesktopServiceJson !== "function") throw new TypeError("registerBrowserExtensionIpc requires postDesktopServiceJson.");
  if (typeof requestDesktopServiceJson !== "function") {
    throw new TypeError("registerBrowserExtensionIpc requires requestDesktopServiceJson.");
  }

  ipcMain.handle(IPC_CHANNELS.browserExtensionSetupStatus, async (event) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    try {
      return await requestDesktopServiceJson({
        base,
        actor,
        pathname: "/setup/browser-extension/status",
        method: "GET"
      });
    } catch (error) {
      return {
        ok: false,
        error: "browser_extension_status_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.browserExtensionSetup, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    try {
      return await postDesktopServiceJson({
        base,
        actor,
        pathname: "/setup/browser-extension",
        body: payload ?? {}
      });
    } catch (error) {
      return {
        ok: false,
        error: "browser_extension_setup_failed",
        message: error?.message ?? String(error)
      };
    }
  });
}
