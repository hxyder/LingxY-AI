import { normalizePlainObject } from "../../tray/desktop-payload-normalizers.mjs";

function normalizeSkillRegistryPayload(payload = {}) {
  return normalizePlainObject(payload) ?? {};
}

function normalizeSkillRegistryId(id) {
  return typeof id === "string" ? id.trim() : "";
}

function normalizeSkillStatePayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  return {
    registry: typeof source.registry === "string" ? source.registry.trim() : "",
    id: typeof (source.id ?? source.skillId) === "string" ? (source.id ?? source.skillId).trim() : "",
    enabled: source.enabled !== false,
    exclusive: source.exclusive !== false
  };
}

function normalizeAutoSkillPayload(payload = {}) {
  return normalizePlainObject(payload) ?? {};
}

function normalizeSkillMarkdownWritePayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  return {
    entryPath: typeof source.entryPath === "string" ? source.entryPath : "",
    markdown: source.markdown == null ? "" : `${source.markdown}`
  };
}

function normalizeSkillMarkdownReadPayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  return {
    entryPath: typeof source.entryPath === "string" ? source.entryPath : ""
  };
}

function normalizeSkillDeletePayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  return {
    entryPath: typeof source.entryPath === "string" ? source.entryPath : ""
  };
}

function normalizeSkillCreatePayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  return {
    id: typeof source.id === "string" ? source.id : "",
    name: typeof source.name === "string" ? source.name : "New Skill",
    description: typeof source.description === "string" ? source.description : "",
    markdown: typeof source.markdown === "string" ? source.markdown : ""
  };
}

function normalizeSkillDuplicatePayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  return {
    entryPath: typeof source.entryPath === "string" ? source.entryPath : "",
    id: typeof source.id === "string" ? source.id : "",
    name: typeof source.name === "string" ? source.name : ""
  };
}

function normalizeSkillHistoryPayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  return {
    entryPath: typeof source.entryPath === "string" ? source.entryPath : ""
  };
}

function normalizeSkillRollbackPayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  return {
    entryPath: typeof source.entryPath === "string" ? source.entryPath : "",
    historyId: typeof source.historyId === "string" ? source.historyId : ""
  };
}

function normalizeSkillTestPayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  const normalized = {
    entryPath: typeof source.entryPath === "string" ? source.entryPath : ""
  };
  if (Object.prototype.hasOwnProperty.call(source, "markdown")) {
    normalized.markdown = source.markdown == null ? "" : `${source.markdown}`;
  }
  return normalized;
}

export function registerSkillIpc({
  ipcMain,
  IPC_CHANNELS,
  getServiceBaseUrl,
  desktopActorForSender,
  postDesktopServiceJson,
  requestDesktopServiceJson
}) {
  if (!ipcMain?.handle) throw new TypeError("registerSkillIpc requires ipcMain.");
  if (!IPC_CHANNELS) throw new TypeError("registerSkillIpc requires IPC_CHANNELS.");
  if (typeof getServiceBaseUrl !== "function") throw new TypeError("registerSkillIpc requires getServiceBaseUrl.");
  if (typeof desktopActorForSender !== "function") throw new TypeError("registerSkillIpc requires desktopActorForSender.");
  if (typeof postDesktopServiceJson !== "function") throw new TypeError("registerSkillIpc requires postDesktopServiceJson.");
  if (typeof requestDesktopServiceJson !== "function") throw new TypeError("registerSkillIpc requires requestDesktopServiceJson.");

  ipcMain.handle(IPC_CHANNELS.skillRegistrySave, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    try {
      return await postDesktopServiceJson({
        base,
        actor,
        pathname: "/config/skills/registries",
        body: normalizeSkillRegistryPayload(payload)
      });
    } catch (error) {
      return {
        ok: false,
        error: "skill_registry_save_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.skillRegistryDelete, async (event, id = "") => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    const registryId = normalizeSkillRegistryId(id);
    if (!registryId) {
      return { ok: false, error: "skill_registry_id_required", message: "Skill registry id is required." };
    }
    try {
      return await requestDesktopServiceJson({
        base,
        method: "DELETE",
        actor,
        pathname: `/config/skills/registries/${encodeURIComponent(registryId)}`
      });
    } catch (error) {
      return {
        ok: false,
        error: "skill_registry_delete_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.skillStateUpdate, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    try {
      return await requestDesktopServiceJson({
        base,
        method: "PATCH",
        actor,
        pathname: "/config/skills/skills/state",
        body: normalizeSkillStatePayload(payload)
      });
    } catch (error) {
      return {
        ok: false,
        error: "skill_state_update_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.autoSkillSave, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    try {
      return await postDesktopServiceJson({
        base,
        actor,
        pathname: "/skills/save",
        body: normalizeAutoSkillPayload(payload)
      });
    } catch (error) {
      return {
        ok: false,
        error: "auto_skill_save_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.skillMarkdownRead, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    const body = normalizeSkillMarkdownReadPayload(payload);
    try {
      return await requestDesktopServiceJson({
        base,
        method: "GET",
        actor,
        pathname: `/skills/read?entryPath=${encodeURIComponent(body.entryPath)}`
      });
    } catch (error) {
      return {
        ok: false,
        error: "skill_markdown_read_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.skillMarkdownWrite, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    try {
      return await postDesktopServiceJson({
        base,
        actor,
        pathname: "/skills/write",
        body: normalizeSkillMarkdownWritePayload(payload)
      });
    } catch (error) {
      return {
        ok: false,
        error: "skill_markdown_write_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.skillCreate, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    try {
      return await postDesktopServiceJson({
        base,
        actor,
        pathname: "/skills/create",
        body: normalizeSkillCreatePayload(payload)
      });
    } catch (error) {
      return {
        ok: false,
        error: "skill_create_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.skillDuplicate, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    try {
      return await postDesktopServiceJson({
        base,
        actor,
        pathname: "/skills/duplicate",
        body: normalizeSkillDuplicatePayload(payload)
      });
    } catch (error) {
      return {
        ok: false,
        error: "skill_duplicate_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.skillDelete, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    try {
      return await postDesktopServiceJson({
        base,
        actor,
        pathname: "/skills/delete",
        body: normalizeSkillDeletePayload(payload)
      });
    } catch (error) {
      return {
        ok: false,
        error: "skill_delete_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.skillHistory, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    const body = normalizeSkillHistoryPayload(payload);
    try {
      return await requestDesktopServiceJson({
        base,
        method: "GET",
        actor,
        pathname: `/skills/history?entryPath=${encodeURIComponent(body.entryPath)}`
      });
    } catch (error) {
      return {
        ok: false,
        error: "skill_history_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.skillRollback, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    try {
      return await postDesktopServiceJson({
        base,
        actor,
        pathname: "/skills/rollback",
        body: normalizeSkillRollbackPayload(payload)
      });
    } catch (error) {
      return {
        ok: false,
        error: "skill_rollback_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.skillTest, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    try {
      return await postDesktopServiceJson({
        base,
        actor,
        pathname: "/skills/test",
        body: normalizeSkillTestPayload(payload)
      });
    } catch (error) {
      return {
        ok: false,
        error: "skill_test_failed",
        message: error?.message ?? String(error)
      };
    }
  });
}
