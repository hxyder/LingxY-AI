# MCP / Connector Optimization Plan — Index

**Status**: Framework baseline landed → provider-neutral catalog + Google workflows → Microsoft parity + plugin CRUD + internal MCP server in progress (2026-04-19).

This page is a stable jump-off. All design content lives in topic-specific docs. If you're landing here cold, read in this order:

1. [ARCHITECTURE.md](ARCHITECTURE.md) — layered dispatch, ownership rules, catalog pipeline, timeline contract, validators, performance guardrails.
2. [PLUGIN_LIFECYCLE.md](PLUGIN_LIFECYCLE.md) — plugin manifest, install/enable/disable/uninstall, comparison with Claude Code and Codex.
3. [MCP_INTEGRATION.md](MCP_INTEGRATION.md) — internal stdio MCP server (`lingxy-connectors`), external MCP catalog bridge, candidate servers reviewed.
4. [KNOWN_FAILURES.md](KNOWN_FAILURES.md) — pre-existing `verify-office-base` / `verify-release-readiness` assertion failures unrelated to this work.

---

## Why we rolled back the universal runtime

The earlier "universal Task Runtime" path routed every text request through an intent normalization → classification → planning → execution → verifier loop. That improved observability but slowed common flows (Gmail drafts, search) and accepted empty-but-valid outputs as success.

Rollback decisions:

- Reverted runtime code changes in `package.json`, `http-server`, `task-runtime`, `task-spec`, action tool metadata, connector tool metadata, and overlay rendering.
- Removed experimental `src/service/task_runtime/`, the task runtime submission bridge, and related verification scripts.
- Removed archived experimental pipeline code.
- Kept design notes in this directory.

See [ARCHITECTURE.md#1-why-this-shape](ARCHITECTURE.md#1-why-this-shape) for the replacement design.

## What shipped before this iteration

Provider-neutral connector catalog:

- `src/service/connectors/core/catalog.mjs`
- `src/service/connectors/core/contract-loader.mjs`
- `src/service/connectors/core/validators.mjs`
- `src/service/connectors/core/workflow-dispatcher.mjs`
- `src/service/connectors/core/workflow-submission.mjs`
- `src/service/connectors/tools/catalog-tools.mjs`

HTTP surface (now in `src/service/core/http-routes/connector-routes.mjs`):

- `GET /connectors/catalog`, `GET /connectors/catalog/tools/:id`, `GET /connectors/catalog/workflows/:id`
- `POST /connectors/catalog/workflows/:id/run`

Google Workspace contracts + workflows (`src/service/connectors/google/`) cover Gmail, Calendar, and Drive. They demonstrate the framework; Microsoft parity and external plugin CRUD arrive in this iteration.

## What shipped in this iteration

- Modularization: connector routes extracted to `src/service/core/http-routes/connector-routes.mjs`; all connector action tools aggregated under `src/service/connectors/tools/action-tool-aggregator.mjs`.
- Microsoft contracts: `contracts/microsoft.connector.json`, `outlook.tools.json`, `outlook-calendar.tools.json`, `onedrive.tools.json`; workflows `outlook.draft-confirm-send.json` and `outlook-calendar.create-confirm.json`.
- `agent-loop.mjs` dispatch is workflow-first: matches `triggerPatterns` in the catalog and calls `connector_workflow_run` before falling back to read/write action tools.
- Internal stdio MCP server (`lingxy-connectors`) + CLI entry `scripts/start-lingxy-mcp-server.mjs`.
- Plugin registry (`src/service/connectors/core/plugin-registry.mjs`) + install/enable/disable/uninstall/reload HTTP routes + `connector_plugin_manage` model-visible tool.
- External MCP → catalog bridge (`src/service/connectors/core/mcp-catalog-bridge.mjs`) and dispatcher's new `execution.kind === "external_mcp"` branch.
- New verify scripts: `verify-microsoft-contracts`, `verify-plugin-registry`, `verify-internal-mcp-server`, `verify-workflow-first-dispatch`; wired into `npm run check`.

## Performance guardrails (unchanged)

- ≤1 LLM call for simple connector workflows; zero LLM calls for account/status/tool listings.
- Any workflow over 5s shows its current stage.
- Replan loops disabled by default for connector workflows.

See [ARCHITECTURE.md#8-performance-guardrails](ARCHITECTURE.md#8-performance-guardrails).
