# Vision Analyze Tool Boundary

CAP-1 high-risk family migration. Status: 2026-05-11, moved to `src/service/capabilities/tools/vision-analyze.mjs` after static, rejection-path, provider-gate, provider-branch, and stubbed success-path verification.

Current verifier coverage:
- `scripts/verify-vision-analyze-contract.mjs` locks the moved owner, registry,
  schema, allowlist, image limit, provider routing references, boundary doc,
  provider-boundary verifier coverage, and old-path removal.
- `scripts/verify-vision-analyze-runtime.mjs` executes runtime rejection paths:
  empty `image_paths`, unattached path refusal before filesystem/provider work,
  attached/file path allowlist construction, generated-image artifact
  collection, provider gate refusals, Anthropic/OpenAI branch selection through
  injected clients, and a stubbed successful `VISION_ANALYZE_TOOL.execute` path.

## Current State

- File: `src/service/capabilities/tools/vision-analyze.mjs`
- Tool: `VISION_ANALYZE_TOOL` (id: `vision_analyze`)
- Aggregated into `BUILTIN_ACTION_TOOLS` via `index.mjs`

## Dependencies

| Import | Current path | Notes |
|--------|-------------|----------------|
| `ACTION_TOOL_SCHEMAS` | `../schemas/index.mjs` | Schema surface unchanged |
| `createActionResult` | `../../capabilities/registry/types.mjs` | Result shape unchanged |
| `resolveProviderForTask` | `../../executors/shared/provider-resolver.mjs` | Unchanged |
| `callAnthropicVision` | `../../executors/multi_modal/multi-modal-executor.mjs` | Unchanged |
| `callOpenAIVision` | `../../executors/multi_modal/multi-modal-executor.mjs` | Unchanged |
| `loadImageAsBase64` | `../../executors/multi_modal/multi-modal-executor.mjs` | Unchanged |
| `path` | `node:path` | Unchanged |

## Provider Boundary

Uses `resolveProviderForTask` from the provider resolver (Phase 2G.1 locked).
Calls `callAnthropicVision` and `callOpenAIVision` — direct provider API calls
through the multi-modal executor, NOT through `provider-adapter.mjs`.

This is an approved exception: vision tools call multi-modal-specific APIs
that are not general-purpose provider calls. The provider boundary verifier
allows this because the calls go through `callAnthropicVision`/`callOpenAIVision`
wrappers, not raw `messages.create`.

## No-Touch Contracts

- Tool id `vision_analyze` must remain in `BUILTIN_ACTION_TOOLS`
- Provider resolution (`resolveProviderForTask`) and Vision API calls must not change
- `loadImageAsBase64` image loading must not change
- No IPC channels, HTTP routes, artifact kinds, or storage schema affected

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Provider resolution works at runtime | Medium | Provider boundary verifier + GUI smoke |
| Image loading path | Low | Uses absolute paths, no relative assumptions |
| BUILTIN_ACTION_TOOLS stability | Low | Tool registry snapshot verifier |

## Decision

Moved from the old action-tools owner to
`src/service/capabilities/tools/vision-analyze.mjs` in CAP-1 as a focused
high-risk tool-family move. The old owner path must not return as a
compatibility barrel or parallel implementation.

Remaining follow-up:
- Real GUI smoke does not yet exercise an actual configured vision provider.
- CAP-2 schemas/registry migration remains blocked until the remaining
  high-risk tool families are classified and reviewed.
