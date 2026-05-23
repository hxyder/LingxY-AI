import { normalizePlainObject } from "../../shared/desktop-payload-normalizers.mjs";

function normalizeEmailAccountPayload(payload = {}) {
  return normalizePlainObject(payload) ?? {};
}

function normalizeEmailAccountId(id) {
  return typeof id === "string" ? id.trim() : "";
}

function normalizeEmailDigestCheckPayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  return {
    force: source.force === true
  };
}

export function registerEmailIpc({
  ipcMain,
  IPC_CHANNELS,
  getServiceBaseUrl,
  desktopActorForSender,
  postDesktopServiceJson,
  requestDesktopServiceJson
}) {
  if (!ipcMain?.handle) throw new TypeError("registerEmailIpc requires ipcMain.");
  if (!IPC_CHANNELS) throw new TypeError("registerEmailIpc requires IPC_CHANNELS.");
  if (typeof getServiceBaseUrl !== "function") throw new TypeError("registerEmailIpc requires getServiceBaseUrl.");
  if (typeof desktopActorForSender !== "function") throw new TypeError("registerEmailIpc requires desktopActorForSender.");
  if (typeof postDesktopServiceJson !== "function") throw new TypeError("registerEmailIpc requires postDesktopServiceJson.");
  if (typeof requestDesktopServiceJson !== "function") throw new TypeError("registerEmailIpc requires requestDesktopServiceJson.");

  ipcMain.handle(IPC_CHANNELS.emailAccountSave, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    try {
      return await postDesktopServiceJson({
        base,
        actor,
        pathname: "/config/email/accounts",
        body: normalizeEmailAccountPayload(payload)
      });
    } catch (error) {
      return {
        ok: false,
        error: "email_account_save_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.emailAccountDelete, async (event, accountId = "") => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    const id = normalizeEmailAccountId(accountId);
    if (!id) {
      return { ok: false, error: "email_account_id_required", message: "Email account id is required." };
    }
    try {
      return await requestDesktopServiceJson({
        base,
        method: "DELETE",
        actor,
        pathname: `/config/email/accounts/${encodeURIComponent(id)}`
      });
    } catch (error) {
      return {
        ok: false,
        error: "email_account_delete_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.emailDigestCheck, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    try {
      return await postDesktopServiceJson({
        base,
        actor,
        pathname: "/email/digest/check",
        body: normalizeEmailDigestCheckPayload(payload)
      });
    } catch (error) {
      return {
        ok: false,
        error: "email_digest_check_failed",
        message: error?.message ?? String(error)
      };
    }
  });
}
