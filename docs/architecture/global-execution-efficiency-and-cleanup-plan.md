# Global Execution Efficiency And Cleanup Plan

This document is the execution board for PMAT-014 style work: improve the
whole LingxY runtime loop for speed, token use, redundancy, and answer quality
without reopening the completed runtime spine or deleting old code without
proof.

Historical audits and external agent harnesses are useful comparison evidence,
but the authority for implementation is the current code, verifier suite,
behavior tests, GUI smoke, and real acceptance reports.

## Benchmark Signals

Use open-source harness patterns as design pressure, not as a replacement
runtime:

- Code-first agent harnesses emphasize small sessions, middleware, typed events,
  provider portability, and skill loading on demand.
- Workflow/eval harnesses emphasize typed state, phase boundaries, record/replay,
  and objective latency, token, and success measurements.
- Universal agent APIs emphasize capability manifests, session contracts,
  streaming events, tool permissions, memory, and conformance tests.
- Mature desktop harnesses emphasize immediate UI acknowledgement, visible
  progress, permission modes, auditability, and resumable execution.

LingxY keeps its service-owned desktop runtime spine. The borrowed invariant is
that every expensive or risky step must be typed, measured, bounded, and inspectable.

## Efficiency Program

The execution loop is optimized as one pipeline, not as isolated task fixes:

```text
user submit
  -> UI acknowledgement
  -> task/session enrichment
  -> follow-up/context compilation
  -> planner/tool surface selection
  -> model/tool loop
  -> side-effect handoff
  -> validation/reviewer
  -> final synthesis
  -> session/artifact persistence
  -> renderer progress/detail hydration
```

Required invariants:

- Hot paths read bounded tails, persisted summaries, typed extracts, and compact
  trace packets before broad transcript, task-event, artifact-content, or skill
  inventory scans.
- Safe preflight work may run in parallel only when typed obligations do not
  depend on each other and no side effect can fire early.
- Tool surfaces are selected from TaskSpec, SemanticRouter, policy groups,
  side-effect contracts, and explicit attachments, not from broad prompt text.
- Degraded routing exposes only required side-effect tools, explicitly required
  tools, and permitted evidence tools.
- Planner loops stop offering extra work once required evidence and authorized
  side-effect obligations are satisfied.
- Renderer progress surfaces acknowledge work immediately, then hydrate detail
  lazily without embedding large raw JSON or full event logs.
- Final answers and generated files must not contain internal retry notes,
  reviewer labels, tool/account transcripts, or unsupported capability claims.

## Measurement And Evidence

Each new efficiency slice must name at least one measurable target and one
guardrail:

- Latency: task accepted, task created, first executor event, first visible
  progress, first model delta, first tool call, final synthesis, terminal state.
- Token/cache: provider-reported input/output tokens, prompt cache hits/misses,
  and model role where available.
- Redundancy: planner turns, denied duplicate side effects, repeated tool
  families, broad history reads avoided, skill scans skipped.
- Quality: success-contract violations, reviewer rejects, artifact quality
  failures, side-effect content rejections, sanitized final text events.

Evidence may be deterministic tests, verifier assertions, GUI smoke, or opt-in
live provider/connector reports. Price display remains out of scope unless a
future phase adds provider-owned billing evidence and freshness policy.

## File Cleanup Program

File cleanup is a separate gated track. It is not a license to delete code that
looks stale.

Cleanup candidates are grouped as:

- Local generated output: `.tmp/`, `tmp/`, transient logs, and disposable local
  reports.
- Historical evidence: old real-LLM reports or release evidence that must be
  retained, compressed, archived, or explicitly left alone.
- Old reachable implementation paths: compatibility code, retired route/tool
  surfaces, duplicate exports, and legacy adapters.
- Large mixed-responsibility files: modules that should be split after boundary
  verifiers exist, such as task submission, task spec, planner loops, and large
  renderer controllers.

Required cleanup evidence before deleting or archiving any tracked source file:

- Import and reference sweep across `src/`, `scripts/`, `tests/`, and `docs/`.
- Package script, public export, IPC channel, HTTP route, tool id, artifact kind,
  provider id, and storage schema sweep where relevant.
- Replacement path and verifier coverage if behavior is being retired.
- Rollback path or explicit archive location.
- `npm run check:fast` after the cleanup.

The machine-readable cleanup gate is the File Cleanup Evidence Pack:

- Contract: `src/shared/file-cleanup-evidence-pack.mjs`.
- Architecture docs: `docs/architecture/file-cleanup-evidence-pack.md`.
- Non-destructive candidate report: `scripts/run-file-cleanup-candidates.mjs`.
- Disposable local output cleaner: `scripts/clean-local-generated.mjs`.
- Verifier: `npm run verify:file-cleanup-evidence-pack`.

Do not delete or archive:

- `node_modules/`, `dist/`, local runtime databases, user data, secrets, or
  release evidence as part of source cleanup.
- Current live acceptance reports referenced by roadmap notes.
- Legacy code that is still imported, registered, or reachable during migration.
- Old and new implementations that are both reachable without a named feature
  flag and cleanup PR.

## Large File Split Discipline

Large-file cleanup starts with ownership, then extraction, then deletion:

- Add or update a boundary verifier before moving code.
- Preserve existing IPC channels, HTTP routes, tool ids, event names, storage
  schemas, and public exports unless the phase explicitly owns a migration.
- Extract one owner slice at a time and keep compatibility call sites narrow.
- Retire the old reachable path in the same PR once the replacement path is
  verified, or name the follow-up cleanup PR and add a blocking verifier.
- Run targeted tests plus `npm run check:fast`; GUI-facing splits also require a
  focused renderer verifier or GUI smoke.

## Current Baseline

As of this plan, the PMAT-014 baseline includes:

- Bounded prior-message reads for task submission and model-start history.
- Store-owned incremental task-event reads.
- Shared skill-context relevance gating before planner skill inventory scans.
- Shared deterministic artifact planning for ad-hoc text artifacts.
- Provider-wait progress heartbeats for slow first model output.
- Final answer sanitization for internal retry preambles.
- Final answer recovery from tool stdout when a leaked transcript would collapse
  to a `stdout`/`stderr` section label.
- Script-file generation requests that explicitly ask to execute the script now
  require the `run_script` tool as a typed contract obligation, and the
  `run_script` call must reference the generated script artifact path or
  filename instead of equivalent inline code.
- `run_script` normalizes common language aliases such as `nodejs` to `node`
  and executes Node snippets containing `require()` as CommonJS, reducing
  avoidable retry loops on routine local verification scripts.
- Explicit `.html` filenames are treated as raw text/code artifacts for
  deterministic recovery, preserving requested literal content and previously
  resolved output paths through `write_file`; rendered HTML reports can still
  use `generate_document`.
- Artifact-only final review is skipped once typed success contracts are
  already satisfied, avoiding redundant reviewer calls and false rejections.
- Multi-kind artifact requests stay on explicit artifact-producing tool calls
  instead of using single-file deterministic recovery.
- Scheduled email/title field normalization and side-effect content contracts.
- A fast verifier entry at `npm run verify:global-execution-latency`.

The next implementation step is to keep extending this verifier so every new
speed, cost, redundancy, answer-quality, or cleanup rule is enforced before
broad wiring.
