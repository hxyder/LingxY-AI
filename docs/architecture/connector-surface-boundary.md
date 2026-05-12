# Connector Surface Boundary

Date: 2026-05-11

This inventory locks the CAP-4C connector runtime surface after moving it into
`src/service/capabilities/connectors/`.

## Current Owner

Current connector runtime owner:

`src/service/capabilities/connectors/`

Target connector runtime owner:

`src/service/capabilities/connectors/`

Former owner: the old service-root connector directory. It is now forbidden and
is checked by `verify-connector-surface-contract.mjs`.

Files:

| Path | Responsibility | Target layer |
|---|---|---|
| `src/service/capabilities/connectors/account-connectors.mjs` | OAuth config, provider auth start/callback, disconnect, status, connector reads | service/capabilities/connectors |
| `src/service/capabilities/connectors/core/account-registry.mjs` | Connected account persistence, defaults, token records, reauth records | service/capabilities/connectors/core |
| `src/service/capabilities/connectors/core/account-router.mjs` | Provider/account selection for email, file, and calendar capabilities | service/capabilities/connectors/core |
| `src/service/capabilities/connectors/core/capability-mapper.mjs` | Google/Microsoft OAuth scope to capability map | service/capabilities/connectors/core |
| `src/service/capabilities/connectors/core/catalog.mjs` | Connector catalog aggregation for contracts and workflows | service/capabilities/connectors/core |
| `src/service/capabilities/connectors/core/connector-intent.mjs` | Connector intent/provider/limit/workflow inference helpers | service/capabilities/connectors/core |
| `src/service/capabilities/connectors/core/contract-loader.mjs` | Connector contract/workflow JSON discovery | service/capabilities/connectors/core |
| `src/service/capabilities/connectors/core/mcp-catalog-bridge.mjs` | External MCP catalog entry refresh bridge | service/capabilities/connectors/core |
| `src/service/capabilities/connectors/core/plugin-registry.mjs` | External connector plugin registry | service/capabilities/connectors/core |
| `src/service/capabilities/connectors/core/reauth-manager.mjs` | Missing-scope and reauth-required result shaping | service/capabilities/connectors/core |
| `src/service/capabilities/connectors/core/token-manager.mjs` | OAuth token refresh and legacy token migration | service/capabilities/connectors/core |
| `src/service/capabilities/connectors/core/types.mjs` | Connector provider/capability constants and account normalization | service/capabilities/connectors/core |
| `src/service/capabilities/connectors/core/validators.mjs` | Connector contract value/object validators | service/capabilities/connectors/core |
| `src/service/capabilities/connectors/core/workflow-dispatcher.mjs` | Built-in/external connector workflow execution | service/capabilities/connectors/core |
| `src/service/capabilities/connectors/core/workflow-submission.mjs` | Connector workflow task submission/resume | service/capabilities/connectors/core |
| `src/service/capabilities/connectors/google/google-connector.mjs` | Google Gmail/Drive/Calendar provider adapter | service/capabilities/connectors/google |
| `src/service/capabilities/connectors/google/contracts/*.json` | Google connector catalog contracts | service/capabilities/connectors/google/contracts |
| `src/service/capabilities/connectors/google/workflows/*.json` | Google connector workflow definitions | service/capabilities/connectors/google/workflows |
| `src/service/capabilities/connectors/microsoft/microsoft-connector.mjs` | Microsoft Outlook/OneDrive/Calendar provider adapter | service/capabilities/connectors/microsoft |
| `src/service/capabilities/connectors/microsoft/contracts/*.json` | Microsoft connector catalog contracts | service/capabilities/connectors/microsoft/contracts |
| `src/service/capabilities/connectors/microsoft/workflows/*.json` | Microsoft connector workflow definitions | service/capabilities/connectors/microsoft/workflows |
| `src/service/capabilities/connectors/tools/action-tool-aggregator.mjs` | Single connector action-tool aggregation point | service/capabilities/connectors/tools |
| `src/service/capabilities/connectors/tools/catalog-tools.mjs` | Connector catalog and workflow action tools | service/capabilities/connectors/tools |
| `src/service/capabilities/connectors/tools/plugin-tools.mjs` | Connector plugin management action tool | service/capabilities/connectors/tools |
| `src/service/capabilities/connectors/tools/read-tools.mjs` | Connected account, email, file, and calendar read tools | service/capabilities/connectors/tools |
| `src/service/capabilities/connectors/tools/write-tools.mjs` | Email send, file upload, and calendar write tools | service/capabilities/connectors/tools |

## Active Callers

Product callers that currently depend on this surface:

| Caller | Dependency |
|---|---|
| `src/service/action_tools/tools/index.mjs` | `CONNECTOR_ACTION_TOOLS` aggregation |
| `src/service/core/http-routes/connector-routes.mjs` | `/connectors/*`, `/plugins/*`, OAuth callback routes, catalog/workflow/account routes |
| `src/service/core/service-bootstrap.mjs` | connector catalog and plugin registry |
| `src/service/core/persistent-runtime.mjs` | connector runtime shutdown/state ownership |
| `src/service/email/accounts.mjs` | connected account email integration |
| `src/service/executors/tool_using/planners/connector.mjs` | connector workflow planning |
| `src/service/executors/tool_using/planners/connector-helpers.mjs` | connector workflow planning helpers |
| `src/service/capabilities/mcp/internal-server/connector-mcp-server.mjs` | internal MCP server workflow dispatch adapter |
| `scripts/verify-unified-connectors.mjs` | account/token/router/action-tool behavior coverage |
| `scripts/verify-connector-catalog.mjs` | connector catalog and contract coverage |
| `scripts/verify-connector-workflow-dispatcher.mjs` | connector workflow dispatcher coverage |
| `scripts/verify-microsoft-contracts.mjs` | Microsoft connector contract coverage |
| `scripts/verify-workflow-first-dispatch.mjs` | connector workflow-first dispatch invariant |
| `scripts/verify-plugin-registry.mjs` | plugin registry coverage |
| `scripts/verify-internal-mcp-server.mjs` | MCP-to-connector workflow adapter coverage |

Renderer and desktop code must reach connectors through IPC/HTTP contracts only.
They must not import connector runtime internals directly.

## Stable Contracts

The verifier locks these contracts:

- Connector owner files and JSON contracts/workflows exist in the current owner.
- Public exports needed by existing callers remain available.
- Connector action tools are aggregated only through
  `CONNECTOR_ACTION_TOOLS`; `action_tools/tools/index.mjs` must not inline
  connector tool definitions.
- Connector owners do not import Electron, desktop, renderer, or preload code.
- Desktop UI/view-model code does not import connector runtime internals.
- Service HTTP routes retain `/connectors/*`, `/plugins/*`, and
  `/auth/callback` contracts.
- Google and Microsoft provider adapters stay provider-specific and are not
  duplicated in route or renderer code.
- Connector workflow dispatch stays service-owned and delegates external MCP
  execution through the MCP client bridge.

## Current Shape

The CAP-4C physical shape is:

```text
src/service/capabilities/connectors/
  account-connectors.mjs
  core/
    account-registry.mjs
    account-router.mjs
    capability-mapper.mjs
    catalog.mjs
    connector-intent.mjs
    contract-loader.mjs
    mcp-catalog-bridge.mjs
    plugin-registry.mjs
    reauth-manager.mjs
    token-manager.mjs
    types.mjs
    validators.mjs
    workflow-dispatcher.mjs
    workflow-submission.mjs
  google/
    google-connector.mjs
    contracts/
    workflows/
  microsoft/
    microsoft-connector.mjs
    contracts/
    workflows/
  tools/
    action-tool-aggregator.mjs
    catalog-tools.mjs
    plugin-tools.mjs
    read-tools.mjs
    write-tools.mjs
```

Completion rules:

- Every active import in product code, tests, scripts, and active docs must
  point at `src/service/capabilities/connectors/`.
- The old service-root connector directory must not remain as a compatibility
  barrel.
- `verify-connector-surface-contract.mjs`, `verify-capability-roots.mjs`,
  `verify-structure.mjs`, `verify-service-core.mjs`,
  `verify-unified-connectors.mjs`, `verify-connector-catalog.mjs`,
  `verify-connector-workflow-dispatcher.mjs`,
  `verify-workflow-first-dispatch.mjs`, `verify-plugin-registry.mjs`,
  `verify-internal-mcp-server.mjs`, and `verify-stale-owner-paths.mjs` must all
  agree on the owner.

## Risk

Risk level: high.

Reasons:

- Connectors span OAuth callbacks, connected account storage, catalog contracts,
  action tools, workflow dispatch, provider API adapters, plugin management,
  service HTTP routes, MCP catalog integration, and desktop-visible account UI.
- The physical move is mostly import-path mechanical, but broken imports can
  affect `/connectors/*`, `/plugins/*`, `/auth/callback`, planner workflow
  routing, account token refresh, connector action tools, and internal MCP
  workflow execution.

No IPC channel names, HTTP route names, tool ids, artifact kinds, provider ids,
or storage schema may change during the move.
