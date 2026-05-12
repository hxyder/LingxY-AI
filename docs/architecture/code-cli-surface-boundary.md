# Code CLI Surface Boundary

Date: 2026-05-11

This inventory locks the CAP-4E Code CLI adapter/config/runtime-probe surface
before any physical move into `src/service/capabilities/`.

## Current Owner

Current Code CLI adapter owner:

`src/service/ai/code_cli/`

Target Code CLI adapter owner:

`src/service/capabilities/code_cli/`

Files:

| Path | Responsibility | Target layer |
|---|---|---|
| `src/service/ai/code_cli/registry.mjs` | Code CLI adapter registry and status fan-out | service/capabilities/code_cli |
| `src/service/ai/code_cli/builtin.mjs` | Built-in Kimi Code CLI and Codex CLI descriptors | service/capabilities/code_cli |
| `src/service/ai/code_cli/configured.mjs` | Runtime-configured Code CLI adapter descriptor/status shaping | service/capabilities/code_cli |
| `src/service/ai/code_cli/kimi/runtime.mjs` | Kimi CLI runtime resolution, env merge, config/credential/MCP path probing | service/capabilities/code_cli/kimi |
| `src/service/ai/code_cli/README.md` | Code CLI adapter integration notes | service/capabilities/code_cli |
| `src/service/ai/code_cli/kimi/README.md` | Kimi adapter notes | service/capabilities/code_cli/kimi |

## Active Callers

| Caller | Contract |
|---|---|
| `src/service/ai/integrations/runtime.mjs` | Builds reloading Code CLI adapter registry from built-ins, runtime config, custom providers, JSON declarations, and manual registrations |
| `src/service/core/persistent-runtime.mjs` | Resolves Kimi runtime status and boot fallback |
| `src/service/capabilities/providers/runtime.mjs` | Reports Kimi built-in provider health through Code CLI runtime status |
| `src/service/core/http-routes/ai-status-routes.mjs` | Owns `GET /ai/code-cli` status route |
| `src/service/core/http-routes/config-provider-routes.mjs` | Owns `GET /config/detect-clis`, `POST /config/code-cli/adapters`, and `DELETE /config/code-cli/adapters/:id` |
| `src/service/core/http-routes/config-provider-routes.mjs` | Still contains installed Code CLI detection logic; this is documented as a later cleanup target, not moved during CAP-4E preflight |
| `src/service/core/planning/runnable-executor.mjs` | Selects code_cli execution route based on active provider runtime |
| `src/service/executors/agentic/provider-adapter.mjs` | Treats `kind: "code_cli"` as subprocess provider transport |
| `src/service/executors/agentic/code-cli-bridge.mjs` | Owns CLI prompt protocol and subprocess invocation |

## Locked Contracts

- Code CLI source owner remains `src/service/ai/code_cli/` until the physical
  CAP-4E move.
- `src/service/capabilities/code_cli/` must not exist before CAP-4E physical
  migration.
- Public exports remain available:
  `createCodeCliRegistry`, `BUILTIN_CODE_CLI_ADAPTERS`,
  `createConfiguredCodeCliAdapter`, `getKimiRuntimeStatus`, and
  `resolveKimiRuntime`.
- Built-in adapter ids remain stable:
  `kimi-code-cli` and `codex-cli`.
- Runtime-configured adapters keep `stream_json_print` as the default
  transport and keep `runtime_config` as the default source.
- Code CLI owner files must not import desktop, Electron, renderer, preload,
  connector, MCP, skill, or provider catalog internals.
- Desktop UI/view-model files must not import Code CLI runtime internals.
- `/ai/code-cli`, `/config/detect-clis`, `/config/code-cli/adapters`, and
  `/config/code-cli/adapters/:id` route contracts remain stable.
- Provider catalog/config remains separate from Code CLI adapter catalog. The
  provider adapter and code-cli bridge execution boundaries are not moved in
  CAP-4E.

## Current Shape

```text
src/service/ai/code_cli/
  README.md
  builtin.mjs
  configured.mjs
  registry.mjs
  kimi/
    README.md
    runtime.mjs
```

Completion rules for the physical move:

- Every active import in product code, tests, scripts, and active docs must
  point at `src/service/capabilities/code_cli/`.
- `src/service/ai/code_cli/` must not remain as a compatibility barrel.
- The installed Code CLI detection logic in `config-provider-routes.mjs` must
  either stay explicitly documented as route-local logic or move in a separate
  targeted cleanup with route behavior tests.
- `verify-code-cli-surface-contract.mjs`, `verify-ai-integrations.mjs`,
  `verify-kimi-runtime.mjs`, `verify-service-core.mjs`,
  `verify-provider-health.mjs`, `verify-provider-setup-onboarding.mjs`,
  `verify-structure.mjs`, `verify-capability-roots.mjs`, and
  `verify-stale-owner-paths.mjs` must pass.
