# Session Context Artifact Write Budget

RT-002 applies the RT-001 SQLite decision to session, context, and artifact
runtime writes. The current decision remains direct service-owned writes, with
strict boundaries that keep high-frequency stream deltas and heavy file work out
of durable hot paths.

## Scope

Owning phase: `RT-002: Session/Context/Artifact Write Budget Enforcement`.

Owning layer: service/runtime session, context, artifact extract, and artifact
lineage contracts.

Forbidden areas for this phase:

- Electron main, preload, renderer, and desktop UI behavior.
- IPC channels, HTTP routes, tool ids, artifact kinds, provider ids, and
  storage schema.
- Provider/model call semantics and connector behavior.
- Queue/worker implementation changes without measured evidence.

## RT-001 Decision Applied

RT-001 decided to keep direct service-owned SQLite writes. RT-002 applies that
decision as follows:

- Critical session continuity writes remain direct and durable.
- Context compilation does not write a new trace table; it stamps compact
  `context_packet.compiled_context` into the task record created by
  `src/service/core/task-runtime/task-record.mjs`.
- Artifact records and lineage writes remain direct because artifact success and
  transform success depend on them.
- Artifact extract writes remain direct service writes, but extraction work is
  owned by `artifactExtractBackgroundLane` and worker contracts rather than by
  Electron UI or executor stream loops.
- No DB queue or DB worker is introduced in RT-002.

## Budgeted Write Surfaces

| Surface | Current owner | Write method | Budget class | Enforcement |
| --- | --- | --- | --- | --- |
| User message and task anchor session items | `src/service/core/session/conversation-session-service.mjs` | `appendItem` -> `store.appendSessionItem` | critical continuity | Written only from task submission/session service. |
| Tool call and observation session items | `src/service/core/session/conversation-session-service.mjs` | `recordTaskEvent` -> `appendItem` | normal runtime | `TOOL_EVENT_TYPES` limits recording to tool call/proposal/completion/denial events. |
| High-frequency stream deltas | `src/service/core/task-runtime/event-emitter.mjs` | none for session/SQLite | live-only | `text_delta`, `tool_input_delta`, `reasoning_delta`, and `tool_planner_decision` remain ephemeral. |
| Compiled context | `src/service/core/task-runtime/task-record.mjs` | task record `context_packet.compiled_context` | critical task metadata | `ContextCompiler` is read-only with metrics; no separate trace table is written in RT-002. |
| Artifact extracts | `src/service/core/artifact-extracts/artifact-extract-service.mjs` | `appendExtract` -> `store.appendArtifactExtract` | normal/background | Text is bounded; background lane controls timeout, progress, and concurrency. |
| Artifact extract background lane | `src/service/core/artifact-extracts/artifact-extract-background-lane.mjs` | `artifactExtracts.appendExtract` after worker result | background | Queue snapshot exposes queued/running/max concurrency; failures write structured extract records. |
| Artifact lineage | `src/service/core/artifact-lineage/artifact-lineage-service.mjs` | `appendLineage` / `appendTransformLineage` -> `store.appendArtifactLineage` | critical transform contract | Transform lineage requires source artifacts and validates target/source/extract contract. |

## Context Trace Decision

RT-002 does not add `context_compile_traces`.

The current canonical trace storage for normal runtime is:

- compact `task.context_packet.compiled_context`;
- Context Debug Panel lazy rendering/copy behavior;
- runtime metrics for `context.compile`.

RT-003 will decide whether a persistent trace table is still needed. Until then,
full traces remain opt-in debug data and must not become a default durable write
path.

## Hot-Path Rules

- Executors must not call `appendSessionItem`, `appendArtifactExtract`, or
  `appendArtifactLineage` directly.
- Electron desktop code must not call session/artifact persistence methods.
- ContextCompiler must not write task, session, artifact, or event records.
- Tool stream deltas must not become session items or SQLite task events.
- Artifact extraction may enqueue background work, but file parsing must remain
  outside Electron main and renderer paths.

## Queue Reconsideration Gate

A queue or DB worker remains a later option only if one of these is proven:

- session item writes become frequent enough to affect first-token or streaming
  latency;
- artifact extract or lineage writes block artifact generation completion;
- context trace storage is expanded beyond compact task metadata in RT-003;
- SQLite write timings show sustained budget misses under realistic tasks.

If any of those happen, RT-002's verifier should be updated only after the new
queue contract has behavior tests for priority ordering, flush failure, shutdown
drain, and low-priority backpressure.

## Verification

`scripts/verify-session-context-artifact-write-budget.mjs` locks this phase by
checking:

- the document and required sections exist;
- the verifier is wired into full and fast checks;
- ConversationSession records only bounded task/tool session items;
- ContextCompiler is read-only and task creation stamps compact compiled
  context;
- artifact extracts are bounded and background-lane controlled;
- artifact lineage is still a critical transform contract write;
- desktop and executor code do not directly own session/artifact persistence
  writes.
