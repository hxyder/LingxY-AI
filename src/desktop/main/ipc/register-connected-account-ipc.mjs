import { normalizePlainObject } from "../../shared/desktop-payload-normalizers.mjs";

function normalizeConnectedAccountId(id) {
  return typeof id === "string" ? id.trim() : "";
}

function normalizeConnectorAccountType(type) {
  const value = typeof type === "string" ? type.trim() : "";
  return value === "microsoft" || value === "google" ? value : "";
}

function normalizeConnectedAccountRenamePayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  return {
    accountId: normalizeConnectedAccountId(source.accountId ?? source.account_id ?? source.id),
    displayName: `${source.displayName ?? source.display_name ?? ""}`.trim()
  };
}

function normalizeConnectedAccountDefaultPayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  return {
    accountId: normalizeConnectedAccountId(source.accountId ?? source.account_id ?? source.id),
    purpose: `${source.purpose ?? ""}`.trim()
  };
}

function normalizeConnectorAccountConfigPayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  const config = normalizePlainObject(source.config ?? source.body ?? source.payload) ?? {};
  const body = {};
  if (typeof config.clientId === "string") body.clientId = config.clientId.trim();
  if (typeof config.clientSecret === "string") body.clientSecret = config.clientSecret.trim();
  return {
    type: normalizeConnectorAccountType(source.type ?? source.provider),
    body
  };
}

export function registerConnectedAccountIpc({
  ipcMain,
  IPC_CHANNELS,
  getServiceBaseUrl,
  desktopActorForSender,
  requestDesktopServiceJson
}) {
  if (!ipcMain?.handle) throw new TypeError("registerConnectedAccountIpc requires ipcMain.");
  if (!IPC_CHANNELS) throw new TypeError("registerConnectedAccountIpc requires IPC_CHANNELS.");
  if (typeof getServiceBaseUrl !== "function") throw new TypeError("registerConnectedAccountIpc requires getServiceBaseUrl.");
  if (typeof desktopActorForSender !== "function") throw new TypeError("registerConnectedAccountIpc requires desktopActorForSender.");
  if (typeof requestDesktopServiceJson !== "function") throw new TypeError("registerConnectedAccountIpc requires requestDesktopServiceJson.");

  ipcMain.handle(IPC_CHANNELS.connectedAccountRename, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    const body = normalizeConnectedAccountRenamePayload(payload);
    if (!body.accountId) {
      return { ok: false, error: "connected_account_id_required", message: "Connected account id is required." };
    }
    try {
      return await requestDesktopServiceJson({
        base,
        method: "PATCH",
        actor,
        pathname: `/connectors/connected-accounts/${encodeURIComponent(body.accountId)}`,
        body: { displayName: body.displayName }
      });
    } catch (error) {
      return {
        ok: false,
        error: "connected_account_rename_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.connectedAccountDefaultSet, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    const body = normalizeConnectedAccountDefaultPayload(payload);
    if (!body.accountId || !body.purpose) {
      return {
        ok: false,
        error: "connected_account_default_required",
        message: "Connected account id and default purpose are required."
      };
    }
    try {
      return await requestDesktopServiceJson({
        base,
        method: "PATCH",
        actor,
        pathname: `/connectors/connected-accounts/${encodeURIComponent(body.accountId)}/defaults`,
        body: { purpose: body.purpose }
      });
    } catch (error) {
      return {
        ok: false,
        error: "connected_account_default_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.connectedAccountDisconnect, async (event, accountId = "") => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    const id = normalizeConnectedAccountId(accountId);
    if (!id) {
      return { ok: false, error: "connected_account_id_required", message: "Connected account id is required." };
    }
    try {
      return await requestDesktopServiceJson({
        base,
        method: "DELETE",
        actor,
        pathname: `/connectors/connected-accounts/${encodeURIComponent(id)}`
      });
    } catch (error) {
      return {
        ok: false,
        error: "connected_account_disconnect_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.connectorAccountDisconnect, async (event, type = "") => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    const connectorType = normalizeConnectorAccountType(type);
    if (!connectorType) {
      return { ok: false, error: "connector_account_type_required", message: "Connector account type is required." };
    }
    try {
      return await requestDesktopServiceJson({
        base,
        method: "DELETE",
        actor,
        pathname: `/connectors/accounts/${encodeURIComponent(connectorType)}`
      });
    } catch (error) {
      return {
        ok: false,
        error: "connector_account_disconnect_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.connectorAccountConfigSave, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    const { type, body } = normalizeConnectorAccountConfigPayload(payload);
    if (!type) {
      return { ok: false, error: "connector_account_type_required", message: "Connector account type is required." };
    }
    try {
      return await requestDesktopServiceJson({
        base,
        method: "PATCH",
        actor,
        pathname: `/connectors/accounts/${encodeURIComponent(type)}/config`,
        body
      });
    } catch (error) {
      return {
        ok: false,
        error: "connector_account_config_save_failed",
        message: error?.message ?? String(error)
      };
    }
  });
}
