import { normalizePlainObject } from "../../tray/desktop-payload-normalizers.mjs";

function normalizeNotesSavePayload(payload = {}) {
  if (Array.isArray(payload)) return payload;
  const source = normalizePlainObject(payload) ?? {};
  return Array.isArray(source.notes) ? source.notes : [];
}

function normalizeNoteUpsertPayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  return {
    note: normalizePlainObject(source.note ?? source) ?? {}
  };
}

function normalizeNoteId(id) {
  return typeof id === "string" ? id.trim() : "";
}

function normalizeNoteAppendChipPayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  return {
    noteId: `${source.noteId ?? source.note_id ?? "__new__"}`.trim() || "__new__",
    text: source.text == null ? "" : `${source.text}`,
    sourceLabel: source.sourceLabel ?? source.source_label ?? null,
    title: source.title ?? null
  };
}

function normalizeProjectStoreSavePayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  return {
    store: normalizePlainObject(source.store ?? source) ?? {}
  };
}

function normalizeProjectFilesAttachPayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  return {
    paths: Array.isArray(source.paths)
      ? source.paths.filter((filePath) => typeof filePath === "string" && filePath.trim()).map((filePath) => filePath.trim())
      : [],
    projectId: typeof source.projectId === "string" ? source.projectId.trim() : ""
  };
}

function normalizeProjectFilesRemoveIndexPayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  return {
    paths: Array.isArray(source.paths)
      ? source.paths.filter((filePath) => typeof filePath === "string" && filePath.trim()).map((filePath) => filePath.trim())
      : [],
    projectId: typeof source.projectId === "string" ? source.projectId.trim() : "",
    detach: source.detach === true
  };
}

export function registerNotesProjectIpc({
  ipcMain,
  IPC_CHANNELS,
  BrowserWindow,
  dialog,
  getServiceBaseUrl,
  desktopActorForSender,
  postDesktopServiceJson
}) {
  if (!ipcMain?.handle) throw new TypeError("registerNotesProjectIpc requires ipcMain.");
  if (!IPC_CHANNELS) throw new TypeError("registerNotesProjectIpc requires IPC_CHANNELS.");
  if (!BrowserWindow) throw new TypeError("registerNotesProjectIpc requires BrowserWindow.");
  if (!dialog?.showOpenDialog) throw new TypeError("registerNotesProjectIpc requires dialog.");
  if (typeof getServiceBaseUrl !== "function") throw new TypeError("registerNotesProjectIpc requires getServiceBaseUrl.");
  if (typeof desktopActorForSender !== "function") throw new TypeError("registerNotesProjectIpc requires desktopActorForSender.");
  if (typeof postDesktopServiceJson !== "function") throw new TypeError("registerNotesProjectIpc requires postDesktopServiceJson.");

  ipcMain.handle(IPC_CHANNELS.notesSave, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    try {
      return await postDesktopServiceJson({
        base,
        actor,
        pathname: "/notes",
        body: { notes: normalizeNotesSavePayload(payload) }
      });
    } catch (error) {
      return {
        ok: false,
        error: "notes_save_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.noteUpsert, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    try {
      return await postDesktopServiceJson({
        base,
        actor,
        pathname: "/notes/upsert",
        body: normalizeNoteUpsertPayload(payload)
      });
    } catch (error) {
      return {
        ok: false,
        error: "note_upsert_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.noteDelete, async (event, id = "") => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    const noteId = normalizeNoteId(id);
    if (!noteId) {
      return { ok: false, error: "note_id_required", message: "Note id is required." };
    }
    try {
      return await postDesktopServiceJson({
        base,
        actor,
        pathname: "/notes/delete",
        body: { id: noteId }
      });
    } catch (error) {
      return {
        ok: false,
        error: "note_delete_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.noteRestore, async (event, id = "") => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    const noteId = normalizeNoteId(id);
    if (!noteId) {
      return { ok: false, error: "note_id_required", message: "Note id is required." };
    }
    try {
      return await postDesktopServiceJson({
        base,
        actor,
        pathname: "/notes/restore",
        body: { id: noteId }
      });
    } catch (error) {
      return {
        ok: false,
        error: "note_restore_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.noteAppendChip, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    try {
      return await postDesktopServiceJson({
        base,
        actor,
        pathname: "/notes/append-chip",
        body: normalizeNoteAppendChipPayload(payload)
      });
    } catch (error) {
      return {
        ok: false,
        error: "note_append_chip_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.projectStoreSave, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    try {
      return await postDesktopServiceJson({
        base,
        actor,
        pathname: "/projects/store",
        body: normalizeProjectStoreSavePayload(payload)
      });
    } catch (error) {
      return {
        ok: false,
        error: "project_store_save_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.projectFilesPick, async (event, options = {}) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const properties = ["openFile", "openDirectory", "multiSelections"];
    const normalizedOptions = normalizePlainObject(options) ?? {};
    const result = await dialog.showOpenDialog(owner ?? undefined, {
      ...normalizedOptions,
      title: "Add files or folders to this project",
      buttonLabel: "Add to Project",
      properties
    });
    return {
      canceled: result.canceled === true,
      paths: Array.isArray(result.filePaths) ? result.filePaths : []
    };
  });

  ipcMain.handle(IPC_CHANNELS.projectFilesAttach, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    const body = normalizeProjectFilesAttachPayload(payload);
    if (!body.projectId) {
      return { ok: false, error: "project_id_required", message: "Project id required." };
    }
    try {
      return await postDesktopServiceJson({
        base,
        actor,
        pathname: `/projects/${encodeURIComponent(body.projectId)}/files/attach`,
        body: { paths: body.paths }
      });
    } catch (error) {
      return {
        ok: false,
        error: "project_files_attach_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.projectFilesRemoveIndex, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    const body = normalizeProjectFilesRemoveIndexPayload(payload);
    if (!body.projectId) {
      return { ok: false, error: "project_id_required", message: "Project id required." };
    }
    try {
      return await postDesktopServiceJson({
        base,
        actor,
        pathname: `/projects/${encodeURIComponent(body.projectId)}/files/remove-index`,
        body: { paths: body.paths, detach: body.detach }
      });
    } catch (error) {
      return {
        ok: false,
        error: "project_files_remove_index_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.previewCacheClear, async (event) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    try {
      return await postDesktopServiceJson({
        base,
        actor,
        pathname: "/preview/cache/clear"
      });
    } catch (error) {
      return {
        ok: false,
        error: "preview_cache_clear_failed",
        message: error?.message ?? String(error)
      };
    }
  });
}
