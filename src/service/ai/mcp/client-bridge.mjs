/**
 * UCA-067 client bridge — turns enabled stdio MCP servers into real action tools
 * that any provider (Anthropic, OpenAI, DeepSeek, Ollama) can call.
 *
 * Previous limitation: native API providers could only see MCP servers as an
 * informational text note in the system prompt. They could never actually invoke
 * a tool because there was no JSON-RPC client in the loop.
 *
 * This module uses @modelcontextprotocol/sdk (Client + StdioClientTransport) to:
 *   1. Spawn each enabled MCP server process
 *   2. Discover its tools via tools/list
 *   3. Wrap each tool as a normal action-tool object with execute()
 *      that calls tools/call and returns a createActionResult-compatible object
 *
 * The wrapped tools are injected into the planner's tool-belt alongside built-in
 * action tools, so the LLM sees them as first-class tools in its system prompt
 * and can call them with standard JSON tool-use.
 */

import { createRequire } from "node:module";
import path from "node:path";
import { createActionResult } from "../../action_tools/types.mjs";

const _require = createRequire(import.meta.url);

// ── SDK imports (CJS-compat require from the dist folder) ─────────────────────

function loadSdk() {
  try {
    // @modelcontextprotocol/sdk ships as ESM in dist/*.js files.
    // We use dynamic import to load it properly.
    return null; // signal: use dynamic import path
  } catch {
    return null;
  }
}
loadSdk(); // side-effect-free; actual loading is done async below

async function getSdkClient() {
  // Note: SDK exports map "./*" → "./dist/*", so "sdk/client/..." resolves to "sdk/dist/client/..."
  // Do NOT use "sdk/dist/client/..." — that would double the dist prefix.
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  return { Client, StdioClientTransport };
}

// ── Per-server connection cache ────────────────────────────────────────────────

const _clients = new Map(); // serverId → { client, tools: McpTool[] }

/**
 * Connect to an MCP server and return its tool list.
 * Results are cached: a second call for the same serverId returns the cache.
 * Pass refresh=true to force reconnection.
 */
export async function connectMcpServer(serverConfig, { refresh = false } = {}) {
  const { id, command, args = [], env = null } = serverConfig;
  if (!id || !command) return [];

  if (!refresh && _clients.has(id)) {
    return _clients.get(id).tools;
  }

  let sdk;
  try {
    sdk = await getSdkClient();
  } catch {
    return []; // SDK not installed — skip silently
  }

  const { Client, StdioClientTransport } = sdk;

  // Merge safe env defaults → process.env → server-specific overrides
  // Server-specific env is set via Console → Connectors → ⚙ 配置 (e.g. BRAVE_API_KEY)
  const mergedEnv = {
    ...process.env,
    ...(env ?? {})
  };

  const transport = new StdioClientTransport({
    command,
    args,
    env: mergedEnv
  });

  const client = new Client({ name: "uca-agent", version: "1.0.0" }, { capabilities: {} });

  try {
    await client.connect(transport);
    const { tools = [] } = await client.listTools();
    const entry = { client, tools };
    _clients.set(id, entry);
    return tools;
  } catch (err) {
    // Server unavailable — return empty list; agent continues without it
    try { await client.close?.(); } catch { /* ignore */ }
    return [];
  }
}

/**
 * Disconnect all cached MCP clients (call on shutdown).
 */
export async function disconnectAll() {
  for (const { client } of _clients.values()) {
    try { await client.close?.(); } catch { /* ignore */ }
  }
  _clients.clear();
}

/**
 * Ensure the server is connected and return its underlying MCP client. Used
 * by the connector workflow dispatcher to invoke `tools/call` on external
 * MCP servers after going through local risk/confirmation policy.
 */
export async function getMcpClient(serverConfig) {
  await connectMcpServer(serverConfig);
  const cached = _clients.get(serverConfig.id);
  return cached?.client ?? null;
}

// ── Tool wrapping ─────────────────────────────────────────────────────────────

/**
 * Convert an MCP tool descriptor into an action-tool-compatible object.
 * The tool id is prefixed with the server id to avoid collisions with built-in tools.
 */
function wrapMcpTool(serverId, serverDisplayName, mcpTool) {
  // e.g. serverId="mcp-filesystem" + name="read_file" → id="mcp_filesystem__read_file"
  const safeServerId = serverId.replace(/-/g, "_");
  const toolId = `${safeServerId}__${mcpTool.name}`;

  return {
    id: toolId,
    name: `[MCP] ${serverDisplayName}: ${mcpTool.name}`,
    description: mcpTool.description ?? `${mcpTool.name} (from ${serverDisplayName} MCP server)`,
    // Expose the original MCP JSON schema as the parameters spec
    parameters: mcpTool.inputSchema ?? { type: "object", required: [], properties: {} },
    risk_level: "medium",
    required_capabilities: ["mcp"],
    requires_confirmation: false,
    // Metadata so callers can identify these as MCP-sourced
    _mcpServerId: serverId,
    _mcpToolName: mcpTool.name,
    async execute(args = {}, _ctx = {}) {
      const cached = _clients.get(serverId);
      if (!cached) {
        return createActionResult({
          success: false,
          observation: `MCP server "${serverId}" is not connected. Cannot call tool "${mcpTool.name}".`
        });
      }
      try {
        const result = await cached.client.callTool({
          name: mcpTool.name,
          arguments: args
        });
        // MCP callTool returns { content: [{type, text},...], isError? }
        const text = (result.content ?? [])
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("\n");
        const hasError = result.isError === true;
        return createActionResult({
          success: !hasError,
          observation: text || (hasError ? `MCP tool "${mcpTool.name}" returned an error.` : "(empty response)"),
          metadata: {
            tool_id: toolId,
            mcp_server: serverId,
            mcp_tool: mcpTool.name,
            content: result.content
          }
        });
      } catch (err) {
        return createActionResult({
          success: false,
          observation: `MCP tool "${mcpTool.name}" failed: ${err.message}`
        });
      }
    }
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Given an MCP registry instance, return an array of action-tool objects for
 * every tool exposed by every enabled, available stdio MCP server.
 *
 * This is called by the agentic prompt-builder before each task so newly-enabled
 * servers and freshly-discovered tools appear without a restart.
 *
 * @param {object} mcpRegistry  – registry returned by createMCPRegistry()
 * @param {object} [opts]
 * @param {boolean} [opts.refresh]  – force reconnect all servers
 * @returns {Promise<object[]>}  array of action-tool objects
 */
export async function getMcpActionTools(mcpRegistry, { refresh = false } = {}) {
  if (!mcpRegistry) return [];

  const servers = mcpRegistry.list().filter((s) => s.enabled !== false);
  const actionTools = [];

  await Promise.all(
    servers.map(async (server) => {
      // Only stdio servers with a command can be connected as clients
      if (server.transport !== "stdio" || !server.command) return;

      // Skip if not available on disk
      const available = typeof server.isAvailable === "function"
        ? await server.isAvailable()
        : true;
      if (!available) return;

      const mcpTools = await connectMcpServer(server, { refresh });
      for (const tool of mcpTools) {
        actionTools.push(wrapMcpTool(server.id, server.displayName ?? server.id, tool));
      }
    })
  );

  return actionTools;
}
