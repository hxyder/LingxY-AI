# MCP Surface Boundary

Date: 2026-05-11

This inventory locks the CAP-4B MCP runtime surface after the physical move into
`src/service/capabilities/mcp/`.

## Current Owner

Current MCP runtime owner:

`src/service/capabilities/mcp/`

Files:

| Path | Responsibility | Target layer |
|---|---|---|
| `src/service/capabilities/mcp/registry.mjs` | MCP server registry aggregation, status, resources | service/capabilities/mcp |
| `src/service/capabilities/mcp/builtin.mjs` | Built-in MCP server descriptors | service/capabilities/mcp |
| `src/service/capabilities/mcp/configured.mjs` | Runtime-configured MCP server adapter and command availability | service/capabilities/mcp |
| `src/service/capabilities/mcp/descriptor-validation.mjs` | MCP server descriptor validation | service/capabilities/mcp |
| `src/service/capabilities/mcp/discovery-catalog.mjs` | MCP registry search normalization and curated fallback discovery | service/capabilities/mcp |
| `src/service/capabilities/mcp/drafts.mjs` | Runtime-local MCP draft listing and import source reading | service/capabilities/mcp |
| `src/service/capabilities/mcp/env-resolver.mjs` | MCP env/secret reference resolution | service/capabilities/mcp |
| `src/service/capabilities/mcp/install-detection.mjs` | Installed package descriptor detection | service/capabilities/mcp/install |
| `src/service/capabilities/mcp/install-execution.mjs` | Sandboxed MCP package install execution and atomic promotion | service/capabilities/mcp/install |
| `src/service/capabilities/mcp/install-sandbox.mjs` | MCP install source classification and sandbox plan building | service/capabilities/mcp/install |
| `src/service/capabilities/mcp/auto-install.mjs` | First-run curated MCP auto-enable wiring | service/capabilities/mcp |
| `src/service/capabilities/mcp/client-bridge.mjs` | External MCP client connection cache and action-tool wrapping | service/capabilities/mcp/client |
| `src/service/capabilities/mcp/internal-server/connector-mcp-server.mjs` | Internal connector catalog MCP stdio server | service/capabilities/mcp/internal-server |
| `src/service/capabilities/mcp/README.md` | Runtime MCP integration notes | service/capabilities/mcp |

## Active Callers

Product callers that currently depend on this surface:

| Caller | Dependency |
|---|---|
| `src/service/ai/integrations/runtime.mjs` | registry, builtins, configured servers, env status |
| `src/service/core/http-routes/config-provider-routes.mjs` | MCP server CRUD, test, drafts |
| `src/service/core/http-routes/mcp-install-routes.mjs` | discovery search plus install plan, preview, run |
| `src/service/core/http-routes/ai-status-routes.mjs` | `/ai/mcp`, runtime toggle/config, client disconnect |
| `src/service/core/capability-creator/index.mjs` | descriptor validation for MCP drafts |
| `src/service/action_tools/tools/index.mjs` | MCP draft directory resolution for capability drafts |
| `src/service/executors/agentic/planner.mjs` | planner-visible MCP action tools |
| `src/service/capabilities/connectors/core/mcp-catalog-bridge.mjs` | external MCP catalog bridge |
| `src/service/capabilities/connectors/core/workflow-dispatcher.mjs` | external MCP tool execution through local policy |
| `src/service/core/persistent-runtime.mjs` | MCP client disconnect on shutdown |
| `src/service/core/service-bootstrap.mjs` | MCP auto-install and endpoint metadata |
| `scripts/start-lingxy-mcp-server.mjs` | internal MCP stdio server entrypoint |

Renderer and desktop code must reach MCP through IPC/HTTP contracts only. They
must not import MCP runtime internals directly.

## Stable Contracts

The verifier locks these contracts:

- MCP owner files exist at the capabilities path.
- The former service AI MCP owner directory is absent.
- Public exports needed by existing callers remain available.
- MCP owner files do not import Electron, desktop, or renderer modules.
- MCP install execution continues to use `spawnExternal` and must not mutate
  runtime config during plan/preview.
- External MCP tools remain catalog/action-tool wrapped instead of being raw
  prompt text.
- The internal MCP server remains a connector-catalog adapter, not a duplicate
  connector executor.
- `/ai/mcp`, `/ai/mcp/:id/toggle`, `/ai/mcp/:id/config`,
  `/config/mcp/servers`, `/config/mcp/servers/:id`,
  `/config/mcp/servers/:id/test`, `/config/mcp/drafts/import`,
  `/config/mcp/registry/search`, `/config/mcp/install/plan`,
  `/config/mcp/install/preview`, and `/config/mcp/install/run` remain stable
  service HTTP contracts.

## Current Shape

The CAP-4B physical move produced:

```text
src/service/capabilities/mcp/
  auto-install.mjs
  builtin.mjs
  client-bridge.mjs
  configured.mjs
  descriptor-validation.mjs
  discovery-catalog.mjs
  drafts.mjs
  env-resolver.mjs
  install-detection.mjs
  install-execution.mjs
  install-sandbox.mjs
  registry.mjs
  README.md
  internal-server/
    connector-mcp-server.mjs
```

Completion rules:

- Every active import in product code, tests, scripts, and docs must point at
  `src/service/capabilities/mcp/`.
- `verify-mcp-surface-contract.mjs`, `verify-capability-roots.mjs`,
  `verify-structure.mjs`, `verify-service-core.mjs`,
  `verify-internal-mcp-server.mjs`, and `verify-stale-owner-paths.mjs` must all
  agree on the owner.
- Compatibility barrels are not allowed after CAP-4B completion.

## Risk

Risk level: high.

Reasons:

- MCP spans service HTTP routes, desktop IPC bridges, install sandboxing,
  secret/env resolution, planner-visible tools, connector workflow dispatch,
  external process spawning, and an internal stdio server entrypoint.
- The physical move is mostly import-path mechanical, but broken imports can
  affect MCP install/config, `/ai/mcp`, planner MCP tool exposure, external MCP
  catalog execution, and shutdown cleanup.

No IPC channel names, HTTP route names, tool ids, artifact kinds, provider ids,
or storage schema may change during the move.
