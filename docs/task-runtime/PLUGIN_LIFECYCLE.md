# Plugin Lifecycle

LingxY's connector plugins are the unit of distribution for a provider. A plugin bundles contract JSON, workflow JSON, and optionally an external MCP server descriptor. Built-in providers (Google, Microsoft) are shipped as code under `src/service/connectors/<provider>/` and show up in the plugin registry as `source: "builtin"`. Third-party plugins live in `<userData>/plugins/<pluginId>/` and show up as `source: "installed"`.

For the higher-level architecture see [ARCHITECTURE.md](ARCHITECTURE.md). For MCP bridging see [MCP_INTEGRATION.md](MCP_INTEGRATION.md).

---

## 1. Manifest format

A plugin directory must contain a `plugin.json` manifest:

```json
{
  "schema_version": "1.0",
  "id": "linear",
  "displayName": "Linear",
  "description": "Create and update Linear issues from chat.",
  "version": "0.1.0",
  "provider": "linear",
  "contracts": [
    "contracts/linear.connector.json",
    "contracts/linear.tools.json"
  ],
  "workflows": [
    "workflows/linear.create-issue.json"
  ],
  "mcpServers": [
    {
      "id": "linear-mcp",
      "displayName": "Linear MCP",
      "transport": "stdio",
      "command": "node",
      "args": ["bin/linear-mcp.js"],
      "env": null,
      "enabled": false
    }
  ],
  "requires": {
    "node": ">=18"
  }
}
```

Rules:

- `id` must be unique; it becomes the top-level key in the registry state file and the path segment under `<userData>/plugins/`.
- `contracts` paths are resolved relative to the plugin directory; each file must match either a `connector` manifest or a `tools` contract as defined by the catalog contract loader.
- `workflows` paths must resolve to JSON files the workflow dispatcher can load.
- `mcpServers` are optional. Each entry follows the registry's server shape (id, transport, command, args, env). When the plugin is enabled, each server is registered into `runtime.mcpRegistry` with `enabled: false` so the user still has to flip it on in Console → Connectors → MCP.
- `requires.node` is checked at install time.

## 2. Install sources

First release only supports local-path installs. Online install (sourceUrl + sha256) is reserved for later.

```http
POST /plugins/install
Content-Type: application/json

{ "sourcePath": "D:/dev/linear-plugin" }
```

The registry:

1. Reads `plugin.json` and validates the schema + `requires` block.
2. Recursively copies the directory into `<userData>/plugins/<id>/`.
3. Writes `.state.json` with `{ "enabled": true, "installedAt": <iso> }`.
4. Calls `catalog.reload()` so the new contracts/workflows show up.
5. Registers any declared mcpServers into `runtime.mcpRegistry` (disabled by default).

## 3. Enable / disable

Built-in plugins cannot be uninstalled; they can only be disabled, which removes them from the catalog's active set without deleting code.

```http
PATCH /plugins/<id>/enabled
Content-Type: application/json

{ "enabled": false }
```

The registry flips the `.state.json` entry and calls `catalog.reload()`; the catalog's `contract-loader` filters out disabled plugins.

## 4. Uninstall

```http
DELETE /plugins/<id>
```

- Built-in plugins return 400.
- Installed plugins: the registry removes `<userData>/plugins/<id>/`, updates `.state.json`, reloads the catalog, and de-registers any mcpServers declared in the manifest.

## 5. Reload

```http
POST /plugins/reload
```

Triggers `catalog.reload()` without changing installation state. Use this after hand-editing a plugin directory during development.

## 6. Model-visible surface

The `connector_plugin_manage` action tool lets the model call `list`, `enable`, `disable`, or `reload`. It *cannot* install or uninstall — those are user-authorised actions only (Console UI or direct HTTP from a trusted client).

## 7. How this compares

| Aspect | Claude Code plugins | Codex config | LingxY plugin |
|---|---|---|---|
| Unit | `plugin.json` bundling commands, skills, hooks, MCP servers | `.codex/config.toml` MCP server + tool sections | `plugin.json` bundling contracts + workflows + MCP servers |
| Install | slash `/plugin install <url>` | edit config.toml | HTTP `POST /plugins/install` (or Console UI button) |
| Tool discovery | on-demand schema load per tool | per-tool approval configured in toml | `connector_catalog_search` → `connector_catalog_get` |
| Approval model | per-tool allowlist | per-tool approval override | catalog risk matrix + pending approvals |
| External MCP | stdio/http transport, declared in plugin | MCP server block in toml | mcpServers in plugin.json, bridged into catalog |

LingxY's plugin system is intentionally narrower than Claude Code: it doesn't bundle commands / skills / hooks. Contracts + workflows + MCP is the minimum surface needed to add a new provider.
