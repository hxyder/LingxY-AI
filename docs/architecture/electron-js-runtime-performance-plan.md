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
  and patch check. This is not a runtime requirement for every user task.

## PR Sequence

| Step | Scope | Acceptance |
| --- | --- | --- |
| PR-01 | Docs and `AGENTS.md` guardrails | Done |
| PR-02 | Performance baseline instrumentation | Done |
| PR-03 | Main process blocking verifier | Done |
| PR-04 | Renderer streaming batching verifier and fixes | Done |
| PR-05 | Context compiler off hot Electron paths | Context assembly stays in service/runtime layer |
| PR-06 | Artifact extraction background lane | Extract/transform work does not block UI |
| PR-07 | Runtime graph scheduling budget | Graph execution has concurrency and cancellation guards |
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

Current next step: PR-05, keeping context compilation off hot Electron paths.

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
dedicated cleanup PR after the new path is verified, not opportunistic deletion
inside a behavior PR.
