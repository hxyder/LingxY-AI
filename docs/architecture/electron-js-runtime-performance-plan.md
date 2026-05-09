# Electron JS Runtime Performance Plan

This plan is the performance companion to
`docs/architecture/agent-runtime-spine.md`. The agent runtime upgrade must not
solve context and memory correctness by moving expensive work into Electron main
process or renderer code.

## Guardrails

- Electron main process owns app lifecycle, windows, IPC boundaries, and small
  coordination work only.
- Renderer code owns UI presentation, local interaction state, and batched
  display updates only.
- Heavy indexing, context compilation, extraction, graph execution, model calls,
  long file scans, and artifact transforms must run in service/runtime modules,
  workers, child processes, or bounded background lanes.
- Streaming UI updates must be batched so token or event bursts do not force a
  render per chunk.
- Runtime features must expose baseline metrics before broad wiring.
- Performance fixes must be verifiable by scripts, smoke tests, or captured
  timing thresholds.
- Every program-upgrade PR must pass the mandatory upgrade PR protocol from
  `AGENTS.md` and `docs/architecture/agent-runtime-spine.md`: module
  boundaries, architecture rules file, upgrade task scope, forbidden
  modification areas, interface contracts, test gate, design-before-generation,
  patch check, replacement discipline, and legacy removal discipline. This is
  not a runtime requirement for every user task.

## PR Sequence

| Step | Scope | Acceptance |
| --- | --- | --- |
| PR-01 | Docs and `AGENTS.md` guardrails | Done |
| PR-02 | Performance baseline instrumentation | Done |
| PR-03 | Main process blocking verifier | Done |
| PR-04 | Renderer streaming batching verifier and fixes | Done |
| PR-05 | Context compiler off hot Electron paths | Done |
| PR-06 | Artifact extraction background lane | Done |
| PR-07 | Runtime graph scheduling budget | Done |
| PR-08 | Desktop GUI perf smoke | Startup and interaction smoke reports remain bounded |

## PR-01 Status

Status: done in this PR.

Verification:

- `node scripts/verify-runtime-upgrade-guardrails.mjs`
- `node scripts/verify-structure.mjs`

## PR-02 Status

Status: done.

Implementation:

- `src/service/metrics/registry.mjs` owns runtime baseline timers and counters.
- `src/service/core/service-bootstrap.mjs` records `service.bootstrap.create_runtime`
  and `service.bootstrap.created`.
- `/metrics` includes `uca_runtime_timing_*` and `uca_runtime_counter_total`.
- `runtime.metrics.snapshot()` includes `runtime_baseline`.
- Electron main and renderer do not own the baseline instrumentation.

Verification:

- `npm run verify:runtime-performance-baseline`
- `npm run verify:runtime-upgrade-guardrails`
- `node scripts/verify-status-metrics.mjs`
- `node scripts/verify-structure.mjs`
- `npm run check:fast`

## PR-03 Status

Status: done.

Implementation:

- `scripts/verify-main-process-blocking.mjs` scans `index.cjs` and
  `src/desktop/tray` for sync filesystem APIs, sync child-process APIs,
  `Atomics.wait`, busy waits, and oversized IPC handlers.
- `src/desktop/tray/brand-icons.mjs` resolves icon files asynchronously and
  preloads PNG bytes into an in-memory cache before tray badge composition.
- `src/desktop/tray/electron-main.mjs` no longer uses `mkdirSync`; crash dump
  and GUI-smoke directories are created with async filesystem calls.
- The dock menu IPC handler delegates to focused helper functions instead of
  embedding a long block of menu and cleanup logic inline.

Verification:

- `npm run verify:main-process-blocking`
- `node scripts/verify-brand-assets.mjs`
- `node scripts/verify-desktop-shell.mjs`
- `node scripts/verify-structure.mjs`
- `npm run check:fast`

## PR-04 Status

Status: done.

Implementation:

- `scripts/verify-renderer-stream-batching.mjs` guards renderer streaming
  surfaces against per-frame DOM mutation regressions.
- Console chat text deltas and reasoning deltas are queued and flushed on a
  render frame.
- Overlay assistant text deltas and thinking deltas are queued and flushed on a
  render frame.
- Selected task detail SSE frames are batched before task-detail rendering.
- Existing live preview delta batching and preview-window streaming debounce are
  pinned by the verifier.

Verification:

- `npm run verify:renderer-stream-batching`
- `node scripts/verify-desktop-renderer.mjs`
- `node scripts/verify-console-ui.mjs`
- `node scripts/verify-structure.mjs`
- `npm run check:fast`
- `npm run verify:desktop-gui-smoke`

## PR-05 Status

Status: done.

Implementation:

- ContextCompiler service/runtime boundary is established by
  `src/service/core/context/context-compiler.mjs`.
- Compiled context items are typed and include deterministic reasons for why
  each item was selected.
- Default output is compact; debug candidate traces are opt-in.
- Runtime baseline metrics record `context.compile` timing and selected/omitted
  context item counters.
- `scripts/verify-context-compiler-boundary.mjs` blocks Electron desktop code
  from importing or owning ContextCompiler logic.

Verification:

- `npm run verify:context-compiler-boundary`
- `node --test tests/behavior/context-compiler.test.mjs`
- `node scripts/verify-structure.mjs`
- `npm run check:fast`

Conversation/session spine status:

- CX-001 is done: ConversationSession service-owned storage exists through
  `conversation_sessions` and `session_items`. Task submission writes only the
  durable user-message/task-anchor skeleton; high-frequency deltas remain out of
  session_items.
- CX-002 is done: tool call and tool observation events are persisted as typed
  session_items while streaming deltas remain excluded.
- CX-003 is done: FollowUpResolver uses typed session anchors for follow-up
  parent selection, writes resolver decisions into task context metadata, and
  retires old lifecycle follow-up resolver call sites.
- CX-004 is done: ContextCompiler V1 stamps compact `compiled_context` on task
  context after session/follow-up enrichment, with deterministic priorities,
  inclusion reasons, and typed session item evidence.
- AX-001 is done: typed `artifact_extracts` records and service/store methods
  exist, and ContextCompiler can select existing extracts without parsing files
  in Electron or the task creation hot path.
- AX-002 is done: typed `artifact_lineage` records and semantic transform
  contracts are persisted and validated in the service layer without Electron
  main/renderer work or blocking artifact IO.
- AX-003 is done: the service layer owns the first typed `xlsx_to_pptx`
  transform flow, consuming existing extracts and writing lineage without
  Electron main/renderer work or source-file parsing in the transform path.
- MX-001 is done: memory governance adds reviewed memory/proposal surfaces and
  scoped background-context selection without moving memory learning into
  Electron main/renderer hot paths.
- MX-002 is done: service-owned `session_compactions` records summarize older
  typed session_items deterministically for ContextCompiler without model calls,
  transcript scraping, or Electron main/renderer work.
- UX-001 is done: the Context debug panel renders compact selected/omitted
  context summaries by default and lazy-copies full JSON only on demand, so raw
  giant traces are not rendered in the task detail hot path.
- GX-001 is done: runtime graph node metadata and
  `runtime_graph_checkpoint` task events are recorded in service/runtime code
  from existing task events without moving graph execution or checkpoint work
  into Electron main process or renderer code.
- GX-002 is done: replay/fork checkpoint planning is a service-layer contract
  over durable task events; it does not move graph execution or time-travel work
  into Electron main process or renderer code.
- PR-06 is done: `artifactExtractBackgroundLane` queues artifact extraction
  work behind a service-owned background lane with progress events, timeouts,
  AbortSignal support, and structured failed/partial `ArtifactExtract` records.
  The worker foundation lives under `src/service/workers/` and imports no
  Electron main process or renderer code.
- PR-07 is done: `runtimeGraphScheduler` provides a service-owned scheduling
  budget for graph node work with global concurrency, per-session serialization,
  bounded queue depth, AbortSignal cancellation, node timeouts, and budget
  snapshots. It does not replace the still-reachable scheduler/template DAG
  path under `src/service/dag`.

Current next step: PR-08, desktop GUI perf smoke.

## Sidecar Decision Gate

Keep implementation in the existing JavaScript/Electron stack until a measured
limit proves that a worker, child process, native helper, or sidecar is required.
A sidecar proposal must include:

- The measured bottleneck.
- Why an in-process service, worker, or child process is insufficient.
- Serialization and cancellation boundaries.
- Failure behavior and user-visible recovery.
- A rollback path.

## Legacy Cleanup Rule

Old Electron or runtime paths may be archived only after their imports,
registrations, package scripts, and runtime callers are checked. Prefer a
dedicated cleanup PR after the new path is verified when same-PR removal is
risky, but replace old call sites immediately when the new framework path has
verifier coverage. Once replacement is proven, delete obsolete code or move it
to a clear archive area and verify stale references, duplicate entry points,
duplicate route/script registrations, and variable/name collisions are gone.
