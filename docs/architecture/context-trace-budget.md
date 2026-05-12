# Context Trace Budget

RT-003 reconciles the older persistent `context_compile_traces` idea with the
current compact compiled-context implementation.

## Scope

Owning phase: `RT-003: Context Trace Persistence And Budget Audit`.

Owning layer: service/runtime context compilation and desktop read-only context
debug display.

Forbidden areas for this phase:

- Storage schema changes.
- Electron main, preload, renderer behavior changes.
- Provider/model calls, tool ids, artifact kinds, IPC channels, HTTP routes, and
  connector behavior.
- Adding a persistent context trace table without measured need.

## Current Canonical Trace Storage

Decision: compact task metadata is the canonical context trace storage for the
current program.

The canonical path is:

1. `src/service/core/context/context-compiler.mjs` compiles a bounded
   `CompiledContext`.
2. `src/service/core/task-runtime/task-record.mjs` stamps it into
   `task.context_packet.compiled_context` once during task creation.
3. `src/desktop/renderer/console-task-detail.mjs` renders compact selected and
   omitted summaries from the already-stamped task detail.
4. `src/desktop/renderer/console.js` serializes full compiled context JSON only
   when the user clicks the copy control.

RT-003 does not add `context_compile_traces`. The SQLite schema remains without
a context trace table.

## Budget Contract

Default ContextCompiler limits:

- `maxItems: 32`
- `maxTextChars: 8000`
- `maxOmissions: 64`
- `sessionItemLimit: 200`
- `artifactExtractLimit: 24`
- `perArtifactExtractLimit: 4`

Default trace shape:

- `selected` items are bounded.
- `omissions` are bounded.
- `omitted_count` preserves the full omitted count without storing all omitted
  payloads.
- `debug_trace` is absent by default and appears only when `debug: true` is
  explicitly passed.
- ContextCompiler records `context.compile` runtime timing metrics.

RT-003 does not enforce a hard `context_compile_ms` threshold in product code.
The current enforcement is structural: compact default output, bounded selected
and omitted lists, metrics for timing, and lazy full-JSON copying. A future hard
threshold belongs in an eval/perf trend phase after enough measured samples
exist.

## Read And Write Boundaries

ContextCompiler may read:

- task command and task metadata;
- typed session items and session compactions;
- FollowUpResolver decisions;
- recent artifacts and typed artifact extracts;
- explicit attachments and background contexts.

ContextCompiler must not:

- write task, session, event, artifact, or context-trace records;
- scrape visible `conversation_messages` directly;
- read artifact files on the task creation hot path;
- import desktop/Electron/renderer modules;
- emit full candidate traces unless `debug: true`.

Desktop context debug code may render and copy the already-stamped compiled
context, but it must not run ContextCompiler or fetch a separate full trace by
default.

## Reconsideration Gate

A persistent `context_compile_traces` table can be reconsidered only if RT-003
or later proves one of these:

- task metadata is insufficient for support/debug export;
- context trace history is needed across task rewrites or pruning;
- eval trend storage needs normalized trace rows instead of task snapshots;
- measured trace size remains within budget with a separate table.

If added later, full traces must be opt-in or low-priority, bounded by byte
size, and guarded by a verifier and behavior tests.

## Verification

`scripts/verify-context-trace-budget.mjs` locks this decision by checking:

- this document and the post-runtime roadmap record the compact-task-metadata
  decision;
- the check manifest runs the verifier in full and fast gates;
- SQLite schema/store do not add `context_compile_traces`;
- ContextCompiler default limits and debug-only trace behavior remain in place;
- task creation stamps `compiled_context`;
- context debug UI keeps full JSON copy-only and does not embed it in DOM
  attributes;
- desktop code does not import or run ContextCompiler.
