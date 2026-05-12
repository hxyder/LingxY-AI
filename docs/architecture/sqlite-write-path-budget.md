# SQLite Write Path Budget

RT-001 records the current SQLite write-path inventory and the queue/worker
decision for the post-runtime roadmap. It is intentionally an audit and
guardrail phase, not a product behavior change.

## Scope

Owning phase: `RT-001: SQLite Write-Path Audit And Queue Decision`.

Owning layer: service/runtime persistence.

Forbidden areas for this phase:

- Electron main, preload, renderer, and desktop UI behavior.
- IPC channels, HTTP routes, tool ids, artifact kinds, provider ids, and
  storage schema.
- Runtime task, session, artifact, provider, connector, or scheduler semantics.

Interface contracts checked by this phase:

- SQLite ownership remains service-only.
- High-frequency stream deltas remain outside SQLite task event persistence.
- Critical recovery writes stay direct and durable.
- Any future write queue or DB worker must be service-owned and must not move
  batching into Electron main or renderer code.

## Current Store Owners

| Path | Responsibility | Priority | Notes |
| --- | --- | --- | --- |
| `src/service/core/store/sqlite-store.mjs` | Main `better-sqlite3` owner, prepared statements, WAL setup, task/event/artifact/session/schedule/connector writes | critical/normal | Single product source file that imports `better-sqlite3`. |
| `src/service/core/store/sqlite-schema.mjs` | Table/index schema and store manifest | critical | Declares `ownership: "service-only"`, `writeMode: "wal"`, and `eventPersistenceOrder: "persist-before-broadcast"`. |
| `src/service/core/store/search-index.mjs` | Unified search FTS writes through the service store DB handle | low/normal | Receives the DB handle from service bootstrap; not a second application store owner. |
| `src/service/core/store/migrations/*.mjs` | Additive schema migrations and backfills | maintenance | Startup-only migration surface. |
| `src/service/core/persistent-runtime.mjs` | Creates the SQLite store from runtime paths | lifecycle | Composition owner only. |
| `src/service/core/service-bootstrap.mjs` | Attaches search index when the store exposes `db` | lifecycle | Does not create SQLite connections. |

Tests and verifiers may create temporary SQLite databases. They are not product
write owners.

## Current Write-Path Inventory

| Write group | Store method or owner | Priority class | Hot-path assessment |
| --- | --- | --- | --- |
| Task creation/update/terminal state | `insertTask`, `updateTask`, `deleteTask` | critical control write | Direct durable write is acceptable; task recovery depends on it. |
| Task events | `appendEvent` via `emitTaskEvent` | critical/normal event write | Direct durable write is acceptable because high-frequency deltas are filtered before `appendEvent`. |
| JSONL task logs | `persistTaskEvent` | low diagnostic write | Async, best-effort, per-task serialized; not SQLite. |
| Artifacts | `appendArtifact` | critical artifact write | Direct durable write is required before success can be trusted. |
| Artifact extracts | `appendArtifactExtract` | normal/background write | Background extraction writes are bounded by worker/lane contracts; direct service write remains acceptable. |
| Artifact lineage | `appendArtifactLineage` | critical transform-contract write | Transactional direct write is required for transform success semantics. |
| Pending approvals | `appendPendingApproval`, `updatePendingApproval` | critical control write | Approval-required/reject/resume recovery depends on direct durability. |
| Schedules and runs | `insertSchedule`, `updateSchedule`, `appendScheduleRun`, `updateScheduleRun`, `deleteSchedule` | critical/normal control write | Direct writes are acceptable; scheduler dispatch is not a token-stream hot path. |
| Audit logs | `appendAuditLog` | normal/security trace write | Direct write is acceptable; not high-frequency stream data. |
| Connected accounts, OAuth tokens, reauth requests | `upsertConnectedAccount`, `upsertOAuthToken`, `upsertReauthRequest`, deletes | critical connector state write | Direct write is required for account/token consistency. |
| Conversations and messages | `insertConversation`, `appendMessage`, `linkMessageToTask`, conversation updates/deletes | critical continuity write | Direct write is required for visible transcript and follow-up continuity. |
| Conversation sessions and session items | `upsertConversationSession`, `appendSessionItem` | critical/normal runtime continuity write | Direct write is acceptable; high-frequency deltas are excluded and session observation is fail-soft. |
| Session compactions | `appendSessionCompaction` | low/normal context maintenance write | Direct write is acceptable; deterministic compaction is not in the stream delta path. |
| Unified search index | `search-index.mjs` | low/background index write | Service-owned indexing surface; may be revisited only if measured indexing stalls appear. |
| Startup migrations | `migrations/*.mjs` | maintenance | Runs at store startup; not a runtime stream path. |

## Priority Classes

Critical control writes:

- task created, task terminal state, cancellation, failure, and partial success.
- approval required, approval decision, approval resume metadata.
- user-visible conversation messages and message/task links.
- artifact records needed before reporting artifact success.
- artifact lineage required by transform success contracts.
- connector account and token state.

Normal runtime writes:

- non-ephemeral task events.
- tool call and tool observation session items.
- schedule run updates.
- artifact extracts produced by background lanes.
- audit log entries.

Low-priority diagnostic and maintenance writes:

- JSONL task logs.
- session compactions.
- unified search index rebuild/update work.
- future eval/perf trend storage.
- future full context trace exports if RT-003 chooses persistent traces.

Background maintenance writes:

- startup migrations and backfills.
- search index rebuilds.
- cleanup and retention operations.

## Queue Decision

Decision: keep direct service-owned SQLite writes for the current program.

Rationale:

- The current product SQLite owner is concentrated in
  `src/service/core/store/sqlite-store.mjs`.
- The store already runs in WAL mode and is declared service-only.
- Electron main, preload, renderer, and desktop UI code do not own SQLite
  connections or write batching.
- The hottest stream event classes are already excluded from SQLite task event
  persistence: `text_delta`, `tool_input_delta`, `reasoning_delta`, and
  `tool_planner_decision`.
- JSONL task logs skip token/tool/reasoning deltas and are async best-effort.
- Artifact extraction and runtime graph scheduling already run through
  service-owned background/scheduling contracts rather than Electron UI paths.
- There is no current measured evidence in this phase that a queue or DB worker
  is required.

Therefore RT-001 does not implement a queue. A future queue/worker may be added
only if a measured hot path or broad state growth proves direct service writes
are no longer within budget.

## Future Queue Requirements

If RT-002 or later introduces a queue, it must satisfy these invariants before
product behavior is switched to it:

- Critical writes remain durable before success/recovery claims.
- Ordering is preserved for `session_items` and task lifecycle records.
- Queue metrics expose depth, oldest age, flush latency, dropped low-priority
  writes, and last error.
- Shutdown attempts a bounded drain.
- Electron main, preload, renderer, and desktop UI code still do not own DB
  batching or SQLite connections.
- Behavior tests cover priority ordering, flush failure, shutdown drain, and
  low-priority backpressure.

## Guardrails

The verifier `scripts/verify-sqlite-write-path-budget.mjs` locks this audit by
checking:

- this document and its required sections exist;
- the check manifest runs the verifier in both full and fast gates;
- product `better-sqlite3` imports remain in the service store owner;
- desktop code does not import SQLite/store internals or use DB prepare calls;
- SQLite schema manifest continues to declare service-only WAL ownership;
- high-frequency event classes are filtered before SQLite task-event writes;
- `persistTaskEvent` remains async/best-effort and skips stream deltas in JSONL.

RT-002 starts from this decision instead of assuming a queue is already needed.
