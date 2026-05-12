# MCP Integration

LingxY treats MCP as an adapter boundary. Internal connector contracts are MCP-shaped so we can expose them *as* MCP to external clients (Claude Desktop, Codex); external MCP servers get mapped into the connector catalog so local policy still applies.

This file documents both directions. For the higher-level architecture see [ARCHITECTURE.md](ARCHITECTURE.md). For plugin packaging see [PLUGIN_LIFECYCLE.md](PLUGIN_LIFECYCLE.md).

---

## 1. Internal MCP server (`lingxy-connectors`)

`src/service/capabilities/mcp/internal-server/connector-mcp-server.mjs` turns the in-process connector catalog into a stdio MCP server:

- `tools/list` comes from `runtime.connectorCatalog.toMcpToolSummaries()`.
- `resources/list` comes from `runtime.connectorCatalog.toMcpResources()`.
- `tools/call`:
  - If the MCP tool name maps to a workflow (prefix `workflow_`), the server runs `runConnectorWorkflow()` with the arguments and returns the dispatcher result as `content[0].text`.
  - Otherwise the server executes the underlying action tool (`tool.execution.actionTool`) through the standard risk matrix.
  - Confirmation steps respond with `isError: false` + an `approval_id` in the metadata so the external client can surface "waiting for user".

Start it with `npm run mcp:server -- --providers=google` (or `--providers=microsoft,google`). Under the hood the script calls `scripts/start-lingxy-mcp-server.mjs`, which spawns a memory-backed runtime, loads the catalog, and hands stdio to `connector-mcp-server.mjs`.

The descriptor also exists in `src/service/capabilities/mcp/builtin.mjs` as the `lingxy-google` entry, disabled by default. A user enables it from the Console → Connectors → MCP tab and points Claude Desktop / Codex at the resulting stdio command:

```jsonc
// claude-desktop mcp config
{
  "mcpServers": {
    "lingxy-google": {
      "command": "node",
      "args": ["<path-to-linxi>/scripts/start-lingxy-mcp-server.mjs", "--providers=google"]
    }
  }
}
```

## 2. External MCP catalog bridge

`src/service/capabilities/connectors/core/mcp-catalog-bridge.mjs` registers tools from an enabled external MCP server *as catalog entries* rather than raw action tools.

For each MCP tool discovered by `client-bridge.connectMcpServer()`:

1. Synthesize a catalog tool:
   ```json
   {
     "id": "mcp.<serverId>.<toolName>",
     "source": "external_mcp",
     "risk": "medium",
     "requiresConfirmation": true,
     "execution": { "kind": "external_mcp", "serverId": "<serverId>", "toolName": "<name>" },
     "inputSchema": "<from MCP tool>"
   }
   ```
2. Call `catalog.registerExternalTools([entry])`. The catalog's `listTools()` / `getTool()` / `toMcpToolSummaries()` now include the external tool.
3. `workflow-dispatcher.mjs#executeConnectorTool` recognises `execution.kind === "external_mcp"` and routes the call through `runtime.mcpRegistry.get(serverId).callTool()`, while still running `evaluateToolRisk()` and producing pending approvals.

Critical: the external MCP tool is **not** re-injected into the agent loop as a raw action tool. The only entry point is through the catalog, which means every call passes confirmation and timeline rules.

## 3. External MCP token policy

External MCP servers must maintain isolated token/configuration stores. They
must not reuse LingxY OAuth or connector account tokens through secret refs such
as `${secret_ref:oauth/...}`, `${secret_ref:account/...}`, or
`${secret_ref:connector/...}`.

Allowed configuration forms:

- environment references owned by the MCP server, such as `${env:SEARCH_TOKEN}`;
- MCP-scoped secret refs, such as `${secret_ref:mcp/search/token}`;
- literals only when the descriptor validation explicitly allows them.

`src/service/capabilities/mcp/governance.mjs` enforces the policy in MCP status
reporting and in the external MCP catalog bridge. A governance-blocked server is
reported as unavailable with `detail: "governance_blocked"` and is not
discovered into connector catalog tools.

External MCP tool entries remain catalog-only:

- `source: "external_mcp"`;
- `requiresConfirmation: true` by default;
- execution goes through `workflow-dispatcher.mjs`, not raw action-tool
  injection.

## 4. MCP candidates studied (unchanged reference)

We did not vendor any third-party Google MCP server in this iteration. The studied candidates:

1. `aaronsb/google-workspace-mcp` (MIT, TypeScript) — manifest-driven factory built around Google's Workspace CLI (`gws`). Borrowed: declarative manifest + service-specific patches + account routing.
2. `ngs/google-mcp-server` (MIT, Go) — Gmail/Calendar/Drive/Sheets/Docs/Slides, multi-account, Windows prebuilt. Borrowed: design of a standalone MCP process.
3. `mcp-gsuite` by Markus Pfundstein (MIT) — narrower Gmail/Calendar surface. Borrowed: simpler starting scope.
4. `gmail-mcp-server-by-cdata` — read-only, CData JDBC driver licensing; reference only.

The internal MCP server we ship borrows the *shape* (manifest-driven, per-service patches), not the code. Before vendoring any of them later, confirm license from the repository source (not a registry summary) and keep external MCP disabled by default.

## 5. External dependency intake rules

- Prefer MIT, Apache-2.0, BSD-style licenses.
- Do not vendor GPL/AGPL into the core service.
- Check whether dependencies require paid/commercial drivers.
- Keep external MCP support optional and disabled by default.
- Document any borrowed design ideas in this file and [ARCHITECTURE.md](ARCHITECTURE.md).

## 6. Open questions

- Should Gmail draft creation be local preview only (current behavior) or create a real Gmail draft object via API?
- Should we support Google's `gws` CLI directly, or only MCP servers wrapping it?
- How should the UI represent pending confirmation across restarts?
