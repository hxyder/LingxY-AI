import { normalizePlainObject } from "../../shared/desktop-payload-normalizers.mjs";

function normalizeTaskId(id) {
  return typeof id === "string" ? id.trim() : "";
}

function normalizeTaskCancelPayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  return {
    taskId: normalizeTaskId(source.taskId ?? source.task_id ?? source.id),
    force: source.force === true
  };
}

function normalizeTaskRetryPayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  return {
    taskId: normalizeTaskId(source.taskId ?? source.task_id ?? source.id),
    mode: `${source.mode ?? "retry_same"}`.trim() || "retry_same",
    overrides: normalizePlainObject(source.overrides) ?? {},
    background: source.background === true || source.returnImmediately === true
  };
}

function normalizeTaskFileRecoveryPayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  return {
    taskId: normalizeTaskId(source.taskId ?? source.task_id ?? source.id),
    checkpointId: `${source.checkpointId ?? source.checkpoint_id ?? ""}`.trim()
  };
}

export function registerTaskIpc({
  ipcMain,
  IPC_CHANNELS,
  getServiceBaseUrl,
  desktopActorForSender,
  requestDesktopServiceJson
}) {
  if (!ipcMain?.handle) throw new TypeError("registerTaskIpc requires ipcMain.");
  if (!IPC_CHANNELS) throw new TypeError("registerTaskIpc requires IPC_CHANNELS.");
  if (typeof getServiceBaseUrl !== "function") throw new TypeError("registerTaskIpc requires getServiceBaseUrl.");
  if (typeof desktopActorForSender !== "function") throw new TypeError("registerTaskIpc requires desktopActorForSender.");
  if (typeof requestDesktopServiceJson !== "function") throw new TypeError("registerTaskIpc requires requestDesktopServiceJson.");

  ipcMain.handle(IPC_CHANNELS.taskCancel, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    const body = normalizeTaskCancelPayload(payload);
    if (!body.taskId) {
      return { ok: false, error: "task_id_required", message: "Task id is required." };
    }
    try {
      return await requestDesktopServiceJson({
        base,
        method: "POST",
        actor,
        pathname: `/task/${encodeURIComponent(body.taskId)}/cancel`,
        body: { force: body.force }
      });
    } catch (error) {
      return {
        ok: false,
        error: "task_cancel_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.taskRetry, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    const body = normalizeTaskRetryPayload(payload);
    if (!body.taskId) {
      return { ok: false, error: "task_id_required", message: "Task id is required." };
    }
    try {
      return await requestDesktopServiceJson({
        base,
        method: "POST",
        actor,
        pathname: `/task/${encodeURIComponent(body.taskId)}/retry`,
        body: {
          mode: body.mode,
          overrides: body.overrides,
          background: body.background
        }
      });
    } catch (error) {
      return {
        ok: false,
        error: "task_retry_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.taskDelete, async (event, taskId = "") => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    const id = normalizeTaskId(taskId);
    if (!id) {
      return { ok: false, error: "task_id_required", message: "Task id is required." };
    }
    try {
      return await requestDesktopServiceJson({
        base,
        method: "DELETE",
        actor,
        pathname: `/task/${encodeURIComponent(id)}`
      });
    } catch (error) {
      return {
        ok: false,
        error: "task_delete_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.taskRestore, async (event, taskId = "") => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    const id = normalizeTaskId(taskId);
    if (!id) {
      return { ok: false, error: "task_id_required", message: "Task id is required." };
    }
    try {
      return await requestDesktopServiceJson({
        base,
        method: "POST",
        actor,
        pathname: `/task/${encodeURIComponent(id)}/restore`
      });
    } catch (error) {
      return {
        ok: false,
        error: "task_restore_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.taskFileRecoveryRestore, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    const body = normalizeTaskFileRecoveryPayload(payload);
    if (!body.taskId || !body.checkpointId) {
      return {
        ok: false,
        error: "file_recovery_checkpoint_required",
        message: "Task id and checkpoint id are required."
      };
    }
    try {
      return await requestDesktopServiceJson({
        base,
        method: "POST",
        actor,
        pathname: `/task/${encodeURIComponent(body.taskId)}/file-recovery/${encodeURIComponent(body.checkpointId)}`
      });
    } catch (error) {
      return {
        ok: false,
        error: "file_recovery_restore_failed",
        message: error?.message ?? String(error)
      };
    }
  });
}
