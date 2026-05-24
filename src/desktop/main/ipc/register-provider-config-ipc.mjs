import { normalizePlainObject } from "../../shared/desktop-payload-normalizers.mjs";

function normalizeProviderConfigPayload(payload = {}) {
  return normalizePlainObject(payload) ?? {};
}

function normalizeProviderId(id) {
  return typeof id === "string" ? id.trim() : "";
}

function normalizeCodeCliAdapterPayload(payload = {}) {
  return normalizePlainObject(payload) ?? {};
}

function normalizeCodeCliAdapterId(id) {
  return typeof id === "string" ? id.trim() : "";
}

export function registerProviderConfigIpc({
  ipcMain,
  IPC_CHANNELS,
  getServiceBaseUrl,
  desktopActorForSender,
  postDesktopServiceJson,
  requestDesktopServiceJson
}) {
  if (!ipcMain?.handle) throw new TypeError("registerProviderConfigIpc requires ipcMain.");
  if (!IPC_CHANNELS) throw new TypeError("registerProviderConfigIpc requires IPC_CHANNELS.");
  if (typeof getServiceBaseUrl !== "function") throw new TypeError("registerProviderConfigIpc requires getServiceBaseUrl.");
  if (typeof desktopActorForSender !== "function") throw new TypeError("registerProviderConfigIpc requires desktopActorForSender.");
  if (typeof postDesktopServiceJson !== "function") throw new TypeError("registerProviderConfigIpc requires postDesktopServiceJson.");
  if (typeof requestDesktopServiceJson !== "function") throw new TypeError("registerProviderConfigIpc requires requestDesktopServiceJson.");

  ipcMain.handle(IPC_CHANNELS.providerList, async (event) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    try {
      return await requestDesktopServiceJson({
        base,
        method: "GET",
        actor,
        pathname: "/config/providers"
      });
    } catch (error) {
      return {
        ok: false,
        error: "provider_list_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.providerSave, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    try {
      return await postDesktopServiceJson({
        base,
        actor,
        pathname: "/config/providers",
        body: normalizeProviderConfigPayload(payload)
      });
    } catch (error) {
      return {
        ok: false,
        error: "provider_save_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.providerDelete, async (event, id = "") => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    const providerId = normalizeProviderId(id);
    if (!providerId) {
      return { ok: false, error: "provider_id_required", message: "Provider id is required." };
    }
    try {
      return await requestDesktopServiceJson({
        base,
        method: "DELETE",
        actor,
        pathname: `/config/providers/${encodeURIComponent(providerId)}`
      });
    } catch (error) {
      return {
        ok: false,
        error: "provider_delete_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.onboardingSuggestionUpdate, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    const suggestionId = `${payload?.id ?? ""}`.trim();
    if (!suggestionId) {
      return { ok: false, error: "suggestion_id_required", message: "Suggestion id is required." };
    }
    try {
      return await requestDesktopServiceJson({
        base,
        method: "PATCH",
        actor,
        pathname: `/config/onboarding/suggestions/${encodeURIComponent(suggestionId)}`,
        body: { status: payload?.status ?? "dismissed" }
      });
    } catch (error) {
      return {
        ok: false,
        error: "onboarding_suggestion_update_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.codeCliAdapterSave, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    try {
      return await postDesktopServiceJson({
        base,
        actor,
        pathname: "/config/code-cli/adapters",
        body: normalizeCodeCliAdapterPayload(payload)
      });
    } catch (error) {
      return {
        ok: false,
        error: "code_cli_adapter_save_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.codeCliAdapterDelete, async (event, id = "") => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    const adapterId = normalizeCodeCliAdapterId(id);
    if (!adapterId) {
      return { ok: false, error: "code_cli_adapter_id_required", message: "Code CLI adapter id is required." };
    }
    try {
      return await requestDesktopServiceJson({
        base,
        method: "DELETE",
        actor,
        pathname: `/config/code-cli/adapters/${encodeURIComponent(adapterId)}`
      });
    } catch (error) {
      return {
        ok: false,
        error: "code_cli_adapter_delete_failed",
        message: error?.message ?? String(error)
      };
    }
  });
}
