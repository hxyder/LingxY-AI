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

## PR Sequence

| Step | Scope | Acceptance |
| --- | --- | --- |
| PR-01 | Docs and `AGENTS.md` guardrails | Guardrails are discoverable and verified |
| PR-02 | Performance baseline instrumentation | Timers and counters exist outside hot UI paths |
| PR-03 | Main process blocking verifier | Script flags sync IO, CPU loops, and long handlers in main |
| PR-04 | Renderer streaming batching verifier and fixes | Streaming bursts are coalesced and smoke-tested |
| PR-05 | Context compiler off hot Electron paths | Context assembly stays in service/runtime layer |
| PR-06 | Artifact extraction background lane | Extract/transform work does not block UI |
| PR-07 | Runtime graph scheduling budget | Graph execution has concurrency and cancellation guards |
| PR-08 | Desktop GUI perf smoke | Startup and interaction smoke reports remain bounded |

## PR-01 Status

Status: done in this PR.

Verification:

- `node scripts/verify-runtime-upgrade-guardrails.mjs`
- `node scripts/verify-structure.mjs`

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

