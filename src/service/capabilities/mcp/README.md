# MCP Adapters

MCP server descriptors are registered through:

- `ai.mcp.servers` in runtime config
- JSON files in `data/integrations/mcp`
- the HTTP endpoints under `/config/mcp/servers`

Each descriptor can use `stdio`, `http`, or `ws` transport. The current registry validates configuration and exposes status through `/ai/mcp`; protocol-level resource calls stay behind the adapter boundary (`listResources`) so concrete MCP clients can be added without changing service bootstrap.

Discovery is owned by `discovery-catalog.mjs`. It reads the public MCP registry
through `/config/mcp/registry/search`, normalizes entries into disabled server
drafts, and falls back to a small curated catalog when the external registry is
unavailable. Installing or saving a searched MCP remains a separate desktop
bridge action; the search route never writes runtime config.
