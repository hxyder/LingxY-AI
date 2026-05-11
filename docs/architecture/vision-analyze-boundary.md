# Vision Analyze Tool Boundary

CAP-1 deferred family assessment. Status: 2026-05-11, boundary documented, not moved.

Current preflight coverage:
- `scripts/verify-vision-analyze-contract.mjs` locks the static owner, registry,
  schema, allowlist, image limit, provider routing references, and deferred
  status.
- `scripts/verify-vision-analyze-runtime.mjs` executes early runtime rejection
  paths: empty `image_paths`, unattached path refusal before filesystem/provider
  work, attached/file path allowlist construction, and generated-image artifact
  collection.
- These verifiers are necessary but not sufficient for a physical move. They do
  not execute a successful `VISION_ANALYZE_TOOL.execute` path through a stubbed
  provider resolver and stubbed multi-modal vision calls.

## Current State

- File: `src/service/action_tools/tools/vision-analyze.mjs` (279 lines)
- Tool: `VISION_ANALYZE_TOOL` (id: `vision_analyze`)
- Aggregated into `BUILTIN_ACTION_TOOLS` via `index.mjs`

## Dependencies

| Import | Current path | Post-move path |
|--------|-------------|----------------|
| `ACTION_TOOL_SCHEMAS` | `../schemas/index.mjs` | `../../action_tools/schemas/index.mjs` |
| `createActionResult` | `../types.mjs` | `../../action_tools/types.mjs` |
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

## No-Touch Areas (do not change during move)

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

**Not moved in this phase.** Vision analyze is a provider-boundary tool with
real runtime behavior. Moving it requires:
1. GUI smoke coverage for vision tool usage (not currently in 44-check suite)
2. Provider boundary verification that Vision API calls still work from new path
3. Runtime test that `vision_analyze` tool executes correctly

Prefer moving this only after the vision-specific gates exist:
- Vision tool runtime test coverage exists for `VISION_ANALYZE_TOOL.execute`
  with provider resolution and multi-modal vision calls stubbed
- Provider boundary verifier covers multi-modal executor paths
- The owner map and stale old-path guards are updated in the same phase

Do not use CAP-2 schemas/registry migration as a prerequisite or shortcut for
this move. CAP-2 remains blocked until CAP-1 closure and high-risk tool
classification are fully reviewed.
