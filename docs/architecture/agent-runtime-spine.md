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

## PR Sequence

| Step | Scope | Status |
| --- | --- | --- |
| PR-01 | Architecture guardrails, canonical docs, guardrail verifier | Done |
| PR-02 | Performance baseline instrumentation | Done |
| PR-03 | Main process blocking verifier | Pending |
| PR-04 | Renderer streaming batching verifier and fixes | Pending |
| CX-001 | ConversationSession storage and service skeleton | Pending |
| CX-002 | Tool calls and observations as session items | Pending |
| CX-003 | FollowUpResolver with regression seeds | Pending |
| CX-004 | ContextCompiler V1 with deterministic inclusion reasons | Pending |
| AX-001 | Typed ArtifactExtract records | Pending |
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

Current next step: PR-03, the main process blocking verifier.

## Legacy Archive Policy

Historical code can be archived or deleted when all of the following are true:

- No active imports, route registrations, task runners, IPC handlers, scripts,
  or package scripts require it.
- Replacement behavior exists and has targeted tests or verifiers.
- Migration risk is documented, including rollback path.
- Any remaining compatibility path is behind a named feature flag.

If those conditions are not met, keep the code reachable and plan a dedicated
cleanup PR after the framework replacement is wired.
