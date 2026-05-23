function normalizeMcpInstallPayload(payload = {}) {
  const timeoutMs = Number(payload.timeoutMs);
  return {
    source: `${payload.source ?? ""}`.trim(),
    id: `${payload.id ?? ""}`.trim(),
    allowScripts: payload.allowScripts === true,
    ...(Number.isFinite(timeoutMs) && timeoutMs > 0 ? { timeoutMs: Math.floor(timeoutMs) } : {})
  };
}

function normalizeMcpInstallPreviewPayload(payload = {}) {
  return {
    packageDir: `${payload.packageDir ?? ""}`.trim(),
    packageName: `${payload.packageName ?? ""}`.trim(),
    id: `${payload.id ?? ""}`.trim()
  };
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => `${item ?? ""}`.trim())
    .filter(Boolean);
}

function normalizeStringMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [`${key}`.trim(), `${item ?? ""}`])
      .filter(([key]) => Boolean(key))
  );
}

function normalizeMcpServerDescriptorPayload(payload = {}) {
  const transport = `${payload.transport ?? "stdio"}`.trim() || "stdio";
  return {
    id: `${payload.id ?? ""}`.trim(),
    displayName: `${payload.displayName ?? payload.name ?? payload.id ?? ""}`.trim(),
    transport,
    command: payload.command == null ? null : `${payload.command}`.trim(),
    args: normalizeStringArray(payload.args),
    url: payload.url == null ? null : `${payload.url}`.trim(),
    env: normalizeStringMap(payload.env),
    enabled: payload.enabled !== false
  };
}

function normalizeMcpServerId(value) {
  return `${value ?? ""}`.trim();
}

function normalizeMcpServerTogglePayload(payload = {}) {
  return {
    id: normalizeMcpServerId(payload.id),
    enabled: payload.enabled === true
  };
}

function normalizeMcpServerConfigPayload(payload = {}) {
  const values = payload.values && typeof payload.values === "object" && !Array.isArray(payload.values)
    ? Object.fromEntries(Object.entries(payload.values).map(([key, value]) => [
      `${key ?? ""}`.trim(),
      value == null ? "" : `${value}`
    ]).filter(([key]) => key))
    : null;
  const references = Array.isArray(payload.references)
    ? payload.references.map((entry) => ({
      envKey: `${entry?.envKey ?? ""}`.trim(),
      type: `${entry?.type ?? ""}`.trim(),
      name: `${entry?.name ?? ""}`.trim()
    })).filter((entry) => entry.envKey)
    : [];
  return {
    id: normalizeMcpServerId(payload.id),
    key: `${payload.key ?? ""}`.trim(),
    value: payload.value == null ? "" : `${payload.value}`,
    ...(values ? { values } : {}),
    ...(references.length > 0 ? { references } : {})
  };
}

function normalizeMcpDraftImportPayload(payload = {}) {
  return {
    file: `${payload.file ?? ""}`.trim(),
    path: `${payload.path ?? ""}`.trim()
  };
}

export function registerMcpIpc({
  ipcMain,
  IPC_CHANNELS,
  getServiceBaseUrl,
  postDesktopServiceJson,
  requestDesktopServiceJson
}) {
  if (!ipcMain?.handle) throw new TypeError("registerMcpIpc requires ipcMain.");
  if (!IPC_CHANNELS) throw new TypeError("registerMcpIpc requires IPC_CHANNELS.");
  if (typeof getServiceBaseUrl !== "function") throw new TypeError("registerMcpIpc requires getServiceBaseUrl.");
  if (typeof postDesktopServiceJson !== "function") throw new TypeError("registerMcpIpc requires postDesktopServiceJson.");
  if (typeof requestDesktopServiceJson !== "function") throw new TypeError("registerMcpIpc requires requestDesktopServiceJson.");

  ipcMain.handle(IPC_CHANNELS.mcpInstallPreview, async (_event, payload = {}) => {
    const base = getServiceBaseUrl();
    try {
      return await postDesktopServiceJson({
        base,
        pathname: "/config/mcp/install/preview",
        body: normalizeMcpInstallPreviewPayload(payload)
      });
    } catch (error) {
      return {
        ok: false,
        error: "mcp_install_preview_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.mcpInstallRun, async (_event, payload = {}) => {
    const base = getServiceBaseUrl();
    try {
      return await postDesktopServiceJson({
        base,
        pathname: "/config/mcp/install/run",
        body: normalizeMcpInstallPayload(payload)
      });
    } catch (error) {
      return {
        ok: false,
        error: "mcp_install_request_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.mcpServerSave, async (_event, payload = {}) => {
    const base = getServiceBaseUrl();
    try {
      return await postDesktopServiceJson({
        base,
        pathname: "/config/mcp/servers",
        body: normalizeMcpServerDescriptorPayload(payload)
      });
    } catch (error) {
      return {
        ok: false,
        error: "mcp_server_save_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.mcpServerDelete, async (_event, id = "") => {
    const base = getServiceBaseUrl();
    const serverId = normalizeMcpServerId(id);
    if (!serverId) {
      return { ok: false, error: "mcp_server_id_required", message: "MCP server id is required." };
    }
    try {
      return await requestDesktopServiceJson({
        base,
        method: "DELETE",
        pathname: `/config/mcp/servers/${encodeURIComponent(serverId)}`
      });
    } catch (error) {
      return {
        ok: false,
        error: "mcp_server_delete_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.mcpServerTest, async (_event, id = "") => {
    const base = getServiceBaseUrl();
    const serverId = normalizeMcpServerId(id);
    if (!serverId) {
      return { ok: false, error: "mcp_server_id_required", message: "MCP server id is required." };
    }
    try {
      return await requestDesktopServiceJson({
        base,
        method: "POST",
        pathname: `/config/mcp/servers/${encodeURIComponent(serverId)}/test`,
        body: {}
      });
    } catch (error) {
      return {
        ok: false,
        error: "mcp_server_test_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.mcpServerToggle, async (_event, payload = {}) => {
    const base = getServiceBaseUrl();
    const body = normalizeMcpServerTogglePayload(payload);
    if (!body.id) {
      return { ok: false, error: "mcp_server_id_required", message: "MCP server id is required." };
    }
    try {
      return await requestDesktopServiceJson({
        base,
        method: "PATCH",
        pathname: `/ai/mcp/${encodeURIComponent(body.id)}/toggle`,
        body: { enabled: body.enabled }
      });
    } catch (error) {
      return {
        ok: false,
        error: "mcp_server_toggle_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.mcpServerConfig, async (_event, payload = {}) => {
    const base = getServiceBaseUrl();
    const body = normalizeMcpServerConfigPayload(payload);
    if (!body.id || (!body.key && !body.values)) {
      return { ok: false, error: "mcp_server_config_required", message: "MCP server id and config values are required." };
    }
    try {
      return await requestDesktopServiceJson({
        base,
        method: "PATCH",
        pathname: `/ai/mcp/${encodeURIComponent(body.id)}/config`,
        body
      });
    } catch (error) {
      return {
        ok: false,
        error: "mcp_server_config_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.mcpDraftImport, async (_event, payload = {}) => {
    const base = getServiceBaseUrl();
    const body = normalizeMcpDraftImportPayload(payload);
    if (!body.file && !body.path) {
      return { ok: false, error: "mcp_draft_required", message: "MCP draft file is required." };
    }
    try {
      return await requestDesktopServiceJson({
        base,
        method: "POST",
        pathname: "/config/mcp/drafts/import",
        body
      });
    } catch (error) {
      return {
        ok: false,
        error: "mcp_draft_import_failed",
        message: error?.message ?? String(error)
      };
    }
  });
}
