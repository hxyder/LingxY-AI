import { normalizePlainObject } from "../desktop-payload-normalizers.mjs";

function normalizeScheduleMutationPayload(payload = {}) {
  return normalizePlainObject(payload) ?? {};
}

function normalizeScheduleId(id) {
  return typeof id === "string" ? id.trim() : "";
}

function normalizeScheduleIdPayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  return {
    id: normalizeScheduleId(source.id ?? source.scheduleId ?? source.schedule_id),
    body: normalizePlainObject(source.body ?? source.patch ?? source.payload ?? source) ?? {}
  };
}

function normalizeScheduleRunPayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  return {
    id: normalizeScheduleId(source.id ?? source.scheduleId ?? source.schedule_id),
    triggerPayload: normalizePlainObject(source.triggerPayload ?? source.trigger_payload ?? {}) ?? {}
  };
}

function normalizeTemplateSavePayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  return {
    template: normalizePlainObject(source.template ?? source) ?? {}
  };
}

function normalizeTemplateImportPayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  return {
    raw: source.raw ?? source.template ?? source
  };
}

function normalizeTemplateId(id) {
  return typeof id === "string" ? id.trim() : "";
}

function normalizeDagExecutionId(id) {
  return typeof id === "string" ? id.trim() : "";
}

export function registerSchedulerIpc({
  ipcMain,
  IPC_CHANNELS,
  getServiceBaseUrl,
  desktopActorForSender,
  postDesktopServiceJson,
  requestDesktopServiceJson
}) {
  if (!ipcMain?.handle) throw new TypeError("registerSchedulerIpc requires ipcMain.");
  if (!IPC_CHANNELS) throw new TypeError("registerSchedulerIpc requires IPC_CHANNELS.");
  if (typeof getServiceBaseUrl !== "function") throw new TypeError("registerSchedulerIpc requires getServiceBaseUrl.");
  if (typeof desktopActorForSender !== "function") throw new TypeError("registerSchedulerIpc requires desktopActorForSender.");
  if (typeof postDesktopServiceJson !== "function") throw new TypeError("registerSchedulerIpc requires postDesktopServiceJson.");
  if (typeof requestDesktopServiceJson !== "function") throw new TypeError("registerSchedulerIpc requires requestDesktopServiceJson.");

  ipcMain.handle(IPC_CHANNELS.scheduleCreate, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    try {
      return await postDesktopServiceJson({
        base,
        actor,
        pathname: "/schedules",
        body: normalizeScheduleMutationPayload(payload)
      });
    } catch (error) {
      return {
        ok: false,
        error: "schedule_create_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.scheduleUpdate, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    const { id, body } = normalizeScheduleIdPayload(payload);
    if (!id) {
      return { ok: false, error: "schedule_id_required", message: "Schedule id is required." };
    }
    try {
      return await requestDesktopServiceJson({
        base,
        method: "PATCH",
        actor,
        pathname: `/schedules/${encodeURIComponent(id)}`,
        body
      });
    } catch (error) {
      return {
        ok: false,
        error: "schedule_update_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.scheduleDelete, async (event, id = "") => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    const scheduleId = normalizeScheduleId(id);
    if (!scheduleId) {
      return { ok: false, error: "schedule_id_required", message: "Schedule id is required." };
    }
    try {
      return await requestDesktopServiceJson({
        base,
        method: "DELETE",
        actor,
        pathname: `/schedules/${encodeURIComponent(scheduleId)}`
      });
    } catch (error) {
      return {
        ok: false,
        error: "schedule_delete_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.scheduleRun, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    const { id, triggerPayload } = normalizeScheduleRunPayload(payload);
    if (!id) {
      return { ok: false, error: "schedule_id_required", message: "Schedule id is required." };
    }
    try {
      return await requestDesktopServiceJson({
        base,
        method: "POST",
        actor,
        pathname: `/schedules/${encodeURIComponent(id)}/runs`,
        body: { triggerPayload }
      });
    } catch (error) {
      return {
        ok: false,
        error: "schedule_run_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.templateSave, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    try {
      return await postDesktopServiceJson({
        base,
        actor,
        pathname: "/templates",
        body: normalizeTemplateSavePayload(payload)
      });
    } catch (error) {
      return {
        ok: false,
        error: "template_save_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.templateImport, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    try {
      return await postDesktopServiceJson({
        base,
        actor,
        pathname: "/templates/import",
        body: normalizeTemplateImportPayload(payload)
      });
    } catch (error) {
      return {
        ok: false,
        error: "template_import_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.templateDelete, async (event, id = "") => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    const templateId = normalizeTemplateId(id);
    if (!templateId) {
      return { ok: false, error: "template_id_required", message: "Template id is required." };
    }
    try {
      return await requestDesktopServiceJson({
        base,
        method: "DELETE",
        actor,
        pathname: `/templates/${encodeURIComponent(templateId)}`
      });
    } catch (error) {
      return {
        ok: false,
        error: "template_delete_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.dagResume, async (event, id = "") => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    const executionId = normalizeDagExecutionId(id);
    if (!executionId) {
      return { ok: false, error: "dag_execution_id_required", message: "DAG execution id is required." };
    }
    try {
      return await requestDesktopServiceJson({
        base,
        method: "POST",
        actor,
        pathname: `/dag/executions/${encodeURIComponent(executionId)}/resume`
      });
    } catch (error) {
      return {
        ok: false,
        error: "dag_resume_failed",
        message: error?.message ?? String(error)
      };
    }
  });
}
