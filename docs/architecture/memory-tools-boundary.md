# Memory Tools Boundary

CAP-1 deferred family assessment. Status: 2026-05-11, boundary and runtime
preflight documented, not moved.

## Current State

- File: `src/service/capabilities/tools/memory-tools.mjs` (319 lines)
- Tools: `recall_memory`, `list_recent_tasks`, `get_task_detail`, `list_conversation_artifacts`
- All four are read-only, aggregated via `...MEMORY_TOOLS` into `BUILTIN_ACTION_TOOLS`

## Current Verifier Coverage

- `scripts/verify-memory-tools-contract.mjs` locks the current old owner,
  exports, tool ids, read-only shape, store/embeddingStore access, and boundary
  document.
- `scripts/verify-memory-tools-runtime.mjs` executes all four tools with
  stubbed runtime surfaces, including semantic recall filtering, recent-task
  filtering, task detail artifact metadata, and conversation artifact metadata.

## Dependencies

| Import | Current path | Post-move path |
|--------|-------------|----------------|
| `createActionResult` | `../types.mjs` | `../../action_tools/types.mjs` |

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

**Preflight only in this phase.** Memory tools are read-only with a single import
and no provider/network dependencies. Static and runtime preflight coverage now
exists, but the file is intentionally not moved in the same phase. A physical
move must be a separate commit that updates imports/inventories, adds old-path
guards, and reruns the runtime verifier after the path change.
