# AI Integration Layer

This layer owns the runtime registries for:

- model providers
- code CLI adapters
- MCP servers
- skills registries

`integrations/runtime.mjs` merges built-ins, runtime config, and JSON declarations under the runtime `data/integrations` directory. The registries are reloaded on query, so user additions show up through `/ai/providers`, `/ai/code-cli`, `/ai/mcp`, and `/ai/skills` without restarting the service.
