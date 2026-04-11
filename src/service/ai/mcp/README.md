# MCP Adapters

MCP server descriptors are registered through:

- `ai.mcp.servers` in runtime config
- JSON files in `data/integrations/mcp`
- the HTTP endpoints under `/config/mcp/servers`

Each descriptor can use `stdio`, `http`, or `ws` transport. The current registry validates configuration and exposes status through `/ai/mcp`; protocol-level resource calls stay behind the adapter boundary (`listResources`) so concrete MCP clients can be added without changing service bootstrap.
