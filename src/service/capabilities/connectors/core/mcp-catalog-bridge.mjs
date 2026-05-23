/**
 * External MCP → connector catalog bridge.
 *
 * External MCP servers are registered in runtime.mcpRegistry. This module
 * discovers each enabled server's tools via the MCP client-bridge and
 * registers them as external catalog entries so they go through the standard
 * risk matrix, pending approval flow, and timeline instead of being injected
 * directly into the agent loop.
 */

import { connectMcpServer } from "../../mcp/client-bridge.mjs";
import { evaluateExternalMcpGovernance } from "../../mcp/governance.mjs";

const DEFAULT_RISK = "medium";

function mcpCatalogId(serverId, toolName) {
  return `mcp.${serverId}.${toolName}`.toLowerCase();
}

function buildCatalogEntry({ serverId, serverDisplayName, mcpTool, policy = {} }) {
  return {
    id: mcpCatalogId(serverId, mcpTool.name),
    mcpName: mcpTool.name,
    name: mcpTool.name ?? `${serverId} ${mcpTool.name}`,
    description: mcpTool.description ?? `${mcpTool.name} (from ${serverDisplayName ?? serverId} MCP server)`,
    capability: policy.capability ?? "external_mcp",
    provider: "external",
    service: `mcp.${serverId}`,
    risk: policy.risk ?? DEFAULT_RISK,
    requiresConfirmation: policy.requiresConfirmation ?? true,
    source: "external_mcp",
    governance: {
      catalogOnly: true,
      requiresConfirmation: true,
      tokenPolicy: "isolated"
    },
    execution: {
      kind: "external_mcp",
      serverId,
      toolName: mcpTool.name
    },
    inputSchema: mcpTool.inputSchema ?? { type: "object", properties: {}, required: [] },
    outputValidators: policy.outputValidators ?? [],
    timeline: {
      label: `MCP ${serverDisplayName ?? serverId}: ${mcpTool.name}`,
      payloadPolicy: "summary_only"
    }
  };
}

export async function discoverExternalMcpCatalogEntries({
  mcpRegistry,
  policy = () => ({}),
  refresh = false
} = {}) {
  if (!mcpRegistry) return [];
  const servers = mcpRegistry.list().filter((server) => server.enabled !== false);
  const entries = [];
  await Promise.all(
    servers.map(async (server) => {
      if (server.transport !== "stdio" || !server.command) return;
      const governance = evaluateExternalMcpGovernance(server);
      if (!governance.allowed) return;
      const available = typeof server.isAvailable === "function" ? await server.isAvailable() : true;
      if (!available) return;
      let tools = [];
      try {
        tools = await connectMcpServer(server, { refresh });
      } catch {
        return;
      }
      for (const mcpTool of tools) {
        const resolvedPolicy = typeof policy === "function" ? policy(server, mcpTool) : policy;
        entries.push(buildCatalogEntry({
          serverId: server.id,
          serverDisplayName: server.displayName,
          mcpTool,
          policy: resolvedPolicy ?? {}
        }));
      }
    })
  );
  return entries;
}

/**
 * Refresh external MCP entries inside the catalog. Call this whenever MCP
 * servers get enabled / disabled, or on runtime start-up after the registry
 * is populated.
 */
export async function refreshExternalMcpCatalogEntries({ runtime, policy, refresh = false } = {}) {
  if (!runtime?.connectorCatalog) return [];
  const mcpRegistry = runtime.mcpRegistry ?? runtime.platform?.mcpServers ?? null;
  const entries = await discoverExternalMcpCatalogEntries({
    mcpRegistry,
    policy,
    refresh
  });
  runtime.connectorCatalog.clearExternalTools?.();
  runtime.connectorCatalog.registerExternalTools?.(entries);
  return entries;
}
