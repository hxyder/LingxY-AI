import { normalizePlainObject } from "../../tray/desktop-payload-normalizers.mjs";

function normalizeSecurityStatePatch(payload = {}) {
  return normalizePlainObject(payload) ?? {};
}

function normalizeBudgetUpdatePayload(payload = {}) {
  const limits = normalizePlainObject(payload.limits ?? payload) ?? {};
  return { limits };
}

export function registerAdminIpc({
  ipcMain,
  IPC_CHANNELS,
  getServiceBaseUrl,
  desktopActorForSender,
  postDesktopServiceJson
}) {
  if (!ipcMain?.handle) throw new TypeError("registerAdminIpc requires ipcMain.");
  if (!IPC_CHANNELS) throw new TypeError("registerAdminIpc requires IPC_CHANNELS.");
  if (typeof getServiceBaseUrl !== "function") throw new TypeError("registerAdminIpc requires getServiceBaseUrl.");
  if (typeof desktopActorForSender !== "function") throw new TypeError("registerAdminIpc requires desktopActorForSender.");
  if (typeof postDesktopServiceJson !== "function") throw new TypeError("registerAdminIpc requires postDesktopServiceJson.");

  ipcMain.handle(IPC_CHANNELS.securityStateUpdate, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    try {
      return await postDesktopServiceJson({
        base,
        actor,
        pathname: "/security/state",
        body: normalizeSecurityStatePatch(payload)
      });
    } catch (error) {
      return {
        ok: false,
        error: "security_state_update_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.budgetUpdate, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    try {
      return await postDesktopServiceJson({
        base,
        actor,
        pathname: "/budget",
        body: normalizeBudgetUpdatePayload(payload)
      });
    } catch (error) {
      return {
        ok: false,
        error: "budget_update_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.exportBundle, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    const params = new URLSearchParams();
    if (payload?.includeTaskEvents === false) params.set("includeTaskEvents", "false");
    const suffix = params.toString() ? `?${params}` : "";
    try {
      return await postDesktopServiceJson({
        base,
        actor,
        pathname: `/export/bundle${suffix}`
      });
    } catch (error) {
      return {
        ok: false,
        error: "export_bundle_failed",
        message: error?.message ?? String(error)
      };
    }
  });
}
