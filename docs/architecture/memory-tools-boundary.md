# Memory Tools Boundary

CAP-1 deferred family assessment. Status: 2026-05-11, boundary documented, not moved.

## Current State

- File: `src/service/action_tools/tools/memory-tools.mjs` (319 lines)
- Tools: `recall_memory`, `list_recent_tasks`, `get_task_detail`, `list_conversation_artifacts`
- All four are read-only, aggregated via `...MEMORY_TOOLS` into `BUILTIN_ACTION_TOOLS`

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

**Preflight only in this phase.** Memory tools are read-only with a single import and
no provider/network dependencies. Physical move is lower risk than vision-analyze but
still requires:
1. Contract verifier (current step)
2. `recall_memory.execute` with stubbed runtime store
3. `list_recent_tasks.execute` with stubbed store
4. `get_task_detail.execute` with stubbed store
5. `list_conversation_artifacts.execute` with stubbed store/artifact rows
