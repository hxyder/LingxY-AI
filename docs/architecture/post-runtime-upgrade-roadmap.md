# Post Runtime Upgrade Roadmap

This roadmap is the tracked post-canonical execution board for work that was
repeatedly requested but intentionally deferred from the canonical
memory/conversation/context/artifact/performance sequence.

Historical root audit files such as `FRAMEWORK_GAP_ANALYSIS.md` and
`FUNCTION_AUDIT_AND_UPGRADE_PLAN.md` can be used as background evidence, but
they are not the authority for this board. The authority is the current program:
tracked architecture docs, current source ownership, existing verifiers,
behavior tests, GUI smoke coverage, and release gates.

The previous canonical sequence and capability/tool owner reorganization are
complete. This file is the next execution board for desktop experience,
context/trace durability, generic graph resume, sub-agent runtime, multi-model
execution, plugin/MCP marketplace work, privacy sandbox hardening, and long-term
observability.

## Current Status Snapshot

Last updated: 2026-05-12.

- Canonical runtime spine: complete.
- Capability/tool owner cleanup: complete. `src/service/action_tools/tools/index.mjs`
  is now an aggregator/re-export surface only; built-in tool implementations
  live under `src/service/capabilities/tools/` or external capability
  aggregators.
- Current green gate: `npm run check:fast` passed 111/111 after PM-001
  marketplace trust model coverage was added, including 1023/1023 behavior
  tests.
  `npm run verify:desktop-gui-smoke` passed 49/49 on rerun after SA-002 had one
  non-reproduced overlay keyboard-open smoke failure.
  `npm run verify:desktop-gui-smoke`
  passed 49/49.
- Next execution board: this document.
- Primary product gaps now shift from code ownership cleanup to user-visible
  desktop completeness, context/trace persistence decisions, plugin/MCP trust,
  sandbox governance, multi-model execution, and optional sub-agent runtime.

## Source Map

| Area | Current program evidence | Current state |
| --- | --- | --- |
| True sub-agent runtime | `runtime-graph-*` verifiers exist; `docs/architecture/sub-agent-runtime-contract.md` defines the service contract; `src/shared/sub-agent-timeline-summary.mjs` defines the UI trace summary. | SA-001 and SA-002 are complete for contracts, timeline visibility, and eval corpus; automatic planner delegation remains deferred. |
| Multi-model execution | `verify-model-role-routing.mjs` exists; real planner/executor call sites now use role-aware provider resolution behind an explicit feature flag. `verify-final-answer-reviewer-loop.mjs` locks the optional reviewer pass. | MM-001 is complete for planner/executor binding and measurement fields; MM-002 is complete for the feature-flagged final-answer reviewer pass. |
| Generic HITL graph resume | `verify-approval-resume-state.mjs`, connector workflow resume, runtime graph checkpoints. | Approval resume metadata and connector-workflow resume exist; generic agent/tool same-run resume remains. |
| Desktop/GUI completion | `verify:desktop-gui-smoke`, `verify-desktop-gui-perf-smoke`, desktop README/inventories, window/IPC split docs, `docs/architecture/window-session-state-machine.md`, `verify-window-session-state-machine.mjs`, `docs/architecture/desktop-ipc-boundaries.md`, `verify-desktop-ipc-boundaries.mjs`. | Real GUI smoke is strong; DX-001 owns preview/popup/window owner state and DX-002 locks extracted IPC boundaries. Real mic/KWS, keyboard-only settings/approval, first-run GUI, and richer preview fidelity remain. |
| Timeline/trace/export | `verify-task-trace-timeline.mjs`, `verify-context-debug-panel-lazy-load.mjs`, llm usage verifiers. | Local trace summary exists; trend storage, richer span taxonomy, optional LLM judge, and OTEL/export remain. |
| Memory governance next pass | `verify-memory-governance.mjs`, `verify-user-memory-profile.mjs`, context compiler tests. | Editable memory exists; auto-learning proposals, review history, undo, and richer project scoping remain. |
| SQLite write queue / DB worker | `lingxy_electron_js_codex_execution_plan.md` PR-04/PR-05 and final acceptance checklist | Not proven as a unified contract; session/context/artifact writes should be audited and queued by priority before further broad state growth. |
| Permission/mode model | `lingxy_codex_ready_agent_runtime_upgrade_plan.md` Wave 12; `lingxy_electron_js_codex_execution_plan.md` queue-class notes | `execution_mode` exists, privacy policy exists, and approvals exist; user-visible mode/tool-surface mapping remains incomplete. |
| Sidecar decision record | `lingxy_electron_js_codex_execution_plan.md` PR-09/PR-19; sidecar decision gate | Sidecars are constrained by guardrails, but a dedicated decision-record template/verifier is still missing. |
| Optional git checkpoint mode | `lingxy_codex_ready_agent_runtime_upgrade_plan.md` section 3.9; `FUNCTION_AUDIT_AND_UPGRADE_PLAN.md` FW-018 | Complete for opt-in metadata: file reversibility remains default, while `ctx.reversibility.gitCheckpoint.enabled` can create a non-worktree git checkpoint ref for project rollback. |
| Plugin/MCP marketplace | `skill/mcp/connector` surface contracts, plugin registry verifier, connector boundary docs, and `docs/architecture/marketplace-trust-model.md`. | PM-001 is complete for shared trust preview metadata across skills, plugins, and MCP; signing, sharing UX, and external MCP governance remain. |
| Privacy/sandbox hardening | `verify-privacy-sandbox-policy.mjs`, security broker/audit log owners, MCP install sandbox owner. | Privacy policy/broker foundation exists; OS-level sandbox/codesign boundaries and richer controls remain. |
| Task/conversation/project IA migration | Conversation/session/context services, current codebase audit, renderer/runtime client verifiers. | IA invariants and contracts exist; broader storage/content migration and UI cleanup remain. |

## Tracking Register

| Phase | Status | Tracking rule |
| --- | --- | --- |
| PX-001 Roadmap/status hygiene | complete | This roadmap is linked from architecture docs and guarded by `verify-post-runtime-roadmap.mjs`. |
| RT-001 to RT-004 Runtime persistence/context/mode | complete | RT-001, RT-002, RT-003, and RT-004 are complete with direct-write/compact-trace/mode-contract verifiers. |
| DX-001 Desktop WindowSession | complete | Window owner state, preview stale-delta rejection, popup owner tracking, and GUI smoke coverage are locked by `verify-window-session-state-machine.mjs`. |
| DX-002 Desktop IPC boundary | complete | `electron-main.mjs` is locked as lifecycle/composition only; 112 IPC registrations live under `src/desktop/main/ipc/` and are guarded against duplicates and large handlers. |
| DX-003 Renderer runtime client consolidation | complete | Console and Overlay runtime mutations are routed through shared renderer clients and locked by `verify-renderer-runtime-client-consolidation.mjs`. |
| DX-004 Keyboard/a11y GUI pass | complete | Real Electron smoke now drives Overlay task-list keyboard navigation, Console Settings/Schedules keyboard paths, and approval popup keyboard reject. |
| DX-005 Desktop first-run/i18n/preview fidelity | complete | First-run provider recovery and generate_document preview screenshot-diff are covered by real Electron GUI smoke and verifier contracts. |
| VX-001 Voice fixture corpus | complete | Checked-in WAV corpus now backs transcription and KWS metrics; optional private fixture directory is documented for larger local samples. |
| VX-002 Hardware permission smoke | complete | Opt-in Electron GUI smoke can record from local microphone hardware with actionable diagnostics; default checks stay hardware-free. |
| GX-003 Generic graph resume | complete | Generic agent tool approvals now resume on the original task through same-task graph resume; connector workflow resume remains intact. |
| RV-001 Optional git checkpoint mode | complete | Opt-in git checkpoint metadata is implemented under `src/service/capabilities/tools/git-checkpoint-mode.mjs`; default file reversibility remains unchanged. |
| SA-001 Sub-agent runtime contract | complete | Service-owned child-run contract now covers feature-flag gating, planner-selected delegation, context isolation, allowed tools, budget, cancellation, and structured child reports. |
| SA-002 Sub-agent UI/evals | complete | Parent task detail now renders child runs from task detail children and `sub_agent_report` events; delegation eval corpus guards when to delegate and when not to. |
| MM-001 Model role call-site binding | complete | `resolveProviderForModelRole` binds planner/executor call sites only when model role routing is explicitly enabled and records role fields in `llm_usage`. |
| MM-002 Reviewer/voting loops | complete | Feature-flagged final-answer reviewer pass runs only for high-risk artifact/connector/research tasks, binds to the `reviewer` role, records trace/usage, and cannot silently rewrite output. |
| PM-001 Marketplace trust model | complete | Skills, connector plugins, and MCP statuses now expose shared `trustPreview` metadata with trusted/local-only/third-party/unsigned/disabled/deleted flags. |
| PM-002 to PM-003 Plugin/skill/MCP marketplace | pending | Must preserve disabled defaults, stale-reference cleanup, signing, sharing UX, and auditability. |
| SH-001 to SH-003 Sandbox/sidecar/security export | pending | No native/OS sidecar work without decision record and rollback path. |
| OQ-001 to OQ-002 Observability/quality trends | pending | Must use stable span/eval contracts and avoid hot-path overhead. |

## Execution Rules

- Do not reopen the completed runtime spine as if it were unfinished.
- Every PR must name module boundaries, forbidden modification areas, interface
  contracts, tests/verifiers, and old-code retirement or archive decisions.
- Do not introduce true sub-agents, sidecars, OS sandboxes, or marketplace trust
  flows without a measured contract and rollback path.
- Prefer additive migrations and feature flags until a replacement path is
  verified; once verified, replace old call sites and delete or archive obsolete
  code in the same PR or in a named cleanup PR with a blocking verifier.
- Do not put heavy work in Electron main process or renderer.

## Program-Grounded Triage

These items are not accepted merely because an older plan suggested them. Each
candidate must be checked against the current program first:

- Current event streaming already keeps `text_delta`, `tool_input_delta`,
  `reasoning_delta`, and `tool_planner_decision` out of durable event storage,
  so a DB queue is not automatically required for high-frequency token streams.
- Artifact extraction already has a service-owned background lane, so the next
  risk is write-path durability/backpressure, not parser CPU in Electron.
- SQLite currently uses `better-sqlite3` inside the service store. That is
  acceptable until a measured hot path or broad state growth proves queueing or
  a DB worker is needed.
- `execution_mode`, approval gates, and privacy sandbox policy already exist.
  The missing part is a coherent user-visible mode contract, not a rewrite of
  every approval.
- File-level reversibility checkpoints already exist. Git checkpoints are
  optional project-level recovery, not a replacement.

Decision standard:

- If the current code already has a safe framework path, keep it and add a
  verifier rather than replacing it.
- If the current code has partial coverage, add a scoped completion PR.
- If the current code has no measured problem, add a decision record or audit
  gate instead of implementation.

## Phase A: Roadmap And Status Hygiene

### PX-001: Make This Roadmap The Post-Canonical Board

Scope:

- Link this document from architecture docs and future status summaries.
- Add a verifier that catches stale "Current next step" claims in canonical docs.
- Keep root ignored audit files as historical context unless they are explicitly
  promoted into tracked docs.

Acceptance:

- New sessions can identify the completed canonical runtime sequence and the
  post-runtime roadmap without reading ignored root files.
- No implementation behavior changes.

Verification:

- `node scripts/verify-structure.mjs`
- New roadmap verifier if this phase edits status automation.

## Phase B: Runtime Persistence, Trace Budgets, And Mode Model

### RT-001: SQLite Write-Path Audit And Queue Decision

Status: complete as of 2026-05-11.

Scope:

- Audit all SQLite/store write paths for tasks, events, session items,
  artifact extracts, artifact lineage, context traces, memory proposals,
  graph checkpoints, schedules, approvals, and eval/perf metadata.
- Define priority classes: critical control writes, normal runtime writes,
  low-priority trace/eval writes, and background maintenance writes.
- Decide, from measured or structural evidence, whether to keep direct service
  writes, add a service-owned write queue, or move a subset to a DB worker.
- Keep Electron main process and renderer out of DB batching.

Acceptance:

- The audit identifies which writes are already safe, which writes are on hot
  paths, and which writes are optional diagnostics.
- Critical task lifecycle, terminal state, approval-required, and checkpoint
  writes remain durable enough for recovery.
- High-volume or diagnostic writes do not block streaming or UI.
- If a queue is not implemented, the verifier records why direct writes remain
  acceptable for the current program.
- If a queue is implemented, snapshots expose depth, age, flush latency,
  dropped low-priority writes, and last error.

Decision:

- See `docs/architecture/sqlite-write-path-budget.md`.
- Current decision is to keep direct service-owned SQLite writes.
- Rationale: write ownership is concentrated in the service store, WAL is
  enabled, Electron desktop code does not own SQLite, and high-frequency stream
  events are already excluded from SQLite task-event persistence.
- No queue or DB worker is implemented in RT-001. RT-002 may revisit this only
  with measured evidence or a specific write-budget enforcement gap.

Verification:

- `node scripts/verify-sqlite-write-path-budget.mjs`
- Behavior tests for priority ordering, flush failure, shutdown drain, and
  low-priority backpressure only if a queue is implemented.
- `npm run check:fast`

### RT-002: Session/Context/Artifact Write Budget Enforcement

Status: complete as of 2026-05-11.

Scope:

- Apply the RT-001 decision to non-critical `session_items`, context traces,
  memory proposal records, artifact extracts, artifact lineage, and eval/perf
  metadata.
- Keep user-message/task-anchor writes critical or immediately durable when they
  are needed for follow-up correctness.

Acceptance:

- Conversation/session continuity remains correct under queued writes.
- ContextCompiler can read required durable state without depending on delayed
  diagnostic writes.
- Artifact transform success does not report before required lineage/contract
  writes are durable or explicitly recoverable.
- If direct writes remain, tests prove they are not on high-frequency stream
  paths and stay within budget.

Verification:

- Existing session/context/artifact behavior tests.
- `node scripts/verify-session-context-artifact-write-budget.mjs`
- New write-queue integration tests for session and artifact paths only if a
  later phase implements a queue.
- `npm run check:fast`

### RT-003: Context Trace Persistence And Budget Audit

Status: complete as of 2026-05-11.

Scope:

- Reconcile the older `context_compile_traces` plan with the current compact
  compiled-context/debug-panel implementation.
- Decide whether a persistent trace table is still required, or whether current
  task metadata plus lazy JSON export is the canonical trace storage.
- Enforce `context_compile_ms` and `context_trace_size_bytes` budgets in the
  chosen contract.

Acceptance:

- There is one canonical context trace storage/export path.
- Full traces remain opt-in and do not render by default.
- Stale older trace surfaces are deleted or archived after replacement.

Decision:

- See `docs/architecture/context-trace-budget.md`.
- Current decision: compact task metadata is the canonical context trace storage
  for the current program.
- Do not add `context_compile_traces` in RT-003.
- Keep full candidate traces debug-only and full compiled context JSON copy-only
  in the Context Debug Panel.

Verification:

- `node scripts/verify-context-compiler-v1.mjs`
- `node scripts/verify-context-debug-panel-lazy-load.mjs`
- `node scripts/verify-context-trace-budget.mjs`
- `npm run check:fast`

### RT-004: Permission And Mode Model

Status: complete as of 2026-05-12.

Scope:

- Map existing `execution_mode`, approval policy, privacy sandbox policy, and
  tool risk tiers into user-visible modes.
- Show the active mode in Overlay and Console.
- Make mode affect tool surface and approval threshold through the existing
  policy layer, not prompt wording.

Acceptance:

- Users can understand whether the current task is interactive,
  approval-required, unattended-safe, local-only, or dry-run-like.
- Mode changes are persisted, audited, and visible in task trace.
- Existing approval and privacy sandbox checks still pass.

Verification:

- `node scripts/verify-privacy-sandbox-policy.mjs`
- `node scripts/verify-approval-task-bridge.mjs`
- `node scripts/verify-permission-mode-model.mjs`
- `npm run verify:desktop-gui-smoke`
- `npm run check:fast`

Decision:

- See `docs/architecture/permission-mode-model.md`.
- `src/shared/permission-mode-model.mjs` is the shared contract for
  execution mode, approval threshold, privacy sandbox summary, and
  user-visible mode labels.
- The service persists `permission_mode_contract` on task selection metadata
  and mirrors it into `task_created` trace payloads.
- Console task detail and Overlay active-task surfaces render the shared
  contract instead of inferring approval behavior locally.

## Phase C: Desktop Experience Completion

### DX-001: WindowSession State Machine

Status: complete as of 2026-05-12.

Scope:

- Define a typed `WindowSession` state model for Overlay, Console, Preview,
  PopupCard, Dock, and LinkBrowser ownership.
- Track active conversation, active task, preview binding, popup owner,
  background/system task ownership, and stale-stream rejection in one contract.
- Keep state orchestration in desktop/service boundary modules, not scattered
  across renderer globals.

Acceptance:

- A new conversation cannot inherit another conversation's active task, stream,
  popup, or preview binding.
- Preview and popup windows reject deltas/actions from non-owned tasks.
- Scheduled/background/system tasks have explicit owner states.
- Existing GUI smoke names continue to pass.

Verification:

- `npm run verify:desktop-gui-smoke`
- `node scripts/verify-window-session-state-machine.mjs`
- Behavior tests for state transitions and stale-event rejection.

Decision:

- See `docs/architecture/window-session-state-machine.md`.
- `src/desktop/shared/window-session-state.mjs` is the shared desktop owner
  contract for managed windows, task/conversation owners, preview bindings,
  popup-card owners, background/system task ownership, and stale event records.
- Electron shell creates one `WindowSession` and injects it into preview and
  popup managers; preview delta/commit IPC returns stale-owner rejection
  decisions instead of always reporting success.
- This phase intentionally does not split more IPC handlers; DX-002 owns that
  boundary work.

### DX-002: Electron Main IPC Boundary Split

Status: complete as of 2026-05-12.

Scope:

- Split `src/desktop/tray/electron-main.mjs` IPC groups into small modules under
  `src/desktop/main/ipc/` without changing public IPC channel names.
- Move request normalization into typed desktop service-client helpers.
- Add a verifier that blocks large new IPC handlers and duplicate channel
  registration.

Acceptance:

- `electron-main.mjs` owns lifecycle composition, not broad business logic.
- IPC channel registrations are discoverable, unique, and actor-aware.
- Old inline handler blocks are deleted after module extraction, not duplicated.

Verification:

- `npm run verify:main-process-blocking`
- `node scripts/verify-desktop-shell.mjs`
- `node scripts/verify-desktop-ipc-boundaries.mjs`

Decision:

- See `docs/architecture/desktop-ipc-boundaries.md`.
- Current code already has the physical IPC split: `electron-main.mjs` imports
  and composes `src/desktop/main/ipc/register-*.mjs` modules and has no inline
  `ipcMain.handle/on` registrations.
- DX-002 adds the missing framework lock: no inline handler regression in
  `electron-main.mjs`, no duplicate channel registration, no direct
  `src/service/**` imports from IPC modules, and no oversized handler bodies.
- No IPC channel names, HTTP routes, storage schema, tool ids, artifact kinds,
  or provider ids changed in this phase.

### DX-003: Renderer Runtime Client Consolidation

Status: complete as of 2026-05-12.

Scope:

- Move direct renderer `fetch` mutations into typed runtime clients for Console,
  Overlay, and panel modules.
- Keep UI state in renderers; keep runtime semantics in service/client modules.
- Do not add a heavy frontend framework rewrite.
- Completed first consolidation slice covers task submission/clarification,
  conversation creation/model overrides, user-memory mutations, MCP/skill
  preflight, MCP install planning, and DAG preview.

Acceptance:

- Console/Overlay no longer each own ad hoc copies of runtime mutation logic.
- Service routes used by UI have a shared client contract and tests.
- Old duplicated request helpers are removed or archived after replacement.
- Page scripts call `runtime-submission-client`,
  `runtime-user-memory-client`, and `runtime-preflight-client`; those clients
  own the runtime mutation endpoints.

Verification:

- `node scripts/verify-desktop-renderer.mjs`
- `node scripts/verify-console-runtime-client.mjs`
- `node scripts/verify-renderer-runtime-client-consolidation.mjs`
- New client contract behavior tests.

### DX-004: Keyboard-Only And A11y GUI Pass

Status: complete as of 2026-05-12.

Scope:

- Cover Settings, provider setup, approval cards, popup cards, branch controls,
  task detail, and schedule forms.
- Add real GUI smoke hooks for tab order, focus restore, Escape behavior, and
  visible labels.
- Completed slice covers Overlay task-list open/filter/Escape with native
  keyboard input, Console Settings and Schedules rail activation with visible
  labels, and approval popup reject by keyboard. Existing smoke still covers
  branch controls and task-detail/approval surfaces.

Acceptance:

- Core desktop workflows are usable with keyboard only.
- Approval/deny flows preserve focus and expose accessible names.
- Regressions fail a verifier before release.

Verification:

- `node scripts/verify-a11y-keyboard-contract.mjs`
- `npm run verify:desktop-gui-smoke`
- `node scripts/verify-user-interaction-smoke.mjs`

### DX-005: First-Run, i18n, And Preview Fidelity Completion

Status: complete as of 2026-05-12.

Scope:

- Add first-run GUI smoke for provider setup and missing-key recovery.
- Continue zh-CN/en-US extraction for Settings, task surfaces, approvals, and
  connector pages.
- Add richer incremental binary draft previews and screenshot-diff checks for
  generated document previews.
- Completed slice adds real Console first-run provider recovery coverage,
  keeps provider setup recovery copy on shared i18n contracts, and adds a real
  Preview window screenshot-diff over initial and incremental
  `generate_document` drafts.

Acceptance:

- First-run path is validated in real Electron.
- Major visible strings touched by this phase use shared i18n lookup.
- Preview draft and committed preview stay visually coherent.

Verification:

- `node scripts/verify-i18n-onboarding.mjs`
- `npm run verify:desktop-gui-smoke`
- `node scripts/verify-preview-screenshot-diff.mjs`
- `node scripts/verify-user-interaction-smoke.mjs`

## Phase D: Voice And Real Desktop Hardware

### VX-001: Real Audio Fixture And KWS Corpus

Status: complete as of 2026-05-12.

Scope:

- Add checked-in small audio fixtures for transcription and KWS, or a documented
  optional private fixture path for larger samples.
- Measure WER, empty-rate, final-chunk rate, wake false-positive, and wake
  false-negative rates.
- Completed slice adds a checked-in WAV corpus under `tests/fixtures/audio/`,
  locks hashes and PCM metadata through
  `src/service/audio/audio-fixture-corpus.mjs`, and allows larger local fixture
  directories through `LINGXY_REAL_AUDIO_FIXTURE_DIR`.

Acceptance:

- Voice quality is proven by real audio samples, not only synthetic text and
  MediaRecorder renderer paths.
- KWS near-misses and custom wake profiles remain guarded.
- Default CI remains deterministic and does not require microphone hardware,
  local Whisper, or Sherpa model downloads.

Verification:

- `node scripts/verify-voice-fixture-testbed.mjs`
- `node scripts/verify-real-audio-kws-fixtures.mjs`

### VX-002: Optional Hardware Permission Smoke

Status: complete as of 2026-05-12.

Scope:

- Add an opt-in local smoke that records from real mic hardware only when an
  explicit env flag is set.
- Keep CI deterministic by default.
- Completed slice adds `npm run verify:desktop-audio-hardware-smoke`, gated by
  `LINGXY_DESKTOP_AUDIO_HARDWARE_SMOKE=1`, and reuses the real Electron GUI
  smoke harness to request microphone permission and record a short
  MediaRecorder sample from hardware.

Acceptance:

- Hardware permission/capture failures produce actionable diagnostics.
- The default check suite does not hang or require hardware.
- Default `npm run check:fast` locks the opt-in contract only; hardware capture
  remains an explicit local diagnostic.

Verification:

- `node scripts/verify-desktop-audio-hardware-smoke-contract.mjs`
- `npm run verify:desktop-audio-hardware-smoke`
- `LINGXY_DESKTOP_AUDIO_HARDWARE_SMOKE=1 npm run verify:desktop-audio-hardware-smoke`

## Phase E: Generic Graph Resume, Reversibility, And True Sub-Agents

### GX-003: Generic Agent/Tool Graph Resume

Status: complete as of 2026-05-12.

Scope:

- Replace bridge-copy terminalization for generic approval pauses with same-run
  executor continuation.
- Use existing runtime graph checkpoints and approval resume metadata.
- Keep connector workflow resume behavior intact.
- Completed slice adds `src/service/scheduler/approval-graph-resume.mjs` for
  generic `agent_tool_call` approvals, emits `approval_resume_started`,
  executes the approved tool against the original task, terminalizes that task
  with `same_task_resume` events, and skips the compatibility bridge for this
  path.

Acceptance:

- Approval interruption, approval resume, rejection, retry, and cancellation
  resume the original task execution graph where possible.
- No duplicate bridge task is required for generic agent/tool runs.
- Existing approval GUI smoke still passes.
- Connector workflow approval resume remains on its existing same-task workflow
  path.

Verification:

- `node scripts/verify-approval-resume-state.mjs`
- `npm run verify:desktop-gui-smoke`
- `node --test tests/behavior/approval-resume-state.test.mjs`
- `node --test tests/behavior/task-runtime-services.test.mjs`

### RV-001: Optional Git Checkpoint Mode

Status: complete as of 2026-05-12.

Scope:

- Evaluate optional git-backed project checkpoints for file mutation tasks.
- Keep existing file-level reversibility checkpoints as the default.
- Require a project opt-in and clear rollback behavior before running git
  commands.
- Implemented opt-in only through `ctx.reversibility.gitCheckpoint.enabled`
  or `ctx.gitCheckpoint.enabled`; product behavior remains file-checkpoint
  based unless a caller explicitly enables the git mode.
- `src/service/capabilities/tools/git-checkpoint-mode.mjs` uses
  `git stash create` plus `git update-ref` to record a `stash_create_ref`
  checkpoint without mutating the worktree.

Acceptance:

- Git checkpoint mode never mutates repositories without explicit opt-in.
- Restore behavior is understandable and recoverable.
- File-level reversibility remains available when git is absent or disabled.
- Temporary-repository behavior coverage proves the default mode is off,
  opt-in preserves `git status --short`, anchors the checkpoint ref, and
  exposes a `restore_hint`.

Verification:

- `node scripts/verify-file-reversibility-checkpoint.mjs`
- `node --test tests/behavior/file-reversibility-checkpoint.test.mjs`

### SA-001: Sub-Agent Runtime Contract

Status: complete as of 2026-05-12.

Scope:

- Add a service-owned child-run contract: parent task id, child task id,
  assigned scope, isolated compiled context, allowed tools, budget, cancellation
  token, and result report.
- Start with explicit planner-selected delegation only behind a feature flag.
- Do not add unmanaged recursive agents or prompt-only delegation.
- Implemented in `src/service/core/subagents/sub-agent-runtime-contract.mjs`
  and wired as `runtime.subAgentRuntime` by runtime services.
- Architecture contract is documented in
  `docs/architecture/sub-agent-runtime-contract.md`.

Acceptance:

- Child agents cannot escape assigned tool surface, budget, task scope, or
  context scope.
- Parent task receives structured child reports and can synthesize them.
- Cancellation propagates parent -> child.
- The contract is disabled by default and rejects non-`planner_selected`
  delegation.
- No IPC channel names, HTTP routes, storage schema, tool ids, artifact kinds,
  provider ids, or model routing behavior changed.

Verification:

- `node scripts/verify-sub-agent-runtime-contract.mjs`
- `node --test tests/behavior/sub-agent-runtime-contract.test.mjs`
- Behavior tests cover disabled default, planner-selected gating, context
  isolation, tool-surface escape rejection, budget exhaustion, cancellation
  propagation, structured child reports, and runtime service wiring.

### SA-002: Sub-Agent UI, Trace, And Eval Coverage

Status: complete as of 2026-05-12.

Scope:

- Show child runs under the parent task timeline.
- Add evals for when delegation should and should not happen.
- Record per-child token/timing/tool metrics.
- Implemented shared summary in `src/shared/sub-agent-timeline-summary.mjs`.
- Console task detail renders `renderSubAgentTimelinePanel` from task detail
  `children` plus `sub_agent_report` events.
- Added `src/service/core/evals/sub-agent-delegation-corpus.mjs` to cover
  delegation-positive and delegation-negative cases.

Acceptance:

- Users can inspect what each child agent did and why.
- Delegation does not hide failures or inflate success claims.
- The UI panel does not dump raw event JSON.
- The eval corpus catches wrong delegation, unsafe tool surfaces, and forbidden
  context exposure.

Verification:

- New sub-agent eval corpus.
- `node scripts/verify-task-trace-timeline.mjs`
- `node scripts/verify-sub-agent-ui-evals.mjs`
- `node --test tests/behavior/sub-agent-timeline-evals.test.mjs`

## Phase F: Multi-Model Execution

### MM-001: Bind Model Roles To Real Call Sites

Status: complete as of 2026-05-12.

Scope:

- Use existing planner/executor/reviewer role config in actual LLM call sites.
- Start with planner/executor split for low-risk task classes.
- Record role decisions and token/timing deltas.
- Implemented `resolveProviderForModelRole` in
  `src/service/executors/shared/provider-resolver.mjs`.
- Bound `tool_using` planner and `agentic` planner to the `planner` role.
- Bound `tool_using` final composer to the `executor` role.
- `llm_usage` now includes model-role fields only when the role-aware provider
  descriptor carries them, preserving default descriptor compatibility.

Acceptance:

- Role routing changes behavior only behind a feature flag or per-task config.
- Reports can compare single-model vs role-routed runs.
- Default provider descriptors remain unchanged while role routing is disabled.

Verification:

- `node scripts/verify-model-role-routing.mjs`
- `node --test tests/behavior/model-role-routing.test.mjs`
- Related checks: `node scripts/verify-provider-routing.mjs`,
  `node scripts/verify-llm-usage-emission.mjs`, and
  `node scripts/verify-real-llm-token-metrics.mjs`.

### MM-002: Reviewer And Voting Loops

Status: complete as of 2026-05-12 for the final-answer reviewer pass. Broader
multi-candidate voting stays out of scope until measured evidence shows the
single reviewer pass is not enough.

Scope:

- Add optional reviewer pass for high-risk artifact, connector, or research
  tasks.
- Add strict budget and latency gates.
- Implemented a final-answer reviewer pass in
  `src/service/executors/tool_using/final-reviewer.mjs`.
- The pass is disabled by default and requires `reviewer_loop.enabled: true`
  from task metadata or runtime config.
- The pass binds provider calls to `resolveProviderForModelRole("reviewer",
  "reviewer", ...)` and emits `llm_usage` at
  `tool_using.final_reviewer`.
- The pass only runs when the risk profile includes artifact-required,
  connector/side-effect, research-quality, or multi-source analysis signals,
  unless explicitly configured with `mode: "always"`.
- Candidate and transcript character budgets plus a timeout gate prevent the
  reviewer from turning finalization into an unbounded second agent loop.

Acceptance:

- Reviewer cannot silently rewrite outcomes without trace evidence.
- Reviewer failures degrade gracefully.
- Reviewer `revise` or `reject` verdicts keep the candidate answer and append a
  visible `Reviewer note:` instead of replacing user-visible content.
- Reviewer start/completion/skip events expose risk reasons, duration, verdict,
  and whether a visible note was applied.

Verification:

- `node scripts/verify-final-answer-reviewer-loop.mjs`
- `node --test tests/behavior/agent-loop-final-composer.test.mjs`
- Real-LLM comparison report for targeted cases remains useful as an opt-in
  quality exercise before introducing broader multi-candidate voting.

## Phase G: Plugin, Skill, MCP Marketplace

### PM-001: Marketplace Trust Model

Status: complete as of 2026-05-12.

Scope:

- Define trusted, local-only, third-party, unsigned, disabled, and deleted states
  for skills/plugins/MCP entries.
- Add trust preview before enable/install.
- Preserve existing local-only and recoverable delete behavior.
- Implemented shared marketplace trust helpers in
  `src/service/capabilities/marketplace/trust-model.mjs`.
- Skill registry, GitHub skill staging, MCP status, and connector plugin
  registry entries now expose additive `trustPreview` metadata.
- Connector plugin registry now exposes `previewInstall()` so install UX can
  show trust state before copying plugin files.

Acceptance:

- Users can understand origin, permissions, tool surfaces, and risks before
  enabling a plugin/skill/MCP server.
- Duplicate or replaced plugin code is disabled/removed, not left as parallel
  active paths.
- Existing install, enable, route, tool id, provider id, storage schema, IPC
  channel, and HTTP route behavior remains unchanged.

Verification:

- `node scripts/verify-skill-local-only-boundary.mjs`
- `node scripts/verify-marketplace-trust-model.mjs`
- `node --test tests/behavior/marketplace-trust-model.test.mjs`

### PM-002: External MCP Governance

Scope:

- Decide whether external MCP servers may reuse OAuth tokens or must maintain
  isolated token stores.
- Keep external MCP optional and disabled by default.
- Route MCP tools through connector catalog policy, not raw agent tools.

Acceptance:

- External MCP tools retain confirmation, timeline, security broker, and audit
  behavior.
- Token sharing rules are explicit and testable.

Verification:

- `docs/task-runtime/MCP_INTEGRATION.md`
- New MCP governance tests/verifiers.

### PM-003: Sharing, Signatures, And Archive Cleanup

Scope:

- Add signing/trust metadata for shareable skills/plugins if distribution is
  enabled.
- Move replaced or deleted local installs into recoverable archive only when
  necessary; otherwise delete obsolete code.

Acceptance:

- No stale plugin/skill references remain after replacement.
- Archive entries are not active or discoverable as runnable tools.

Verification:

- New stale-plugin-reference verifier.

## Phase H: Privacy, Sandbox, Sidecars, And Release Hardening

### SH-001: OS-Level Sandbox Decision Records

Scope:

- For file operations, external commands, browser automation, OCR, and optional
  sidecars, decide which need process isolation.
- Require measured risk/benefit before native sidecars or OS sandboxing.

Acceptance:

- High-risk actions have explicit isolation decisions, rollback paths, and user
  recovery behavior.
- No whole-app language rewrite.

Verification:

- `node scripts/verify-privacy-sandbox-policy.mjs`
- New sandbox decision-record verifier.

### SH-002: Sidecar Decision Record Template

Scope:

- Add `docs/architecture/sidecar-decision-record.md`.
- Require a measured bottleneck, why worker/child process is insufficient,
  serialization/cancellation boundary, failure behavior, packaging impact, and
  rollback path.
- Explicitly prohibit sidecars as a general business-logic rewrite.

Acceptance:

- No Rust/Go/Python/native sidecar can be introduced without filling the record
  and passing the verifier.
- Sidecar decisions distinguish performance isolation from security isolation.

Verification:

- New `verify-sidecar-decision-record`

### SH-003: Audit Export And Policy Trace

Scope:

- Export privacy/security decisions, blocked capabilities, approvals, and tool
  risk decisions as a user-readable audit bundle.

Acceptance:

- Users can inspect what was blocked, allowed, approved, and why.
- Export does not leak secrets.

Verification:

- New audit-export behavior tests.

## Phase I: Observability And Quality Trends

### OQ-001: Eval Trend Store

Scope:

- Persist deterministic eval metrics across runs.
- Add trend comparisons for pass rate, blocked rate, token cost, latency, and
  top failure classes.

Acceptance:

- A regression can be identified across commits without reading raw reports.

Verification:

- `node scripts/verify-eval-quality-metrics.mjs`
- New trend-store verifier.

### OQ-002: Span Taxonomy And Optional OTEL Export

Scope:

- Define stable span names for routing, context, memory, graph nodes, tool calls,
  model calls, artifacts, approvals, desktop UI, and connectors.
- Add optional OTEL/export shape after local trace taxonomy stabilizes.

Acceptance:

- Local trace remains useful without OTEL.
- Optional export does not add hot-path overhead.

Verification:

- `node scripts/verify-task-trace-timeline.mjs`
- New span taxonomy verifier.

## Recommended PR Order

1. PX-001: tracked roadmap/status hygiene.
2. RT-001: SQLite write-path audit and queue decision.
3. RT-002: session/context/artifact write budget enforcement.
4. RT-003: context trace persistence and budget audit.
5. RT-004: permission and mode model.
6. DX-001: WindowSession state machine.
7. DX-002: Electron main IPC boundary split.
8. DX-003: renderer runtime client consolidation.
9. DX-004: keyboard-only/a11y GUI pass.
10. DX-005: first-run/i18n/preview fidelity completion.
11. VX-001: real audio/KWS fixtures.
12. GX-003: generic graph resume.
13. RV-001: optional git checkpoint mode.
14. SA-001: sub-agent runtime contract.
15. SA-002: sub-agent UI/evals.
16. MM-001: bind model roles to call sites.
17. MM-002: reviewer/voting loops.
18. PM-001: marketplace trust model.
19. PM-002: external MCP governance.
20. PM-003: sharing/signatures/archive cleanup.
21. SH-001: OS sandbox decision records.
22. SH-002: sidecar decision record template.
23. SH-003: audit export and policy trace.
24. OQ-001: eval trend store.
25. OQ-002: span taxonomy and optional OTEL export.

This order intentionally completes desktop state and observability before true
sub-agents and multi-model collaboration. Sub-agents multiply failures if window
ownership, graph resume, cancellation, budgets, and traces are not already
strict.
