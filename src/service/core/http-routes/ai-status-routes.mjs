import { readJsonBody, sendJson } from "../http-helpers.mjs";
import { requireDesktopActor } from "../http-route-guards.mjs";
import { refreshExternalMcpCatalogEntries } from "../../capabilities/connectors/core/mcp-catalog-bridge.mjs";
import { createMcpEnvSecretRef } from "../../security/secret-store.mjs";
import { buildRuntimeCapabilityInventory } from "../../capabilities/inventory/capability-inventory.mjs";
import { buildCapabilityCreationLifecycleCatalog } from "../../capabilities/lifecycle/capability-creation-lifecycle.mjs";

const WRITABLE_BUILTIN_MCP_SOURCES = new Set(["builtin", "builtin_mit", "lingxy_internal"]);
const REFERENCE_NAME_PATTERN = /^[A-Za-z0-9_.:/%-]+$/;

function updateMcpEnabled(currentConfig, serverId, enabled, registeredServer = null) {
  const mcpConfig = currentConfig.ai?.mcp ?? {};
  const configuredServers = Array.isArray(mcpConfig.servers) ? mcpConfig.servers : [];
  const configuredIndex = configuredServers.findIndex((server) => server?.id === serverId);
  if (configuredIndex >= 0) {
    return {
      status: 200,
      source: "runtime_config",
      config: {
        ...currentConfig,
        ai: {
          ...(currentConfig.ai ?? {}),
          mcp: {
            ...mcpConfig,
            servers: configuredServers.map((server, index) => (
              index === configuredIndex ? { ...server, enabled } : server
            ))
          }
        }
      }
    };
  }

  if (!registeredServer) {
    return {
      status: 404,
      source: "missing",
      error: "mcp_server_not_found",
      config: currentConfig
    };
  }

  if (!WRITABLE_BUILTIN_MCP_SOURCES.has(registeredServer.source)) {
    return {
      status: 409,
      source: registeredServer.source ?? "read_only",
      error: "mcp_server_read_only",
      config: currentConfig
    };
  }

  return {
    status: 200,
    source: "builtin_toggle",
    config: {
      ...currentConfig,
      ai: {
        ...(currentConfig.ai ?? {}),
        mcp: {
          ...mcpConfig,
          builtinToggles: {
            ...(mcpConfig.builtinToggles ?? {}),
            [serverId]: { enabled }
          }
        }
      }
    }
  };
}

function normalizeMcpConfigEntries(body = {}) {
  const entries = [];
  if (body?.values && typeof body.values === "object" && !Array.isArray(body.values)) {
    for (const [key, value] of Object.entries(body.values)) {
      const envKey = `${key ?? ""}`.trim();
      if (!envKey) continue;
      entries.push({ key: envKey, value: value == null ? "" : `${value}` });
    }
  }
  const singleKey = `${body?.key ?? ""}`.trim();
  if (singleKey && !entries.some((entry) => entry.key === singleKey)) {
    entries.push({ key: singleKey, value: body.value == null ? "" : `${body.value}` });
  }
  return entries;
}

function normalizeMcpConfigReferences(references = []) {
  const byKey = new Map();
  if (!Array.isArray(references)) return byKey;
  for (const entry of references) {
    const envKey = `${entry?.envKey ?? ""}`.trim();
    const type = `${entry?.type ?? ""}`.trim();
    const name = `${entry?.name ?? ""}`.trim();
    if (!envKey) continue;
    byKey.set(envKey, { envKey, type, name });
  }
  return byKey;
}

function mcpSecretRefForEntry(serverId, envKey, reference = null) {
  if (
    reference?.type === "secret_ref"
    && reference.name
    && REFERENCE_NAME_PATTERN.test(reference.name)
  ) {
    return reference.name;
  }
  return createMcpEnvSecretRef(serverId, envKey);
}

function buildMcpEnvOverridesPatch({ currentConfig, serverId, entries, references, secretStore }) {
  const currentMcp = currentConfig.ai?.mcp ?? {};
  const currentOverrides = currentMcp.envOverrides ?? {};
  const serverOverrides = { ...(currentOverrides[serverId] ?? {}) };
  const keys = [];
  for (const entry of entries) {
    const value = `${entry.value ?? ""}`;
    if (secretStore && value.trim()) {
      const ref = mcpSecretRefForEntry(serverId, entry.key, references.get(entry.key));
      secretStore.setSync(ref, value, {
        kind: "mcp_env",
        serverId,
        envKey: entry.key
      });
      serverOverrides[entry.key] = `\${secret_ref:${ref}}`;
    } else {
      serverOverrides[entry.key] = value;
    }
    keys.push(entry.key);
  }
  return {
    keys,
    config: {
      ...currentConfig,
      ai: {
        ...(currentConfig.ai ?? {}),
        mcp: {
          ...currentMcp,
          envOverrides: {
            ...currentOverrides,
            [serverId]: serverOverrides
          }
        }
      }
    }
  };
}

export async function tryHandleAiStatusRoute({ request, response, method, url, runtime }) {
  if (method === "GET" && url.pathname === "/executors") {
    sendJson(response, 200, {
      executors: runtime.executorRegistry.list()
    });
    return true;
  }

  if (method === "GET" && url.pathname === "/ai/providers") {
    const config = runtime.configStore?.load?.() ?? {};
    sendJson(response, 200, {
      providers: await runtime.platform.aiProviders.listStatus({
        runtime,
        config
      })
    });
    return true;
  }

  if (method === "GET" && url.pathname === "/ai/code-cli") {
    const config = runtime.configStore?.load?.() ?? {};
    sendJson(response, 200, {
      adapters: await runtime.platform.codeCliAdapters.listStatus({
        runtime,
        config
      })
    });
    return true;
  }

  if (method === "GET" && url.pathname === "/capabilities/inventory") {
    sendJson(response, 200, {
      inventory: await buildRuntimeCapabilityInventory(runtime)
    });
    return true;
  }

  if (method === "GET" && url.pathname === "/capabilities/lifecycle") {
    sendJson(response, 200, {
      lifecycle: buildCapabilityCreationLifecycleCatalog()
    });
    return true;
  }

  if (method === "GET" && url.pathname === "/ai/mcp") {
    sendJson(response, 200, {
      servers: await runtime.platform.mcpServers.listStatus({
        runtime,
        config: runtime.configStore?.load?.() ?? {},
        secretStore: runtime.secretStore ?? null,
        processEnv: process.env
      })
    });
    return true;
  }

  // PATCH /ai/mcp/:id/toggle — enable or disable a builtin MCP server.
  if (method === "PATCH" && /^\/ai\/mcp\/[^/]+\/toggle$/.test(url.pathname)) {
    if (!requireDesktopActor({ request, response })) {
      return true;
    }
    const serverId = decodeURIComponent(url.pathname.replace(/^\/ai\/mcp\//, "").replace(/\/toggle$/, ""));
    const body = await readJsonBody(request);
    const { enabled } = body ?? {};
    const currentConfig = runtime.configStore?.load?.() ?? {};
    const nextEnabled = Boolean(enabled);
    const registeredServer = runtime.platform?.mcpServers?.get?.(serverId) ?? null;
    const { config: updatedConfig, source, status, error } = updateMcpEnabled(
      currentConfig,
      serverId,
      nextEnabled,
      registeredServer
    );
    if (status !== 200) {
      sendJson(response, status, { ok: false, error, serverId, source });
      return true;
    }
    runtime.configStore?.save?.(updatedConfig);
    // Also invalidate any cached MCP client connection so it picks up the new state.
    try {
      const { disconnectAll } = await import("../../capabilities/mcp/client-bridge.mjs");
      await disconnectAll();
    } catch { /* bridge may not be loaded yet */ }
    try {
      await refreshExternalMcpCatalogEntries({ runtime, refresh: true });
    } catch { /* catalog refresh is best-effort; /connectors/catalog can rebuild it later */ }
    sendJson(response, 200, { ok: true, serverId, enabled: nextEnabled, source });
    return true;
  }

  // PATCH /ai/mcp/:id/config — save env-var config for built-in or custom MCP.
  if (method === "PATCH" && /^\/ai\/mcp\/[^/]+\/config$/.test(url.pathname)) {
    if (!requireDesktopActor({ request, response })) {
      return true;
    }
    const serverId = decodeURIComponent(url.pathname.replace(/^\/ai\/mcp\//, "").replace(/\/config$/, ""));
    const body = await readJsonBody(request);
    const entries = normalizeMcpConfigEntries(body);
    if (entries.length === 0) {
      sendJson(response, 400, { error: "key or values required" });
      return true;
    }
    const currentConfig = runtime.configStore?.load?.() ?? {};
    const { config: updatedConfig, keys } = buildMcpEnvOverridesPatch({
      currentConfig,
      serverId,
      entries,
      references: normalizeMcpConfigReferences(body?.references),
      secretStore: runtime.secretStore ?? null
    });
    runtime.configStore?.save?.(updatedConfig);
    try {
      const { disconnectAll } = await import("../../capabilities/mcp/client-bridge.mjs");
      await disconnectAll();
    } catch { /* bridge may not be loaded yet */ }
    try {
      await refreshExternalMcpCatalogEntries({ runtime, refresh: true });
    } catch { /* non-fatal; /connectors/catalog can refresh it later */ }
    sendJson(response, 200, { ok: true, serverId, keys });
    return true;
  }

  if (method === "GET" && url.pathname === "/ai/skills") {
    const config = runtime.configStore?.load?.() ?? {};
    sendJson(response, 200, {
      registries: await runtime.platform.skillRegistries.listStatus({
        runtime,
        config
      }),
      skills: await runtime.platform.skillRegistries.listSkills({
        runtime,
        config,
        includeInactive: true
      })
    });
    return true;
  }

  return false;
}
