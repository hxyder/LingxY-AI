# Provider Surface Boundary

Date: 2026-05-11

This inventory locks the CAP-4D provider catalog/config/model-discovery surface
before moving it into `src/service/capabilities/providers/`.

## Current Owner

Current provider runtime owner:

`src/service/ai/providers/`

Target provider runtime owner:

`src/service/capabilities/providers/`

Files:

| Path | Responsibility | Target layer |
|---|---|---|
| `src/service/ai/providers/registry.mjs` | Provider registry, status aggregation, lookup | service/capabilities/providers |
| `src/service/ai/providers/builtin.mjs` | Built-in Anthropic/OpenAI/Kimi/Ollama provider descriptors | service/capabilities/providers |
| `src/service/ai/providers/configured.mjs` | Runtime-configured provider adapter and status shaping | service/capabilities/providers |
| `src/service/ai/providers/runtime.mjs` | Built-in provider health/status probes | service/capabilities/providers |
| `src/service/ai/providers/model-discovery.mjs` | Provider model option discovery, curated fallbacks, cache | service/capabilities/providers |
| `src/service/ai/providers/README.md` | Provider integration notes | service/capabilities/providers |

## Active Callers

| Caller | Dependency |
|---|---|
| `src/service/ai/integrations/runtime.mjs` | provider registry, built-ins, runtime-configured providers |
| `src/service/core/http-server.mjs` | provider model discovery service construction |
| `src/service/core/http-routes/ai-status-routes.mjs` | `/ai/providers` and active provider status payloads |
| `src/service/core/http-routes/config-provider-routes.mjs` | `/config/providers/*`, routing, model option API |
| `src/service/executors/shared/provider-resolver.mjs` | configured provider selection and hot reload |
| `src/service/executors/agentic/provider-adapter.mjs` | provider-specific LLM transport adapter |
| `src/service/executors/fast/fast-executor.mjs` | fast LLM transport through provider adapter |
| `src/service/executors/tool_using/agent-loop.mjs` | tool-using planner/provider selection |
| `src/service/executors/tool_using/final-composer.mjs` | final composer provider selection |
| `src/service/executors/agentic/planner.mjs` | agentic provider selection and adapter use |
| `src/service/executors/multi_modal/multi-modal-executor.mjs` | multimodal provider selection |
| `src/service/capabilities/tools/vision-analyze.mjs` | vision provider selection |
| `src/desktop/console/runtime-client.mjs` | HTTP client for `/ai/providers` only |
| `src/desktop/console/view-model.mjs` and `src/desktop/renderer/console.js` | provider UI through HTTP contracts only |

Renderer and desktop code must reach providers through IPC/HTTP contracts only.
They must not import provider runtime internals directly.

## Stable Contracts

The verifier locks these contracts:

- Provider owner files exist at `src/service/ai/providers/` before the physical
  move.
- Public exports remain available:
  `createAIProviderRegistry`, `BUILTIN_AI_PROVIDERS`,
  `createConfiguredAIProvider`, `createProviderModelDiscovery`, and
  `getBuiltinProviderStatus`.
- Built-in provider ids remain stable:
  `anthropic.claude-sonnet`, `openai.gpt-5.4-mini`, `kimi.k2`,
  `ollama.local`.
- Desktop UI/view-model files do not import provider runtime internals.
- Provider routes keep `/ai/providers`, `/config/providers/*`,
  `/ai/active-provider-for-task`, and provider model option contracts stable.
- Provider resolver/adapter boundaries remain separate from provider catalog
  inventory.
- Provider model discovery keeps curated fallback behavior and code-cli
  no-fetch behavior.

## Current Shape

```text
src/service/ai/providers/
  README.md
  builtin.mjs
  configured.mjs
  model-discovery.mjs
  registry.mjs
  runtime.mjs
```

Completion rules for the physical move:

- Every active import in product code, tests, scripts, and active docs must
  point at `src/service/capabilities/providers/`.
- `src/service/ai/providers/` must not remain as a compatibility barrel.
- `verify-provider-surface-contract.mjs`, `verify-provider-boundary.mjs`,
  `verify-provider-health.mjs`, `verify-provider-routing.mjs`,
  `verify-provider-streaming-parity.mjs`, `verify-prompt-cache-coverage.mjs`,
  `verify-provider-setup-onboarding.mjs`, `verify-ai-integrations.mjs`,
  `verify-service-core.mjs`, `verify-capability-roots.mjs`,
  `verify-structure.mjs`, and `verify-stale-owner-paths.mjs` must all agree on
  the owner.

## Risk

Risk level: high.

Reasons:

- Providers are the front door for LLM calls, configured provider setup,
  active model routing, provider health, model discovery, prompt-cache behavior,
  and provider UI state.
- Broken imports can affect fast chat, tool-using planning, final synthesis,
  agentic planning, vision analysis, `/ai/providers`, `/config/providers/*`,
  and model picker options.

No IPC channel names, HTTP route names, tool ids, artifact kinds, provider ids,
or storage schema may change during the move.
