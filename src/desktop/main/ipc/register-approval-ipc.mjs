export function registerApprovalIpc({
  ipcMain,
  IPC_CHANNELS,
  getServiceBaseUrl,
  desktopActorForSender,
  requestDesktopServiceJson,
  normalizeApprovalDecisionPayload,
  buildApprovalDecisionBody
}) {
  if (!ipcMain?.handle) throw new TypeError("registerApprovalIpc requires ipcMain.");
  if (!IPC_CHANNELS) throw new TypeError("registerApprovalIpc requires IPC_CHANNELS.");
  if (typeof getServiceBaseUrl !== "function") throw new TypeError("registerApprovalIpc requires getServiceBaseUrl.");
  if (typeof desktopActorForSender !== "function") throw new TypeError("registerApprovalIpc requires desktopActorForSender.");
  if (typeof requestDesktopServiceJson !== "function") throw new TypeError("registerApprovalIpc requires requestDesktopServiceJson.");
  if (typeof normalizeApprovalDecisionPayload !== "function") {
    throw new TypeError("registerApprovalIpc requires normalizeApprovalDecisionPayload.");
  }
  if (typeof buildApprovalDecisionBody !== "function") {
    throw new TypeError("registerApprovalIpc requires buildApprovalDecisionBody.");
  }

  ipcMain.handle(IPC_CHANNELS.approvalApprove, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const body = normalizeApprovalDecisionPayload(payload);
    if (!body.approvalId) {
      return { ok: false, error: "approval_id_required", message: "Approval id is required." };
    }
    const actor = desktopActorForSender(event.sender);
    try {
      return await requestDesktopServiceJson({
        base,
        method: "POST",
        actor,
        pathname: `/approvals/${encodeURIComponent(body.approvalId)}/approve`,
        body: buildApprovalDecisionBody(body, actor, "approve")
      });
    } catch (error) {
      return {
        ok: false,
        error: "approval_approve_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.approvalReject, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const body = normalizeApprovalDecisionPayload(payload);
    if (!body.approvalId) {
      return { ok: false, error: "approval_id_required", message: "Approval id is required." };
    }
    const actor = desktopActorForSender(event.sender);
    try {
      return await requestDesktopServiceJson({
        base,
        method: "POST",
        actor,
        pathname: `/approvals/${encodeURIComponent(body.approvalId)}/reject`,
        body: buildApprovalDecisionBody(body, actor, "reject")
      });
    } catch (error) {
      return {
        ok: false,
        error: "approval_reject_failed",
        message: error?.message ?? String(error)
      };
    }
  });
}
