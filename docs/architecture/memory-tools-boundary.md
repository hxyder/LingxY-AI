# Memory Tools Boundary

CAP-1 high-risk family migration. Status: 2026-05-11, moved to
`src/service/capabilities/tools/memory-tools.mjs` after static and runtime
preflight verification.

## Current State

- File: `src/service/capabilities/tools/memory-tools.mjs` (319 lines)
- Tools: `recall_memory`, `list_recent_tasks`, `get_task_detail`, `list_conversation_artifacts`
- All four are read-only, aggregated via `...MEMORY_TOOLS` into `BUILTIN_ACTION_TOOLS`

## Current Verifier Coverage

- `scripts/verify-memory-tools-contract.mjs` locks the moved owner, old-path
  removal, exports, tool ids, read-only shape, store/embeddingStore access, and
  boundary document.
- `scripts/verify-memory-tools-runtime.mjs` executes all four tools with
  stubbed runtime surfaces, including semantic recall filtering, recent-task
  filtering, task detail artifact metadata, and conversation artifact metadata.

## Dependencies

| Import | Current path | Notes |
|--------|-------------|----------------|
| `createActionResult` | `../../action_tools/types.mjs` | Result shape unchanged |

No other imports. The module accesses `runtime.store` and `runtime.platform.embeddingStore`
through the `ctx` parameter at runtime.

## Session / Memory Boundary

- `runtime.store` — task store (sqlite), read-only access
- `runtime.platform.embeddingStore` — semantic search, read-only access
- All four tools are read-only, no writes, no network calls
- `recall_memory` uses `extractArtifactPaths` helper (local function, no external deps)

## No-Touch Areas

- Tool ids: `recall_memory`, `list_recent_tasks`, `get_task_detail`, `list_conversation_artifacts`
- `BUILTIN_ACTION_TOOLS` aggregation via `...MEMORY_TOOLS` spread
- Runtime store and embedding store access patterns
- `extractArtifactPaths` helper logic

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Single import (`createActionResult`) | Low | Standard CAP-1 path fix |
| Runtime store access through ctx | Low | No path-dependent logic |
| `...MEMORY_TOOLS` spread in index.mjs | Low | Import path update only |

## Decision

Moved from the old action-tools owner to
`src/service/capabilities/tools/memory-tools.mjs` in CAP-1 as a focused
read-only memory/session tool-family move. The old owner path must not return
as a compatibility barrel or parallel implementation.

Remaining follow-up:
- `skill-install-tools.mjs` is still blocked from physical move until approval,
  contentHash, and surface-gating runtime verification exists.
- CAP-2 schemas/registry migration remains blocked until the remaining
  high-risk tool families are classified and reviewed.
