# Agent Runtime Spine

This document is the canonical implementation spine for the memory,
conversation, task, context, artifact, and execution-graph upgrade. It exists to
keep the upgrade organized as framework work instead of isolated patches.

## Problem Statement

Follow-up understanding fails when conversation history, task state, memory,
tools, artifacts, and observations are gathered as disconnected prompt material.
The model then has to infer durable state from partial text windows. That makes
short follow-ups, artifact references, task resumption, and cross-step reasoning
fragile.

The fix is a typed runtime spine:

`ConversationSession -> FollowUpResolver -> ContextCompiler -> ArtifactExtracts -> ArtifactLineage -> SemanticContracts -> ContextDebug -> EvalCorpus -> GraphCheckpoints`

Each step must produce inspectable data and verifiable behavior. Prompt wording
can explain the data to the model, but prompt wording is not the system of
record.

## Runtime Invariants

- Conversation state is durable, ordered, and session-scoped.
- Task state is linked to the session that created or resumed it.
- Tool calls and tool observations are first-class session items.
- Context assembly is deterministic enough to inspect and test.
- Follow-up resolution uses typed anchors such as recent artifacts, active task,
  selected files, explicit user references, and current UI state.
- Artifact content is represented by typed extracts, not only by file paths or
  generated prose.
- Artifact lineage records source, transform, output, and contract validation.
- Context debugging shows why a context item was included, excluded, compacted,
  or promoted.
- Broad behavior changes require regression seeds before wide wiring.
- Legacy paths are retired only after reachability and replacement behavior are
  verified.

## Mandatory Upgrade PR Protocol

Every program-upgrade PR in this runtime spine starts with an explicit intake.
The intake is the design stage before code generation and is part of the
engineering contract, not a runtime rule for every user task that LingxY
executes.

- Module boundaries: identify the owning runtime layer, cross-layer boundary,
  and adjacent modules that must remain untouched.
- Architecture rules file: follow `AGENTS.md`, this spine, and the Electron
  performance plan before editing runtime code.
- Upgrade task scope: name the exact PR step, in-scope behavior, out-of-scope
  behavior, migration shape, and feature flags if any.
- Forbidden modification areas: record generated files, unrelated product
  surfaces, old paths, or compatibility layers that must not be modified.
- Interface contracts: list affected storage schemas, task events, HTTP routes,
  IPC channels, public module exports, and verifier contracts.
- Test gate: add or update targeted tests/verifiers before broad wiring and run
  the relevant commands before marking the PR done.
- Design-before-generation: inspect existing code and document the intended
  design shape before broad edits or generated code.
- Patch check: reject changes that only special-case a symptom; every change
  must enforce a framework invariant or update the PR plan to explain why the
  framework shape changed.
- Replacement discipline: once a new framework path is verified and wired,
  migrate callers to it and retire old reachable code. Do not keep parallel
  old/new implementations reachable unless a named feature flag and cleanup PR
  explain the temporary overlap.

## PR Sequence

| Step | Scope | Status |
| --- | --- | --- |
| PR-01 | Architecture guardrails, canonical docs, guardrail verifier | Done |
| PR-02 | Performance baseline instrumentation | Done |
| PR-03 | Main process blocking verifier | Done |
| PR-04 | Renderer streaming batching verifier and fixes | Done |
| PR-05 | ContextCompiler service boundary | Done |
| CX-001 | ConversationSession storage and service skeleton | Done |
| CX-002 | Tool calls and observations as session items | Done |
| CX-003 | FollowUpResolver with regression seeds | Done |
| CX-004 | ContextCompiler V1 with deterministic inclusion reasons | Done |
| AX-001 | Typed ArtifactExtract records | Done |
| AX-002 | Artifact lineage and semantic contracts | Pending |
| AX-003 | Typed transforms | Pending |
| MX-001 | Memory governance surfaces | Pending |
| MX-002 | Session compaction | Pending |
| UX-001 | Context debug panel | Pending |
| GX-001 | Graph nodes for runtime execution | Pending |
| GX-002 | Checkpoints, fork, and replay | Pending |
| EX-001 | Eval corpus for context/follow-up/artifact regressions | Pending |

## PR-01 Acceptance

- Root `AGENTS.md` is present and points contributors to this spine.
- Electron performance guardrails live at
  `docs/architecture/electron-js-runtime-performance-plan.md`.
- Mandatory upgrade PR protocol covers module boundaries, architecture rules,
  upgrade task scope, forbidden modification areas, interface contracts, test gates,
  design-before-generation, and patch checks.
- Guardrails reject prompt-only fixes and phrase/task-id special cases.
- Guardrails forbid heavy work in Electron main process or renderer.
- Legacy archive/delete policy requires evidence before removal.
- `node scripts/verify-runtime-upgrade-guardrails.mjs` verifies the guardrail
  files.

## PR-02 Acceptance

- Runtime baseline timing and counter APIs live in `src/service/metrics`.
- Service bootstrap records a real startup timing and counter through the
  service metrics registry.
- Baseline metrics are exposed in both `runtime.metrics.snapshot()` and
  `/metrics` Prometheus output.
- Electron main process and renderer do not import service metrics or own this
  baseline instrumentation.
- `npm run verify:runtime-performance-baseline` verifies the baseline contract.

## PR-03 Acceptance

- Electron main/tray files do not use synchronous filesystem APIs,
  synchronous child-process APIs, or `Atomics.wait`.
- Brand icon resolution preloads file bytes asynchronously before tray badge
  composition uses cached in-memory data.
- Desktop GUI smoke isolation and crash dump directory setup use asynchronous
  directory creation.
- Oversized IPC handlers are rejected before they become hidden business logic
  in Electron main.
- `npm run verify:main-process-blocking` verifies the main-process blocking
  boundary.

## PR-04 Acceptance

- Console chat `text_delta` and `reasoning_delta` streams are frame-batched
  before DOM updates.
- Overlay assistant text and thinking streams are frame-batched before DOM
  updates.
- Selected task detail SSE frames are queued and flushed in a render frame
  instead of rendering directly inside the stream callback.
- Live preview tool-input deltas and preview-window streaming renders remain
  debounced/batched.
- Renderer streaming surfaces expose smoke hooks for high-volume delta loads.
- `npm run verify:renderer-stream-batching` verifies the renderer streaming
  batching boundary.
- `npm run verify:desktop-gui-smoke` covers overlay, console, and preview
  high-volume stream delta load paths.

## PR-05 Acceptance

- `ContextCompiler` ownership starts in `src/service/core/context`, not Electron
  main process or renderer code.
- Compiled context items are typed and carry deterministic inclusion reasons.
- Compact traces are the default; full candidate traces are debug-only.
- Runtime metrics include `context.compile` timing and selected/omitted item
  counters.
- Electron desktop code is guarded from importing or owning context
  compilation.
- `npm run verify:context-compiler-boundary` verifies the service/runtime
  boundary.

## CX-001 Acceptance

- `conversation_sessions` and `session_items` are additive service-owned storage
  tables.
- `ConversationSessionService` owns typed session creation, ordered session_items,
  and task-submission recording.
- Task submission records a `user_message` item and a `task_anchor` item without
  changing executor prompt behavior.
- Existing visible `conversation_messages` remain the user-facing transcript;
  session_items are the runtime work thread for follow-up/context upgrades.
- `npm run verify:conversation-session-foundation` verifies the storage and
  service boundary.

## CX-002 Acceptance

- `tool_call_started` and `tool_call_proposed` events are persisted as
  `tool_call` session_items.
- `tool_call_completed` and `tool_call_denied` events are persisted as
  `tool_observation` session_items.
- Tool observations include tool id, tool call id, success/error metadata, and a
  bounded text observation when available.
- High-frequency streaming deltas remain excluded from session_items.
- Session observability is fail-soft and cannot break tool execution or
  streaming.
- `npm run verify:conversation-session-foundation` verifies tool event session
  recording.

## CX-003 Acceptance

- `FollowUpResolver` lives in the service-owned session layer and is the single
  task follow-up parent selection entry point.
- Resolver output is versioned, typed, and persisted into task context metadata
  as `selection_metadata.follow_up_resolution`.
- Follow-up parent selection uses typed session anchors such as `task_anchor`,
  `tool_call`, `tool_observation`, and `artifact_reference`.
- New-topic requests do not inherit stale session anchors.
- Caller-provided parent ids still win, but only through the resolver contract.
- Old lifecycle follow-up resolver exports and task-list scan call sites are
  retired so the new framework path does not coexist with old reachable logic.
- `npm run verify:follow-up-resolver-foundation` verifies the resolver boundary,
  retired old references, docs, and regression seed coverage.

## CX-004 Acceptance

- `ContextCompiler` V1 compiles current command, FollowUpResolver decisions,
  parent summaries, explicit attachments, recent artifacts, prior messages,
  background contexts, and typed ConversationSession items into one selected
  context contract.
- Selected items carry deterministic `reason`, `inclusion_reason`, priority,
  source, trust, and selected/omitted decisions.
- Candidate ordering is deterministic and priority-based so active user command,
  follow-up resolution, parent summary, explicit attachments, artifacts, and
  session evidence outrank stale transcript tail.
- Task creation stamps compact `context_packet.compiled_context` once after
  follow-up/session enrichment and before task-spec generation.
- Context compile failures are fail-soft and recorded in selection metadata
  instead of breaking task submission.
- ContextCompiler remains service/runtime-owned, does not scrape
  `conversation_messages` directly, and does not import Electron desktop code.
- `npm run verify:context-compiler-v1` verifies V1 wiring, session evidence
  compilation, task stamping, and the guardrails for later consumer migration.

## AX-001 Acceptance

- `artifact_extracts` is an additive service-owned storage table for typed
  ArtifactExtract records linked to artifacts, tasks, and conversations.
- Memory and SQLite stores expose `appendArtifactExtract`,
  `listArtifactExtractsForArtifact`, and `listArtifactExtractsForTask`.
- `ArtifactExtractService` owns typed extract normalization, schema versioning,
  text bounds, and metrics for already-produced extraction results.
- ContextCompiler reads existing typed extracts and can select summaries, text,
  sections, tables, and metadata without reading artifact files on the task
  creation hot path.
- This PR does not perform heavy artifact parsing; background extraction lanes
  and richer file-format extractors remain separate follow-up work.
- `npm run verify:artifact-extract-foundation` verifies storage, service wiring,
  compiler inclusion, and no blocking extraction in runtime hot paths.

Current next step: AX-002, Artifact lineage and semantic contracts.

## Legacy Archive Policy

Historical code can be archived or deleted when all of the following are true:

- No active imports, route registrations, task runners, IPC handlers, scripts,
  or package scripts require it.
- Replacement behavior exists and has targeted tests or verifiers.
- Migration risk is documented, including rollback path.
- Any remaining compatibility path is behind a named feature flag.
- When a new framework path fully replaces an old one, retire the old exports
  and call sites in the same PR when verifier coverage can prove the replacement.

If those conditions are not met, keep the code reachable and plan a dedicated
cleanup PR after the framework replacement is wired.
