# Post Runtime Upgrade Roadmap

This roadmap captures the work that was repeatedly mentioned in
`FRAMEWORK_GAP_ANALYSIS.md`, `FUNCTION_AUDIT_AND_UPGRADE_PLAN.md`, and the
runtime/electron execution plans, but was intentionally deferred from the
canonical memory/conversation/context/artifact/performance sequence.

The previous canonical sequence is complete. This file is the next execution
board for desktop experience, generic graph resume, sub-agent runtime,
multi-model execution, plugin/MCP marketplace work, privacy sandbox hardening,
and long-term observability.

## Source Map

| Area | Source references | Current state |
| --- | --- | --- |
| True sub-agent runtime | `FRAMEWORK_GAP_ANALYSIS.md` sections 4.1, 5.1; `FUNCTION_AUDIT_AND_UPGRADE_PLAN.md` FW-022 | Not implemented; deferred until session/context/evals stabilized. |
| Multi-model execution | `FRAMEWORK_GAP_ANALYSIS.md` sections 4.1, 5.7; `FUNCTION_AUDIT_AND_UPGRADE_PLAN.md` FW-025 | Role-routing summary exists; executor call sites do not yet switch per role. |
| Generic HITL graph resume | `FRAMEWORK_GAP_ANALYSIS.md` section 3.4; `FUNCTION_AUDIT_AND_UPGRADE_PLAN.md` FW-006/FW-020 | Approval resume metadata and connector-workflow resume exist; generic agent/tool same-run resume remains. |
| Desktop/GUI completion | `FRAMEWORK_GAP_ANALYSIS.md` sections 3.5, 3.6, 3.8, 5.5; `FUNCTION_AUDIT_AND_UPGRADE_PLAN.md` FW-007/FW-008/FW-013/FW-014/FW-017/FW-030 | Real GUI smoke is strong but not complete; real mic/KWS, full WindowSession, keyboard-only settings/approval, first-run GUI, and richer preview fidelity remain. |
| Timeline/trace/export | `FRAMEWORK_GAP_ANALYSIS.md` sections 3.1, 5.6; `FUNCTION_AUDIT_AND_UPGRADE_PLAN.md` FW-010/FW-023/FW-024 | Local trace summary exists; trend storage, richer span taxonomy, optional LLM judge, and OTEL/export remain. |
| Memory governance next pass | `FRAMEWORK_GAP_ANALYSIS.md` section 5.3; `FUNCTION_AUDIT_AND_UPGRADE_PLAN.md` FW-019 | Editable memory exists; auto-learning proposals, review history, undo, and richer project scoping remain. |
| Plugin/MCP marketplace | `FRAMEWORK_GAP_ANALYSIS.md` sections 5.9 and MCP ecosystem notes; `FUNCTION_AUDIT_AND_UPGRADE_PLAN.md` FW-027; `docs/task-runtime/MCP_INTEGRATION.md` | Skill/MCP trust primitives exist; discovery, trust preview, signatures, sharing UX, and external MCP governance remain. |
| Privacy/sandbox hardening | `FRAMEWORK_GAP_ANALYSIS.md` section 5.8; `FUNCTION_AUDIT_AND_UPGRADE_PLAN.md` FW-026 | Privacy policy/broker foundation exists; OS-level sandbox/codesign boundaries and richer controls remain. |
| Task/conversation/project IA migration | `FUNCTION_AUDIT_AND_UPGRADE_PLAN.md` FW-028; `docs/architecture/current-codebase-structure-audit.md` | IA invariants and contracts exist; broader storage/content migration and UI cleanup remain. |

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

## Phase B: Desktop Experience Completion

### DX-001: WindowSession State Machine

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
- New `verify-window-session-state-machine`
- Behavior tests for state transitions and stale-event rejection.

### DX-002: Electron Main IPC Boundary Split

Scope:

- Split `src/desktop/tray/electron-main.mjs` IPC groups into small modules under
  `src/desktop/tray/ipc/` without changing public IPC channel names.
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
- New `verify-desktop-ipc-boundaries`

### DX-003: Renderer Runtime Client Consolidation

Scope:

- Move direct renderer `fetch` mutations into typed runtime clients for Console,
  Overlay, and panel modules.
- Keep UI state in renderers; keep runtime semantics in service/client modules.
- Do not add a heavy frontend framework rewrite.

Acceptance:

- Console/Overlay no longer each own ad hoc copies of runtime mutation logic.
- Service routes used by UI have a shared client contract and tests.
- Old duplicated request helpers are removed or archived after replacement.

Verification:

- `node scripts/verify-desktop-renderer.mjs`
- `node scripts/verify-console-runtime-client.mjs`
- New client contract behavior tests.

### DX-004: Keyboard-Only And A11y GUI Pass

Scope:

- Cover Settings, provider setup, approval cards, popup cards, branch controls,
  task detail, and schedule forms.
- Add real GUI smoke hooks for tab order, focus restore, Escape behavior, and
  visible labels.

Acceptance:

- Core desktop workflows are usable with keyboard only.
- Approval/deny flows preserve focus and expose accessible names.
- Regressions fail a verifier before release.

Verification:

- `node scripts/verify-a11y-keyboard-contract.mjs`
- `npm run verify:desktop-gui-smoke`
- New keyboard-only GUI smoke checks.

### DX-005: First-Run, i18n, And Preview Fidelity Completion

Scope:

- Add first-run GUI smoke for provider setup and missing-key recovery.
- Continue zh-CN/en-US extraction for Settings, task surfaces, approvals, and
  connector pages.
- Add richer incremental binary draft previews and screenshot-diff checks for
  generated document previews.

Acceptance:

- First-run path is validated in real Electron.
- Major visible strings touched by this phase use shared i18n lookup.
- Preview draft and committed preview stay visually coherent.

Verification:

- `node scripts/verify-i18n-onboarding.mjs`
- `npm run verify:desktop-gui-smoke`
- New preview screenshot-diff verifier.

## Phase C: Voice And Real Desktop Hardware

### VX-001: Real Audio Fixture And KWS Corpus

Scope:

- Add checked-in small audio fixtures for transcription and KWS, or a documented
  optional private fixture path for larger samples.
- Measure WER, empty-rate, final-chunk rate, wake false-positive, and wake
  false-negative rates.

Acceptance:

- Voice quality is proven by real audio samples, not only synthetic text and
  MediaRecorder renderer paths.
- KWS near-misses and custom wake profiles remain guarded.

Verification:

- `node scripts/verify-voice-fixture-testbed.mjs`
- New `verify-real-audio-kws-fixtures`

### VX-002: Optional Hardware Permission Smoke

Scope:

- Add an opt-in local smoke that records from real mic hardware only when an
  explicit env flag is set.
- Keep CI deterministic by default.

Acceptance:

- Hardware permission/capture failures produce actionable diagnostics.
- The default check suite does not hang or require hardware.

Verification:

- New opt-in `npm run verify:desktop-audio-hardware-smoke`

## Phase D: Generic Graph Resume And True Sub-Agents

### GX-003: Generic Agent/Tool Graph Resume

Scope:

- Replace bridge-copy terminalization for generic approval pauses with same-run
  executor continuation.
- Use existing runtime graph checkpoints and approval resume metadata.
- Keep connector workflow resume behavior intact.

Acceptance:

- Approval interruption, approval resume, rejection, retry, and cancellation
  resume the original task execution graph where possible.
- No duplicate bridge task is required for generic agent/tool runs.
- Existing approval GUI smoke still passes.

Verification:

- `node scripts/verify-approval-resume-state.mjs`
- `npm run verify:desktop-gui-smoke`
- New graph-resume behavior/eval tests.

### SA-001: Sub-Agent Runtime Contract

Scope:

- Add a service-owned child-run contract: parent task id, child task id,
  assigned scope, isolated compiled context, allowed tools, budget, cancellation
  token, and result report.
- Start with explicit planner-selected delegation only behind a feature flag.
- Do not add unmanaged recursive agents or prompt-only delegation.

Acceptance:

- Child agents cannot escape assigned tool surface, budget, task scope, or
  context scope.
- Parent task receives structured child reports and can synthesize them.
- Cancellation propagates parent -> child.

Verification:

- New `verify-sub-agent-runtime-contract`
- Behavior tests for isolation, budget exhaustion, cancellation, and report merge.

### SA-002: Sub-Agent UI, Trace, And Eval Coverage

Scope:

- Show child runs under the parent task timeline.
- Add evals for when delegation should and should not happen.
- Record per-child token/timing/tool metrics.

Acceptance:

- Users can inspect what each child agent did and why.
- Delegation does not hide failures or inflate success claims.

Verification:

- New sub-agent eval corpus.
- `node scripts/verify-task-trace-timeline.mjs`

## Phase E: Multi-Model Execution

### MM-001: Bind Model Roles To Real Call Sites

Scope:

- Use existing planner/executor/reviewer role config in actual LLM call sites.
- Start with planner/executor split for low-risk task classes.
- Record role decisions and token/timing deltas.

Acceptance:

- Role routing changes behavior only behind a feature flag or per-task config.
- Reports can compare single-model vs role-routed runs.

Verification:

- `node scripts/verify-model-role-routing.mjs`
- New role-call-site behavior tests.

### MM-002: Reviewer And Voting Loops

Scope:

- Add optional reviewer pass for high-risk artifact, connector, or research
  tasks.
- Add strict budget and latency gates.

Acceptance:

- Reviewer cannot silently rewrite outcomes without trace evidence.
- Reviewer failures degrade gracefully.

Verification:

- New reviewer-loop evals.
- Real-LLM comparison report for targeted cases.

## Phase F: Plugin, Skill, MCP Marketplace

### PM-001: Marketplace Trust Model

Scope:

- Define trusted, local-only, third-party, unsigned, disabled, and deleted states
  for skills/plugins/MCP entries.
- Add trust preview before enable/install.
- Preserve existing local-only and recoverable delete behavior.

Acceptance:

- Users can understand origin, permissions, tool surfaces, and risks before
  enabling a plugin/skill/MCP server.
- Duplicate or replaced plugin code is disabled/removed, not left as parallel
  active paths.

Verification:

- `node scripts/verify-skill-local-only-boundary.mjs`
- New marketplace trust verifier.

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

## Phase G: Privacy, Sandbox, And Release Hardening

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

### SH-002: Audit Export And Policy Trace

Scope:

- Export privacy/security decisions, blocked capabilities, approvals, and tool
  risk decisions as a user-readable audit bundle.

Acceptance:

- Users can inspect what was blocked, allowed, approved, and why.
- Export does not leak secrets.

Verification:

- New audit-export behavior tests.

## Phase H: Observability And Quality Trends

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
2. DX-001: WindowSession state machine.
3. DX-002: Electron main IPC boundary split.
4. DX-003: renderer runtime client consolidation.
5. DX-004: keyboard-only/a11y GUI pass.
6. DX-005: first-run/i18n/preview fidelity completion.
7. VX-001: real audio/KWS fixtures.
8. GX-003: generic graph resume.
9. SA-001: sub-agent runtime contract.
10. SA-002: sub-agent UI/evals.
11. MM-001: bind model roles to call sites.
12. MM-002: reviewer/voting loops.
13. PM-001: marketplace trust model.
14. PM-002: external MCP governance.
15. PM-003: sharing/signatures/archive cleanup.
16. SH-001: OS sandbox decision records.
17. SH-002: audit export and policy trace.
18. OQ-001: eval trend store.
19. OQ-002: span taxonomy and optional OTEL export.

This order intentionally completes desktop state and observability before true
sub-agents and multi-model collaboration. Sub-agents multiply failures if window
ownership, graph resume, cancellation, budgets, and traces are not already
strict.
