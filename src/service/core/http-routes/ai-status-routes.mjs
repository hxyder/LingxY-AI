import { readJsonBody, sendJson } from "../http-helpers.mjs";

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

  if (method === "GET" && url.pathname === "/ai/mcp") {
    sendJson(response, 200, {
      servers: await runtime.platform.mcpServers.listStatus({
        runtime,
        config: runtime.configStore?.load?.() ?? {}
      })
    });
    return true;
  }

  // PATCH /ai/mcp/:id/toggle — enable or disable a builtin MCP server.
  if (method === "PATCH" && /^\/ai\/mcp\/[^/]+\/toggle$/.test(url.pathname)) {
    const serverId = decodeURIComponent(url.pathname.replace(/^\/ai\/mcp\//, "").replace(/\/toggle$/, ""));
    const body = await readJsonBody(request);
    const { enabled } = body ?? {};
    const currentConfig = runtime.configStore?.load?.() ?? {};
    const toggles = currentConfig.ai?.mcp?.builtinToggles ?? {};
    toggles[serverId] = { enabled: Boolean(enabled) };
    const updatedConfig = {
      ...currentConfig,
      ai: {
        ...(currentConfig.ai ?? {}),
        mcp: {
          ...(currentConfig.ai?.mcp ?? {}),
          builtinToggles: toggles
        }
      }
    };
    runtime.configStore?.save?.(updatedConfig);
    // Also invalidate any cached MCP client connection so it picks up the new state.
    try {
      const { disconnectAll } = await import("../../ai/mcp/client-bridge.mjs");
      await disconnectAll();
    } catch { /* bridge may not be loaded yet */ }
    sendJson(response, 200, { ok: true, serverId, enabled: Boolean(enabled) });
    return true;
  }

  // PATCH /ai/mcp/:id/config — save env-var config (e.g. Brave API Key).
  if (method === "PATCH" && /^\/ai\/mcp\/[^/]+\/config$/.test(url.pathname)) {
    const serverId = decodeURIComponent(url.pathname.replace(/^\/ai\/mcp\//, "").replace(/\/config$/, ""));
    const body = await readJsonBody(request);
    const { key, value } = body ?? {};
    if (!key) {
      sendJson(response, 400, { error: "key required" });
      return true;
    }
    const currentConfig = runtime.configStore?.load?.() ?? {};
    const envOverrides = currentConfig.ai?.mcp?.envOverrides ?? {};
    if (!envOverrides[serverId]) envOverrides[serverId] = {};
    envOverrides[serverId][key] = value ?? "";
    runtime.configStore?.save?.({
      ...currentConfig,
      ai: {
        ...(currentConfig.ai ?? {}),
        mcp: {
          ...(currentConfig.ai?.mcp ?? {}),
          envOverrides
        }
      }
    });
    sendJson(response, 200, { ok: true, serverId, key });
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
        config
      })
    });
    return true;
  }

  return false;
}
