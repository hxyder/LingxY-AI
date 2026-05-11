#!/usr/bin/env node

/**
 * Stdio entry point for the internal "lingxy-connectors" MCP server.
 *
 * Usage:
 *   node scripts/start-lingxy-mcp-server.mjs [--providers=google,microsoft]
 *
 * External MCP clients (Claude Desktop, Codex, MCP Inspector) can point at
 * this command as a stdio server; the child process loads an in-memory
 * connector catalog and translates MCP JSON-RPC calls into workflow /
 * action-tool calls on that catalog.
 */

import { createConnectorCatalog } from "../src/service/connectors/core/catalog.mjs";
import { createActionToolRegistry } from "../src/service/capabilities/registry/registry.mjs";
import { BUILTIN_ACTION_TOOLS } from "../src/service/action_tools/tools/index.mjs";
import { createConnectorMcpServer } from "../src/service/ai/mcp/internal-server/connector-mcp-server.mjs";

function parseArgs(argv) {
  const options = { providers: [] };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--providers=")) {
      options.providers = arg.slice("--providers=".length).split(",").map((p) => p.trim()).filter(Boolean);
    }
  }
  return options;
}

async function main() {
  const { providers } = parseArgs(process.argv);
  const runtime = {
    connectorCatalog: createConnectorCatalog(),
    actionToolRegistry: createActionToolRegistry(BUILTIN_ACTION_TOOLS),
    // minimal no-op stubs for the fields a workflow dispatcher touches but
    // which don't have a meaningful implementation in an external-client
    // context: no task events, no pending approval store.
    pendingApprovals: {
      create() {
        throw new Error("pending approval unavailable: start the host app to handle confirmations.");
      }
    }
  };

  const { server } = await createConnectorMcpServer({ runtime, providers });
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.on("SIGINT", async () => {
    try { await server.close?.(); } catch { /* ignore */ }
    process.exit(0);
  });
}

main().catch((error) => {
  process.stderr.write(`[lingxy-mcp] fatal: ${error.message}\n`);
  process.exit(1);
});
