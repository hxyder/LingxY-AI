import { normalizePlainObject } from "../desktop-payload-normalizers.mjs";

function normalizeRuntimeConfigPayload(payload = {}) {
  return normalizePlainObject(payload) ?? {};
}

export function registerRuntimeConfigIpc({
  ipcMain,
  IPC_CHANNELS,
  getServiceBaseUrl,
  desktopActorForSender,
  postDesktopServiceJson
}) {
  if (!ipcMain?.handle) throw new TypeError("registerRuntimeConfigIpc requires ipcMain.");
  if (!IPC_CHANNELS) throw new TypeError("registerRuntimeConfigIpc requires IPC_CHANNELS.");
  if (typeof getServiceBaseUrl !== "function") throw new TypeError("registerRuntimeConfigIpc requires getServiceBaseUrl.");
  if (typeof desktopActorForSender !== "function") throw new TypeError("registerRuntimeConfigIpc requires desktopActorForSender.");
  if (typeof postDesktopServiceJson !== "function") throw new TypeError("registerRuntimeConfigIpc requires postDesktopServiceJson.");

  ipcMain.handle(IPC_CHANNELS.routingConfigUpdate, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    try {
      return await postDesktopServiceJson({
        base,
        actor,
        pathname: "/config/routing",
        body: normalizeRuntimeConfigPayload(payload)
      });
    } catch (error) {
      return {
        ok: false,
        error: "routing_config_update_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.outputConfigUpdate, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    try {
      return await postDesktopServiceJson({
        base,
        actor,
        pathname: "/config/output",
        body: normalizeRuntimeConfigPayload(payload)
      });
    } catch (error) {
      return {
        ok: false,
        error: "output_config_update_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.featureConfigUpdate, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    try {
      return await postDesktopServiceJson({
        base,
        actor,
        pathname: "/config/features",
        body: normalizeRuntimeConfigPayload(payload)
      });
    } catch (error) {
      return {
        ok: false,
        error: "feature_config_update_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.emailSettingsUpdate, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    try {
      return await postDesktopServiceJson({
        base,
        actor,
        pathname: "/config/email/settings",
        body: normalizeRuntimeConfigPayload(payload)
      });
    } catch (error) {
      return {
        ok: false,
        error: "email_settings_update_failed",
        message: error?.message ?? String(error)
      };
    }
  });
}
