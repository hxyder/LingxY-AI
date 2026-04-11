# AI Integrations

UCA has one runtime integration surface for model providers, code CLIs, MCP servers, and skills.

## Runtime Paths

When the persistent runtime starts it creates:

- `%APPDATA%/UCA/data/integrations/mcp`
- `%APPDATA%/UCA/data/integrations/skills`
- `%APPDATA%/UCA/data/integrations/code_cli`

When `baseDir` is passed to `createPersistentRuntime`, the same structure is created under that runtime directory.

## HTTP Configuration

The runtime accepts hot-reloadable configuration through:

- `GET /config/integrations`
- `POST /config/mcp/servers`
- `DELETE /config/mcp/servers/:id`
- `POST /config/skills/registries`
- `DELETE /config/skills/registries/:id`
- `POST /config/code-cli/adapters`
- `DELETE /config/code-cli/adapters/:id`

Status endpoints:

- `GET /ai/providers`
- `GET /ai/code-cli`
- `GET /ai/mcp`
- `GET /ai/skills`

## JSON Declarations

Users can also drop JSON files into the runtime integration directories. Files are read on each registry query, so additions show up without a restart.

MCP example in `data/integrations/mcp/my-server.json`:

```json
{
  "servers": [
    {
      "id": "my-mcp",
      "displayName": "My MCP Server",
      "transport": "stdio",
      "command": "node",
      "args": ["C:/tools/my-mcp/server.mjs"]
    }
  ]
}
```

Skills example: place Codex-style skills under `data/integrations/skills/<skill-id>/SKILL.md`, or register another root:

```json
{
  "registries": [
    {
      "id": "team-skills",
      "displayName": "Team Skills",
      "rootPath": "C:/team/uca-skills"
    }
  ]
}
```

Code CLI example in `data/integrations/code_cli/codex-local.json`:

```json
{
  "adapters": [
    {
      "id": "codex-local",
      "displayName": "Codex Local",
      "command": "codex",
      "args": [],
      "transport": "stream_json_print",
      "defaultModel": "gpt-5.4-mini",
      "mcpConfigFiles": ["C:/team/mcp/servers.json"]
    }
  ]
}
```

## Planner Visibility

The agentic planner renders the current action tools and discovered skills into the system prompt. API providers and code CLI providers therefore see the same skill catalogue. Code CLI providers that use `stream_json_print` also receive `--config-file` and `--mcp-config-file` flags when those paths are present on the provider config.
