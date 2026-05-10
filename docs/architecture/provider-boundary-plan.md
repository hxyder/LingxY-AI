# Provider Boundary Plan

Phase 2G inventory of provider resolution and call sites.
Status: verified against the current repository on 2026-05-10.

## Owner Surfaces

| Surface | Path | Role |
| --- | --- | --- |
| Provider adapter | `src/service/executors/agentic/provider-adapter.mjs` | Primary provider call boundary |
| Provider resolver | `src/service/executors/shared/provider-resolver.mjs` | Provider selection and resolution |
| Semantic router | `src/service/embeddings/semantic.mjs` | Inline price-based model routing |

## Provider Resolution Call Sites

All call sites go through `resolveProviderForTask` from `provider-resolver.mjs`:

| Caller | Path | Import style |
| --- | --- | --- |
| Fast executor | `src/service/executors/fast/fast-executor.mjs` | Static |
| Agent loop (tool_using) | `src/service/executors/tool_using/agent-loop.mjs` | Static |
| Final composer | `src/service/executors/tool_using/final-composer.mjs` | Static |
| Agentic planner | `src/service/executors/agentic/planner.mjs` | Static |
| Provider adapter (agentic) | `src/service/executors/agentic/provider-adapter.mjs` | Dynamic |
| Multi-modal executor | `src/service/executors/multi_modal/multi-modal-executor.mjs` | Static |
| Vision analyze tool | `src/service/action_tools/tools/vision-analyze.mjs` | Static |
| Browser submission | `src/service/core/browser-submission.mjs` | Static |
| Context submission | `src/service/core/context-submission.mjs` | Static |
| File submission | `src/service/core/file-submission.mjs` | Static |
| Image submission | `src/service/core/image-submission.mjs` | Static |
| DAG streaming planner | `src/service/dag/streaming-planner.mjs` | Dynamic |
| DAG planner | `src/service/dag/planner.mjs` | Dynamic |
| Runnable executor | `src/service/core/planning/runnable-executor.mjs` | Static |
| Audio HTTP routes | `src/service/core/http-routes/audio-routes.mjs` | Static |
| Config provider routes | `src/service/core/http-routes/config-provider-routes.mjs` | Static |
| Semantic router (intent) | `src/service/core/intent/semantic-router.mjs` | Static |

| File ingest | `src/service/extractors/file-ingest.mjs` | Static (comment reference) |

~18 call sites. All go through the same `resolveProviderForTask` function.

## Provider Adapter Call Sites

All call sites go through `createProviderAdapter` from `provider-adapter.mjs`:

| Caller | Path |
| --- | --- |
| Agent loop (tool_using) | `src/service/executors/tool_using/agent-loop.mjs` |
| Final composer | `src/service/executors/tool_using/final-composer.mjs` |
| Agentic planner | `src/service/executors/agentic/planner.mjs` |
| Fast executor | `src/service/executors/fast/fast-executor.mjs` |

~4 call sites. All go through the same `createProviderAdapter` function.

## Direct Provider Calls (Exceptions)

The semantic router (`src/service/embeddings/semantic.mjs`) dynamically imports
`provider-resolver.mjs` at line 30 for price-based model routing. This is the
only module that uses provider resolution outside the executor/submission pipeline.

No modules bypass `provider-adapter.mjs` for direct provider HTTP calls.

## Boundary Rules

- `provider-resolver.mjs` is the single resolution entry point. No new
  provider resolution paths may be created outside this module.
- `provider-adapter.mjs` is the single provider call boundary. No new
  direct provider HTTP/streaming calls may be created outside this module.
- `src/service/embeddings/semantic.mjs` (dynamic import) and
  `src/service/core/intent/semantic-router.mjs` (both resolver + adapter) are
  the approved out-of-pipeline callers. `src/service/extractors/file-ingest.mjs`
  references provider-resolver only in a comment (not a runtime call).
- Provider config/secrets must not be read synchronously on hot paths.
- Cached provider config resolver is a candidate for Phase 2G.2.

## Verification

Run:

```powershell
node scripts/verify-provider-boundary.mjs
```
