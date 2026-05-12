# Branch Status: task/uca-077-connector-foundation

**Date:** 2026-05-10

## Codex Update: CTX-001 Context Selection And Project Packs

Date: 2026-05-12

Scope:
- Added `src/shared/context-selection-project-pack.mjs` as the shared
  view-model for selected/omitted context, project scope, attachments, memory
  scope, and conversation provenance.
- Added `docs/architecture/context-selection-project-pack.md`.
- Updated Console task detail context panel to render the shared project pack
  before selected/omitted rows.
- Added `scripts/verify-context-selection-project-pack.mjs` and
  `tests/behavior/context-selection-project-pack.test.mjs`.
- Wired the verifier into `scripts/check-manifest.mjs` and `package.json`.

Decision:
- No context compiler selection behavior changed.
- No storage schema, HTTP route, IPC channel, provider id, tool id, or approval
  semantics changed.
- Renderer consumes the shared pack view-model; project/context grouping logic
  is not duplicated in the Console renderer.

Verification:
- `node --test tests/behavior/context-selection-project-pack.test.mjs`:
  passed, 1/1.
- `node --test tests/behavior/context-debug-panel.test.mjs`: passed, 2/2.
- `node scripts/verify-context-selection-project-pack.mjs`: passed.
- `node scripts/verify-context-debug-panel-lazy-load.mjs`: passed.
- `node scripts/verify-check-runner.mjs`: passed.
- `node scripts/verify-post-runtime-product-gap-roadmap.mjs`: passed.
- `npm run check:fast`: passed, 134/134; behavior tests passed, 1089/1089.
- `npm run verify:desktop-gui-smoke`: passed 49/49
  (`startup=462ms`, `first_window=462ms`, `interaction=5165ms`,
  `total=5622ms`).

Next valid work:
- Start `REL-001` release evidence bundle.
- Keep the final real API/common-agent acceptance pass as the release-blocking
  closeout after REL-001 creates the evidence bundle shape.

## Codex Update: MMX-002 Budgeted Fallback And Cascade Evidence

Date: 2026-05-12

Scope:
- Added `src/shared/model-fallback-cascade-evidence.mjs` as the shared
  contract for future model fallback, cascade, and ensemble/voting work.
- Added `docs/architecture/model-fallback-cascade-evidence.md`.
- Exposed fallback/cascade policy state through the existing model-role
  management surface.
- Added `scripts/verify-model-fallback-cascade-evidence.mjs` and
  `tests/behavior/model-fallback-cascade-evidence.test.mjs`.
- Wired the verifier into `scripts/check-manifest.mjs` and `package.json`.

Decision:
- No runtime fallback/cascade behavior changed.
- No additional model calls, provider ids, HTTP routes, IPC channels, storage
  schema, or approval semantics were introduced.
- Future fallback/cascade must be opt-in, budget-bounded, traceable, and tied
  to usage measurement keys. Ensemble/voting remains blocked unless eval
  evidence is present and passing.

Verification:
- `node --test tests/behavior/model-fallback-cascade-evidence.test.mjs`:
  passed, 5/5.
- `node scripts/verify-model-fallback-cascade-evidence.mjs`: passed.
- `node scripts/verify-model-role-routing.mjs`: passed.
- `node scripts/verify-check-runner.mjs`: passed.
- `node scripts/verify-post-runtime-product-gap-roadmap.mjs`: passed.
- `npm run check:fast`: passed, 133/133; behavior tests passed, 1088/1088.

Next valid work:
- Start `CTX-001` context selection and project packs.
- Keep the final real API/common-agent acceptance pass as a release-blocking
  product-gap item after CTX-001 and REL-001 are complete.

## Codex Update: MMX-001 Model Role Management Surface

Date: 2026-05-12

Scope:
- Promoted planner/executor/reviewer/fast model roles into the service-owned
  `modelRoles` contract.
- Added `managementSurface` metadata with feature-flag state, per-role health,
  fallback source, cost/usage evidence, and safe live-test action metadata.
- Rendered the model-role management surface in Console Settings > Routing
  before the existing task-routing form.
- Extended the live provider acceptance harness evidence snapshot so real API
  runs carry model-role management surface metadata.

Decision:
- No provider ids, task routing schema, HTTP routes, IPC channels, storage
  schema, or approval semantics changed.
- The fast role is visible as a role but maps to the existing fast executor
  `chat` route, so no new execution lane or behavior fork was added.
- Role call-site routing remains opt-in through the existing model-role flags.

Verification:
- `node --test tests/behavior/model-role-routing.test.mjs`: passed, 7/7.
- `node scripts/verify-model-role-routing.mjs`: passed.
- `node --test tests/behavior/live-provider-acceptance-harness.test.mjs`:
  passed, 4/4.
- `node scripts/verify-live-provider-acceptance-harness.mjs`: passed.
- `npm run check:fast`: passed, 132/132; behavior tests passed, 1083/1083.
- `npm run verify:desktop-gui-smoke`: first attempt hit the known
  `overlay_task_list_keyboard_open_failed` focus timing issue; immediate rerun
  passed 49/49 (`startup=470ms`, `first_window=470ms`,
  `interaction=5033ms`, `total=5497ms`).
- `node scripts/real-llm-test/run-live-provider-acceptance.mjs`: dry-run
  passed and wrote a redacted report under `.tmp/live-provider-acceptance`.

Next valid work:
- Start `MMX-002` budgeted fallback/cascade evidence.
- After the product-gap roadmap is functionally complete, run a real
  API/common-agent acceptance pass across provider calls, tools, artifacts,
  context, connectors, memory, fallback, and recovery; fix failures at the
  framework layer, not with prompt-only patches.

## Codex Update: SBOX-001 High-Risk Sandbox Evidence Pack

Date: 2026-05-12

Scope:
- Added `src/shared/sandbox-evidence-pack.mjs` as the typed evidence contract
  for high-risk runtime surfaces.
- Added `scripts/run-sandbox-evidence-pack.mjs` to run deterministic evidence
  commands for file mutation, command execution, MCP install, OCR, browser
  automation, and audio daemon surfaces.
- Added `docs/architecture/sandbox-evidence-pack.md`,
  `docs/release/evidence/sandbox-evidence-pack.template.json`,
  `scripts/verify-sandbox-evidence-pack.mjs`, and
  `tests/behavior/sandbox-evidence-pack.test.mjs`.
- Wired the verifier into `scripts/check-manifest.mjs`, `package.json`, and the
  post-runtime product gap roadmap. No sandbox boundary, IPC channel, HTTP
  route, tool id, artifact kind, provider id, or storage schema changed.

Decision:
- SBOX-001 is evidence-only. The shared contract requires
  `boundaryChange: false`.
- Future OS sandbox, native helper, or sidecar changes must reference measured
  evidence and update the SH-004 decision record rather than changing runtime
  boundaries ad hoc.

Verification:
- `node --test tests/behavior/sandbox-evidence-pack.test.mjs`: passed, 4/4.
- `node scripts/verify-sandbox-evidence-pack.mjs`: passed.
- `node scripts/run-sandbox-evidence-pack.mjs`: passed and wrote a redacted
  report under `.tmp/sandbox-evidence-pack`.
- `npm run check:fast`: passed, 132/132; behavior tests passed, 1082/1082.

Next valid work:
- Start `MMX-001` model role management surface: expose planner/executor/
  reviewer/fast role assignments, provider health, cost/fallback state, and
  test actions without requiring config-file edits.

## Codex Update: CONN-001 Connector OAuth Acceptance Harness

Date: 2026-05-12

Scope:
- Added `src/shared/connector-oauth-acceptance-harness.mjs` as the typed,
  redacted connector/OAuth acceptance evidence contract.
- Added `scripts/real-connector-test/run-connector-oauth-acceptance.mjs` with
  dry-run default and explicit live mode via `--live` or
  `LINGXY_CONNECTOR_OAUTH_ACCEPTANCE=1`.
- Added `docs/architecture/connector-oauth-acceptance-harness.md`,
  `docs/release/evidence/connector-oauth-acceptance.template.json`,
  `scripts/verify-connector-oauth-acceptance-harness.mjs`, and
  `tests/behavior/connector-oauth-acceptance-harness.test.mjs`.
- Wired the verifier into `scripts/check-manifest.mjs`, `package.json`, and the
  post-runtime product gap roadmap. No IPC channels, HTTP routes, tool ids,
  artifact kinds, provider ids, or storage schema changed.

Decision:
- Keep OAuth and connector acceptance opt-in so deterministic CI does not
  depend on external tenants or disposable accounts.
- Live mode verifies connector catalog, connector config, OAuth start URL,
  connected-account state, and read-list endpoints. Reports store counts and
  statuses only, not message bodies or file contents.
- Guarded side effects and disconnect are present in the contract but blocked
  by default; they require separate flags and disposable-account evidence.

Verification:
- `node --test tests/behavior/connector-oauth-acceptance-harness.test.mjs`:
  passed, 4/4.
- `node scripts/verify-connector-oauth-acceptance-harness.mjs`: passed.
- `node scripts/real-connector-test/run-connector-oauth-acceptance.mjs`:
  dry-run passed and wrote a redacted report under
  `.tmp/connector-oauth-acceptance`.
- `npm run check:fast`: passed, 131/131; behavior tests passed, 1078/1078.
- No disposable OAuth account was available in this checkpoint, so live OAuth
  browser login and side-effect rows were not executed.

Next valid work:
- Start `SBOX-001` high-risk sandbox evidence pack: add measured evidence for
  file mutation, command execution, MCP install, OCR, browser automation, and
  audio daemon surfaces before changing sandbox boundaries.

## Codex Update: LAPI-001 Live Provider Acceptance Harness

Date: 2026-05-12

Scope:
- Added `src/shared/live-provider-acceptance-harness.mjs` as the typed,
  secret-redacted live-provider acceptance evidence contract.
- Added `scripts/real-llm-test/run-live-provider-acceptance.mjs` with a
  default dry-run mode and explicit live mode via `--live` or
  `LINGXY_LIVE_PROVIDER_ACCEPTANCE=1`.
- Added `docs/architecture/live-provider-acceptance-harness.md`,
  `docs/release/evidence/live-provider-acceptance.template.json`,
  `scripts/verify-live-provider-acceptance-harness.mjs`, and
  `tests/behavior/live-provider-acceptance-harness.test.mjs`.
- Wired the verifier into `scripts/check-manifest.mjs`, `package.json`, and the
  post-runtime product gap roadmap. No IPC channels, HTTP routes, tool ids,
  artifact kinds, provider ids, or storage schema changed.

Decision:
- Keep real provider acceptance opt-in so deterministic CI does not depend on
  paid APIs or local credentials.
- Dry-run mode is the default evidence contract check; live mode starts or
  attaches to runtime, reads `/health`, `/ai/providers`, `/config/integrations`,
  submits one short `/task`, and validates `llm_usage` token/cost trace
  visibility from `/task/:id`.
- Fault recovery rows are part of the report contract, but missing-key,
  rate-limit, invalid-model, and provider-failure induction remain opt-in so
  the harness does not intentionally burn quota or mutate credentials.

Verification:
- `node --test tests/behavior/live-provider-acceptance-harness.test.mjs`:
  passed, 4/4.
- `node scripts/verify-live-provider-acceptance-harness.mjs`: passed.
- `node scripts/real-llm-test/run-live-provider-acceptance.mjs`: dry-run
  passed and wrote a redacted report under `.tmp/live-provider-acceptance`.
- `node scripts/verify-post-runtime-product-gap-roadmap.mjs`: passed.
- `node scripts/verify-check-runner.mjs`: passed.
- `npm run check:fast`: passed, 130/130; behavior tests passed, 1074/1074.
- Common provider API environment variables were not present, so no paid live
  provider call was run in this checkpoint.

Next valid work:
- Start `CONN-001` real connector/OAuth acceptance: add a disposable-account
  evidence contract and opt-in runner for OAuth connect/disconnect, token
  refresh, list operations, guarded send/calendar side effects, and redacted
  recovery copy.

## Status: Phases 2B-2G + CAP-0 Inventory/Checkpoint Complete; All Codex Blockers Resolved

All planned low-risk extraction and inventory work across Phases 2A through 2G and CAP-0 is committed. High-risk deferred items: write/edit/run/generate/render tools, GUI automation, capability creator, full capability migration, desktop app directory move. All Codex review blockers from rounds 1-6 resolved. check:fast green.

## Codex Update: RT-001 SQLite Write-Path Budget

Date: 2026-05-11

Scope:
- Added `docs/architecture/sqlite-write-path-budget.md` as the RT-001 audit and queue decision record.
- Added `scripts/verify-sqlite-write-path-budget.mjs` and wired it into full and fast check manifests.
- Updated the post-runtime roadmap to mark RT-001 complete as an audit/decision-record phase.
- Did not change product runtime behavior, storage schema, IPC channels, HTTP routes, tool ids, artifact kinds, provider ids, or desktop UI code.

Decision:
- Keep direct service-owned SQLite writes for the current program.
- Do not implement a DB queue or DB worker in RT-001.
- Rationale: SQLite ownership is concentrated in `src/service/core/store/sqlite-store.mjs`, WAL/service-only ownership is declared, Electron desktop code does not own SQLite, and high-frequency stream events are already excluded from SQLite task-event persistence.

Next valid work:
- Start RT-002 session/context/artifact write budget enforcement using the RT-001 direct-write decision.
- Only introduce a queue/worker if RT-002 finds measured hot-path pressure or a concrete write-budget enforcement gap.

Verification:
- `node --check scripts/verify-sqlite-write-path-budget.mjs`: passed.
- `node scripts/verify-sqlite-write-path-budget.mjs`: passed.
- `node scripts/verify-post-runtime-roadmap.mjs`: passed.
- `node scripts/verify-check-runner.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `node scripts/verify-event-fast-lane.mjs`: passed.
- `npm run check:fast`: passed, 98/98; behavior tests passed, 987/987.

## Codex Update: RT-002 Session/Context/Artifact Write Budget

Date: 2026-05-11

Scope:
- Added `docs/architecture/session-context-artifact-write-budget.md` as the RT-002 enforcement record.
- Added `scripts/verify-session-context-artifact-write-budget.mjs` and wired it into full and fast check manifests.
- Updated the post-runtime roadmap to mark RT-002 complete as a direct-write enforcement phase.
- Did not change product runtime behavior, storage schema, IPC channels, HTTP routes, tool ids, artifact kinds, provider ids, connector behavior, or desktop UI code.

Decision:
- Keep the RT-001 direct service-owned write decision for session/context/artifact writes.
- Do not add `context_compile_traces` in RT-002; normal trace storage remains compact `task.context_packet.compiled_context`.
- Keep artifact extract writes behind bounded service/background-lane contracts and artifact lineage as a critical transform-contract write.

Verification:
- `node --check scripts/verify-session-context-artifact-write-budget.mjs`: passed.
- `node scripts/verify-session-context-artifact-write-budget.mjs`: passed.
- `node scripts/verify-post-runtime-roadmap.mjs`: passed.
- `node scripts/verify-check-runner.mjs`: passed.
- `node --test tests/behavior/conversation-session-service.test.mjs tests/behavior/context-compiler.test.mjs tests/behavior/task-runtime-task-record.test.mjs`: passed, 15/15.
- `node --test tests/behavior/artifact-extract-service.test.mjs tests/behavior/artifact-extract-background-lane.test.mjs tests/behavior/artifact-lineage-service.test.mjs tests/behavior/artifact-transform-service.test.mjs`: passed, 18/18.
- `npm run check:fast`: passed, 99/99; behavior tests passed, 987/987.

Next valid work:
- Start RT-003 context trace persistence and budget audit.
- Use RT-002's decision as the starting point: compact task metadata is the current canonical trace storage unless RT-003 proves a persistent trace table is needed.

## Codex Update: RT-003 Context Trace Budget

Date: 2026-05-11

Scope:
- Added `docs/architecture/context-trace-budget.md` as the RT-003 context trace decision record.
- Added `scripts/verify-context-trace-budget.mjs` and wired it into full and fast check manifests.
- Updated the post-runtime roadmap to mark RT-003 complete.
- Did not change product runtime behavior, storage schema, IPC channels, HTTP routes, tool ids, artifact kinds, provider ids, connector behavior, or desktop UI code.

Decision:
- Compact task metadata is the canonical context trace storage for the current program.
- Do not add `context_compile_traces` in RT-003.
- Keep full candidate traces debug-only and full compiled-context JSON copy-only in the Context Debug Panel.

Verification:
- `node --check scripts/verify-context-trace-budget.mjs`: passed.
- `node scripts/verify-context-trace-budget.mjs`: passed.
- `node scripts/verify-post-runtime-roadmap.mjs`: passed.
- `node scripts/verify-check-runner.mjs`: passed.
- `node --test tests/behavior/context-compiler.test.mjs tests/behavior/context-debug-panel.test.mjs tests/behavior/task-runtime-task-record.test.mjs`: passed, 13/13.
- `node scripts/verify-context-compiler-v1.mjs`: passed.
- `node scripts/verify-context-debug-panel-lazy-load.mjs`: passed.
- `node scripts/verify-session-context-artifact-write-budget.mjs`: passed.
- `npm run check:fast`: passed, 100/100; behavior tests passed, 987/987.

Next valid work:
- Start RT-004 permission and mode model.

## Codex Update: RT-004 Permission And Mode Model

Date: 2026-05-12

Scope:
- Added `src/shared/permission-mode-model.mjs` as the shared execution-mode,
  approval-threshold, privacy-sandbox, and user-visible mode contract.
- Persisted `permission_mode_contract` into task selection metadata and mirrored
  it into durable `task_created` trace payloads.
- Updated the existing tool_using fast path, tool_using confirmation gate, and
  agentic tool execution gate to use shared mode helpers instead of scattered
  raw `execution_mode` checks.
- Exposed mode labels in Console task detail and Overlay active-task surfaces.
- Added `docs/architecture/permission-mode-model.md`,
  `scripts/verify-permission-mode-model.mjs`, and
  `tests/behavior/permission-mode-model.test.mjs`.

Decision:
- Keep existing approval semantics: interactive/approval-required/background
  modes prompt for confirmation-required tools; `unattended_safe` does not
  prompt and blocks high-risk tools.
- Keep privacy sandbox enforcement in the existing shared privacy policy and
  security broker; the mode model summarizes that state for users and trace.
- There is no implemented dry-run runtime path yet, so the contract explicitly
  reports `dry_run_like: false`.

Verification:
- `node --test tests/behavior/permission-mode-model.test.mjs`: passed, 3/3.
- `node scripts/verify-permission-mode-model.mjs`: passed.
- `node scripts/verify-privacy-sandbox-policy.mjs`: passed.
- `node scripts/verify-approval-task-bridge.mjs`: passed, 31/31.
- `node --test tests/behavior/action-tool-submission.test.mjs tests/behavior/agent-loop-confirmation-gate.test.mjs tests/behavior/context-debug-panel.test.mjs`: passed, 11/11.
- `npm run check:fast`: passed, 101/101; behavior tests passed, 990/990.
- `npm run verify:desktop-gui-smoke`: passed, 44/44.

Next valid work:
- Start DX-001 WindowSession state machine.
- Keep the same discipline: define typed state ownership first, wire Overlay /
  Console / Preview / Popup ownership through service/desktop boundary modules,
  and prove stale task/window events are rejected before broader UI cleanup.

## Codex Update: DX-001 WindowSession State Machine

Date: 2026-05-12

Scope:
- Added `src/desktop/shared/window-session-state.mjs` as the shared desktop
  owner model for managed windows, task/conversation owners, preview bindings,
  popup-card owners, background/system task ownership, and stale event records.
- Wired Electron shell, preview manager, preview IPC, and popup-card manager to
  use one injected WindowSession object.
- Preview init now binds owner state; preview delta/commit IPC returns stale
  owner rejection decisions when payloads target a different task/conversation.
- Added `docs/architecture/window-session-state-machine.md`,
  `scripts/verify-window-session-state-machine.mjs`, and
  `tests/behavior/window-session-state.test.mjs`.

Decision:
- DX-001 is complete as the first WindowSession implementation.
- This phase does not split remaining IPC handlers; DX-002 owns IPC boundary
  extraction under `src/desktop/main/ipc/` while preserving channel names.
- No storage schema, HTTP route, tool id, artifact kind, provider id, or IPC
  channel name changed.

Verification:
- `node --test tests/behavior/window-session-state.test.mjs`: passed, 3/3.
- `node scripts/verify-window-session-state-machine.mjs`: passed.
- `node scripts/verify-desktop-shell.mjs`: passed.
- `node scripts/verify-preview-window.mjs`: passed.
- `node scripts/verify-desktop-renderer.mjs`: passed.
- `node scripts/verify-popup-card-fit.mjs`: passed.
- `npm run check:fast`: passed, 102/102; behavior tests passed, 993/993.
- `npm run verify:desktop-gui-smoke`: passed, 44/44.

Next valid work:
- Start DX-002 Electron Main IPC Boundary Split.
- First inventory the remaining inline `ipcMain.handle/on` groups in
  `src/desktop/tray/electron-main.mjs`, then extract one cohesive group at a
  time into `src/desktop/main/ipc/` with targeted static verifier coverage and
  a full GUI smoke gate before completion.

## Codex Update: DX-002 Electron Main IPC Boundary

Date: 2026-05-12

Scope:
- Added `docs/architecture/desktop-ipc-boundaries.md` as the DX-002 IPC
  composition decision record.
- Added `scripts/verify-desktop-ipc-boundaries.mjs` and wired it into full and
  fast check manifests.
- Verified that `src/desktop/tray/electron-main.mjs` has no inline
  `ipcMain.handle/on` registrations and only composes extracted registration
  modules.
- Locked 112 IPC registrations under `src/desktop/main/ipc/register-*.mjs`
  against duplicate channels, oversized handler bodies, and direct
  `src/service/**` imports.

Decision:
- DX-002 is complete as a boundary-lock phase because the physical IPC split
  already exists in the current code.
- No IPC channel name, HTTP route, storage schema, tool id, artifact kind,
  provider id, or runtime behavior changed.

Verification:
- `node scripts/verify-desktop-ipc-boundaries.mjs`: passed.
- `node scripts/verify-ipc-contract-inventory.mjs`: passed.
- `node scripts/verify-main-process-blocking.mjs`: passed.
- `node scripts/verify-desktop-shell.mjs`: passed.
- `npm run check:fast`: passed, 103/103; behavior tests passed, 993/993.
- `npm run verify:desktop-gui-smoke`: passed, 44/44.

Next valid work:
- Start DX-003 Renderer Runtime Client Consolidation.
- First inventory renderer mutation/request call sites by Console, Overlay,
  Preview, and shared panel surfaces; then extract typed clients without a
  frontend framework rewrite and prove no direct service/runtime imports or
  duplicated mutation helpers remain.

## Codex Review: DX-003 Renderer Runtime Client Consolidation

Date: 2026-05-12

Status:
- DX-003 is complete as the first renderer runtime mutation consolidation
  slice.

Scope:
- Added `src/desktop/renderer/shared/runtime-submission-client.mjs` as the
  shared renderer mutation client for task submission, task clarification,
  conversation creation, and conversation model overrides.
- Added `src/desktop/renderer/shared/runtime-user-memory-client.mjs` for
  user-memory save/proposal/delete mutations.
- Added `src/desktop/renderer/shared/runtime-preflight-client.mjs` for
  MCP/skill preflight, MCP install planning, and DAG preview mutations.
- Migrated Console and Overlay `/task` and `/task/clarify` mutation call sites
  to the shared client.
- Migrated Console conversation creation and model override mutation call sites
  to the shared client.
- Migrated Console user-memory, MCP/skill preflight, MCP install planning, and
  DAG preview mutation call sites to shared clients.
- Added behavior tests for all three new renderer runtime clients.
- Added `scripts/verify-renderer-runtime-client-consolidation.mjs` and wired it
  into full and fast check manifests.

Verification:
- `node --test tests/behavior/runtime-submission-client.test.mjs tests/behavior/runtime-user-memory-client.test.mjs tests/behavior/runtime-preflight-client.test.mjs`: passed, 5/5.
- `node scripts/verify-renderer-runtime-client-consolidation.mjs`: passed.
- `node scripts/verify-desktop-renderer.mjs`: passed.
- `node scripts/verify-console-runtime-client.mjs`: passed.
- `node scripts/verify-ui-extras.mjs`: passed after updating stale verifier
  expectations from page-script endpoint ownership to runtime-client endpoint
  ownership.
- `node scripts/verify-console-rendered-workspace.mjs`: passed after updating
  stale desktop shell/runtime-client expectations.
- `npm run check:fast`: passed, 104/104; behavior tests passed, 998/998.
- `npm run verify:desktop-gui-smoke`: passed, 44/44.

Next valid work:
- Commit DX-003 and start DX-004 keyboard-only/a11y GUI pass.

## Codex Review: DX-004 Keyboard/A11y GUI Pass

Date: 2026-05-12

Status:
- DX-004 is complete as a real GUI keyboard/a11y coverage pass.

Scope:
- Extended `src/desktop/smoke/desktop-gui-smoke-runner.mjs` with native
  `webContents.sendInputEvent` keyboard driving.
- Added real Electron smoke coverage for Overlay task-list open, roving filter
  navigation, and Escape focus restore.
- Added real Electron smoke coverage for Console Settings and Schedules rail
  keyboard activation plus visible Settings/Schedule labels.
- Changed the approval popup close path in GUI smoke from mouse click to
  keyboard-focused reject via Space.
- Updated a11y/user-interaction verifiers so these keyboard smoke checks stay
  required.

Verification:
- `node scripts/verify-a11y-keyboard-contract.mjs`: passed.
- `node scripts/verify-user-interaction-smoke.mjs`: passed.
- `npm run check:fast`: passed, 104/104; behavior tests passed, 998/998.
- `npm run verify:desktop-gui-smoke`: passed, 47/47.

Next valid work:
- Commit DX-004 and start DX-005 first-run/i18n/preview fidelity.

## Codex Review: DX-005 First-Run, i18n, And Preview Fidelity

Date: 2026-05-12

Status:
- DX-005 is complete.

Scope:
- Added Console GUI smoke coverage for first-run provider setup recovery:
  recoverable missing API-key state renders in the setup checklist, exposes the
  provider settings action, and does not leak secret-looking values.
- Added Preview window smoke preparation for `generate_document` visual
  coherence: initial draft then incremental draft update for the same task.
- Added real Electron screenshot capture and sampled image comparison in
  `src/desktop/smoke/desktop-gui-smoke-runner.mjs`.
- Added `scripts/verify-preview-screenshot-diff.mjs` and wired it into full and
  fast checks.
- Extended i18n/user-interaction verifiers so first-run recovery and preview
  screenshot-diff stay required.

Verification:
- `node scripts/verify-i18n-onboarding.mjs`: passed.
- `node scripts/verify-preview-screenshot-diff.mjs`: passed.
- `node scripts/verify-user-interaction-smoke.mjs`: passed.
- `npm run verify:desktop-gui-smoke`: passed, 49/49.
- `npm run check:fast`: passed, 105/105; behavior tests passed, 998/998.

Next valid work:
- Commit DX-005 and move to VX-001 real audio/KWS fixtures.

## Codex Review: VX-001 Real Audio And KWS Fixture Corpus

Date: 2026-05-12

Status:
- VX-001 is complete.

Scope:
- Added checked-in PCM WAV fixtures under `tests/fixtures/audio/` for
  transcription and wake-word coverage.
- Added `tests/fixtures/audio/manifest.json` with SHA-256 locks, locales,
  expected transcript labels, wake expectations, near-miss cases, and the
  optional `LINGXY_REAL_AUDIO_FIXTURE_DIR` private corpus path.
- Added `src/service/audio/audio-fixture-corpus.mjs` to validate RIFF/WAVE PCM
  metadata, duration, RMS/peak, hashes, transcription WER, empty-rate, and wake
  false-positive/false-negative rates.
- Added `scripts/verify-real-audio-kws-fixtures.mjs`, wired it into
  `package.json`, `scripts/check-manifest.mjs`, and the post-runtime roadmap
  verifier.

Verification:
- `node --check src/service/audio/audio-fixture-corpus.mjs`: passed.
- `node --check scripts/verify-real-audio-kws-fixtures.mjs`: passed.
- `node scripts/verify-voice-fixture-testbed.mjs`: passed.
- `npm run verify:real-audio-kws-fixtures`: passed.
- `node scripts/verify-post-runtime-roadmap.mjs`: passed.
- `node scripts/verify-check-runner.mjs`: passed.
- `npm run check:fast`: passed, 106/106; behavior tests passed, 998/998.

Next valid work:
- Commit VX-001 and move to VX-002 optional desktop audio hardware permission
  smoke.

## Codex Review: VX-002 Optional Desktop Audio Hardware Smoke

Date: 2026-05-12

Status:
- VX-002 is complete as an opt-in local hardware diagnostic.

Scope:
- Added `window.__lingxyOverlaySmoke.runAudioHardwarePermissionPath()` to drive
  the real renderer microphone permission and MediaRecorder path through
  `requestAudioInputStream`.
- Added opt-in Electron GUI smoke wiring:
  `LINGXY_DESKTOP_AUDIO_HARDWARE_SMOKE=1` enables the named
  `overlay_audio_hardware_permission_capture` check.
- Added `npm run verify:desktop-audio-hardware-smoke`; without the env flag it
  skips cleanly and does not touch hardware.
- Added `scripts/verify-desktop-audio-hardware-smoke-contract.mjs` and wired it
  into `check:fast`.

Verification:
- `node scripts/verify-desktop-audio-hardware-smoke-contract.mjs`: passed.
- `npm run verify:desktop-audio-hardware-smoke`: passed by clean default skip.
- `LINGXY_DESKTOP_AUDIO_HARDWARE_SMOKE=1 npm run verify:desktop-audio-hardware-smoke`:
  executed the real Electron path and failed with actionable current-machine
  diagnostic `no_device: 未检测到可用的麦克风。请确认设备已连接后重试。`
- `npm run verify:desktop-gui-smoke`: passed, 49/49.
- `npm run check:fast`: passed, 107/107; behavior tests passed, 998/998.

Next valid work:
- Commit VX-002 and move to GX-003 generic approval resume, RV-001 git
  checkpoint evaluation, or SA-001 sub-agent runtime contract. Recommended next:
  GX-003 because it closes the highest-impact runtime continuity gap.

## Codex Review: GX-003 Generic Agent Tool Graph Resume

Date: 2026-05-12

Status:
- GX-003 is complete for generic `agent_tool_call` approvals.

Scope:
- Added `src/service/scheduler/approval-graph-resume.mjs`.
- Runtime service approvals now route generic agent tool approvals through
  same-task resume instead of direct tool execution plus bridge terminalization.
- Same-task resume emits `approval_resume_started`, `tool_call_completed`, and
  terminal `success`/`failed` events on the original task with
  `same_task_resume: true`.
- Compatibility bridge terminalization now skips same-task resume results.
- Runtime graph checkpoint mapping recognizes `approval_resume_started`.
- Connector workflow resume path was not changed.

Verification:
- `node --test tests/behavior/approval-resume-state.test.mjs`: passed, 4/4.
- `node --test tests/behavior/task-runtime-services.test.mjs`: passed, 5/5.
- `node scripts/verify-approval-resume-state.mjs`: passed.
- `node scripts/verify-runtime-graph-nodes.mjs`: passed.
- `node scripts/verify-runtime-graph-replay.mjs`: passed.
- `npm run verify:desktop-gui-smoke`: passed, 49/49.
- `npm run check:fast`: passed, 107/107; behavior tests passed, 999/999.

Next valid work:
- Commit GX-003 and move to RV-001 optional git checkpoint evaluation.

## Completed Phases

| Phase | Module | Lines |
|-------|--------|-------|
| 2B.42 | `desktop-window-lifecycle.mjs` | ~145 |
| 2B.43 | `desktop-window-actions.mjs` | ~106 |
| 2B.44 | `desktop-shortcut-router.mjs` | ~220 |
| 2B.45 | `desktop-link-browser-window.mjs` | ~252 |
| 2B.46 | `desktop-preview-window-manager.mjs` | 124 |
| 2B.47 | `desktop-gui-smoke-runner.mjs` | 785 |
| 2B.48 | `desktop-permission-handler.mjs` | 35 |

## electron-main.mjs Reduction

- Original: 2543 lines
- Current: 1072 lines
- Net reduction: **-1471 lines (-58%)**

## Verification

- GUI smoke: 44/44 checks pass (unchanged since start)
- `npm run check:fast`: 65/65 pass
- All dedicated verifiers updated for new module ownership
- IPC contract snapshot stable
- Codex rerun on 2026-05-10: `npm run check:fast` passed 65/65 and behavior tests passed 986/986; no current behavior-test failure was observed in this review

## Codex Review: Phases 2B.47-2B.48

Review scope:
- DeepSeek commits inspected: `15faf80`, `af684e3`, `e4c4d33`, `3ca2e05`.
- Product source changed by DeepSeek, not by Codex in this review.
- Codex only updated planning/handoff notes.

Accepted:
- Phase 2B.48 `src/desktop/tray/desktop-permission-handler.mjs` is a focused Electron-main helper with explicit dependency injection.
- The permission handler is installed before window creation, preserving the previous Web Speech/media permission behavior surface.
- Phase 2B.47 now returns `writeDesktopGuiSmokeResult` from `createDesktopGuiSmokeRunner(...)`, so the previous dangling outer failure-path symbol has been addressed.
- Commit `3ca2e05` moved the `LINGXY_ELECTRON_GUI_SMOKE` `setTimeout(() => runDesktopGuiSmoke(), 250)` registration after `createDesktopGuiSmokeRunner(...)`, resolving the temporal-dead-zone startup-order risk in product code.

Required follow-up before Phase 2B closure:
- Strengthen `scripts/verify-desktop-gui-perf-smoke.mjs` or `scripts/verify-main-process-blocking.mjs` so it asserts the invariant DeepSeek just fixed: `createDesktopGuiSmokeRunner(...)` must appear before the GUI smoke `setTimeout` registration in `electron-main.mjs`.
- Keep the existing reverse checks that `electron-main.mjs` does not redefine internal smoke helpers and that the outer failure path still emits `LINGXY_GUI_SMOKE_RESULT`.
- This is now a verifier/documentation blocker, not a product-source blocker. No additional runtime behavior change is required for this specific issue.

Codex verification on 2026-05-10:
- `node --check src/desktop/tray/electron-main.mjs`: passed.
- `node --check src/desktop/tray/desktop-gui-smoke-runner.mjs`: passed.
- `node --check src/desktop/tray/desktop-permission-handler.mjs`: passed.
- `node scripts/verify-desktop-renderer.mjs`: passed.
- `node scripts/verify-desktop-gui-perf-smoke.mjs`: passed.
- `node scripts/verify-main-process-blocking.mjs`: passed.
- `node scripts/verify-ipc-contract-inventory.mjs`: passed.
- `node scripts/verify-desktop-shell.mjs`: passed.
- `node scripts/verify-user-interaction-smoke.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `npm run check:fast`: passed 65/65.
- `npm run verify:desktop-gui-smoke`: passed 44/44.

## Codex Review: 2B.47 Scheduling Fix (`3ca2e05`)

Accepted:
- The GUI smoke timer is now registered after the runner factory call, so both `runDesktopGuiSmoke` and `writeDesktopGuiSmokeResult` are initialized before the 250ms timer can fire.
- The fix preserves the existing smoke check names, stdout prefix, failure payload shape, IPC surface, HTTP routes, tool ids, artifact kinds, provider ids, and storage schema.
- Verification passed after the fix: `npm run check:fast` 65/65 and `npm run verify:desktop-gui-smoke` 44/44.

Remaining review note:
- DeepSeek did not update a verifier to lock the exact ordering. Phase 2B.49 should add that guard before marking Electron main decomposition complete.

## Deferred

- `app.on("activate")` / `app.on("before-quit")` handlers remain in electron-main.mjs — they touch too many internal states to extract cleanly without disproportionate ceremony
- Recurring tray badge / morning digest timers (6 lines) — extraction ceremony outweighs benefit

## Codex Review: Phase 2C Completion Claim

Review date: 2026-05-10.

Conclusion:
- Phase 2C's main renderer-boundary goal is effectively achieved in code: executable renderer `fetch(` references are locked at 0, and direct `window.ucaShell` references are down to the 6 dedicated shell client modules.
- Do not start Phase 2D product source moves yet. There is one stale verifier issue that must be fixed first.

Blocking cleanup before 2D source work:
- `node scripts/verify-audio-entrypoints.mjs` fails with `main process missing audio bridge: setPermissionRequestHandler`.
- Root cause: the verifier still scans only `electron-main.mjs` / `desktop-window-actions.mjs` for permission-handler text, but Phase 2B moved that code to `src/desktop/tray/desktop-permission-handler.mjs`.
- Fix the verifier to scan the current owner set, then rerun the audio verifier, renderer direct-runtime verifier, `check:fast`, and GUI smoke.

2D direction after cleanup:
- Open Phase 2D with `2D.0` inventory/verifier work only.
- The next framework target is `src/service/action_tools/tools/index.mjs`, but do not immediately move tool families.
- First lock tool id order, confirmation-gated ids, external aggregation, and old-owner text assertions.

## Codex Review: 2C Closure + 2D.0 Inventory

Review date: 2026-05-10.

DeepSeek commits reviewed:
- `1c5274c` — adds `desktop-permission-handler.mjs` to `verify-audio-entrypoints.mjs`.
- `28fa31c` — documents Phase 2D.0 tool registry family inventory and strengthens `verify-tool-registry-snapshot.mjs`.

Accepted:
- `verify-audio-entrypoints.mjs` now scans the current permission-handler owner, so the old owner text assertion is fixed.
- Phase 2D.0 did not move product tool source. It only changed docs/verifier, which matches the required inventory-first discipline.
- `verify-tool-registry-snapshot.mjs` now locks the actual 61-tool `BUILTIN_ACTION_TOOLS` count, frozen order, duplicate-id guard, and confirmation-gated ids.

Codex cleanup:
- Corrected stale `64 ids` text to `61 ids` in `docs/architecture/tool-registry-inventory.md` and `linxi_codebase_reorganization_execution_plan.md`.

Verification rerun by Codex:
- `node scripts/verify-audio-entrypoints.mjs`: passed.
- `node scripts/verify-tool-registry-snapshot.mjs`: passed.
- `node scripts/verify-action-tools.mjs`: passed.
- `node scripts/verify-artifact-surface-snapshot.mjs`: passed.
- `node scripts/verify-renderer-direct-runtime-calls.mjs`: passed.
- `node scripts/verify-desktop-renderer.mjs`: passed.
- `node scripts/verify-desktop-gui-perf-smoke.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `npm run check:fast`: passed 65/65.
- `npm run verify:desktop-gui-smoke`: passed 44/44.

Next allowed step:
- Phase 2D.1 may start, but only the low-risk browser/web/search/translation family should move first.
- Do not move `write_file`, `edit_file`, `run_script`, `generate_document`, `register_artifact`, GUI automation, or capability creator tools in the first extraction.

## Codex Review: Phase 2D.1 Browser/Web Tool Extraction

Review date: 2026-05-10.

DeepSeek commit reviewed:
- `907dd00` — extracts browser/web/search/translation tools from `src/service/action_tools/tools/index.mjs`.

Accepted:
- The intended 2D.1 product move is scoped to the approved family: `OPEN_URL_TOOL`, `WEB_SEARCH_TOOL`, `WEB_SEARCH_FETCH_TOOL`, `FETCH_URL_CONTENT_TOOL`, and `TRANSLATE_TEXT_TOOL`.
- High-risk tools such as `write_file`, `edit_file`, `run_script`, `generate_document`, `register_artifact`, GUI automation, and capability creator remain in `tools/index.mjs`.
- `BUILTIN_ACTION_TOOLS` id order/count and confirmation-gated tool list remain stable.

Blocker before Phase 2D.2:
- `openWithDefaultHandler` now has two implementations: one local copy in `src/service/action_tools/tools/browser-web-tools.mjs` and one exported implementation in `src/service/action_tools/tools/open-with-default-handler.mjs`.
- This violates the one-owner rule and creates drift risk. The new browser/web module should import the shared helper instead of redefining it, or the shared helper module should be removed if it is not the intended owner.
- Add/strengthen verifier coverage so 2D.1 cannot be marked complete while duplicated helper implementations exist.

Verification rerun by Codex:
- `node --check src/service/action_tools/tools/browser-web-tools.mjs`: passed.
- `node --check src/service/action_tools/tools/open-with-default-handler.mjs`: passed.
- `node --check src/service/action_tools/tools/index.mjs`: passed.
- `node scripts/verify-tool-registry-snapshot.mjs`: passed.
- `node scripts/verify-action-tools.mjs`: passed.
- `node scripts/verify-web-search-link-contract.mjs`: passed.
- `node scripts/verify-open-url-surface-gating.mjs`: passed.
- `npm run check:fast`: passed 65/65.
- `npm run verify:desktop-gui-smoke`: passed 44/44.

Decision:
- Do not start 2D.2 until the duplicate `openWithDefaultHandler` ownership is resolved and locked by verifier.

## Codex Direction: Capability Directory Architecture

Review date: 2026-05-10.

The target architecture has been added to `linxi_codebase_reorganization_execution_plan.md` under `Phase 2D.X — Long-term capability directory architecture`.

Important direction:
- Tools, skills, MCP, connectors, providers, and code-cli adapters should eventually live under a clean `src/service/capabilities/**` source layout.
- Built-in source capabilities belong in source directories; user-installed skills/MCP/tools/connectors must live under runtime data paths, not under `src/`.
- Legacy paths such as `src/service/action_tools/**`, `src/service/ai/skills/**`, `src/service/ai/mcp/**`, and the former service-root connector owner may become compatibility barrels during migration, but they must not contain parallel implementations after the new owner is verified.

Do not jump directly into the full `src/service/capabilities/**` migration yet.

Immediate order:
- First fix the Phase 2D.1 duplicate `openWithDefaultHandler` ownership.
- Continue Phase 2D family extraction under the current `action_tools` layout.
- Start a later `CAP-0` phase for docs/verifier-only capability directory inventory before any broad source moves.

## Codex Direction: Whole-Repository Cleanliness

Review date: 2026-05-10.

The plan now also includes `Phase 2D.Y — Whole-repository directory architecture and cleanliness standard`.

Scope:
- This applies to all code and files, not only tools/skills/MCP.
- Future cleanup must cover desktop app code, service runtime, shared contracts, workers, scripts, tests, docs, assets/generated files, config, and native host boundaries.

Target direction:
- Long term, the repo should move toward `apps/` + `packages/` style ownership:
  - `apps/desktop/**`
  - `apps/native-host/**`
  - `packages/service/**`
  - `packages/shared/**`
  - grouped `scripts/**`, `tests/**`, `docs/**`, `assets/**`, `config/**`
- This is a target architecture, not permission to do a cosmetic root-directory reshuffle now.

Execution order:
- Keep current immediate blocker first: fix duplicate `openWithDefaultHandler` ownership.
- Continue current Phase 2D tool-family extraction.
- Add `CAP-0` and `REPO-0` docs/verifier-only inventory phases before broad physical moves.
- Every later directory migration must have owner docs, compatibility barrels if needed, cleanup verifiers, and no stale old-owner assertions.

## Codex Review: 2D.1 Fix + 2D.2 OS/App File Tools

Review date: 2026-05-10.

DeepSeek commits reviewed:
- `7c6ed09` — removes duplicate `openWithDefaultHandler` from `browser-web-tools.mjs`.
- `06d55cf` — extracts `OPEN_FILE_TOOL`, `REVEAL_IN_EXPLORER_TOOL`, and `FILE_OP_TOOL` into `src/service/action_tools/tools/os-app-tools.mjs`.

Accepted:
- The 2D.1 blocker is fixed in product code: `openWithDefaultHandler` now has one function owner at `src/service/action_tools/tools/open-with-default-handler.mjs`.
- Browser/web tools and OS/app file tools both import the shared helper instead of carrying separate copies.
- The 2D.2 product move is behavior-light and keeps tool ids, registry count/order, confirmation gating, and runtime behavior stable.

Scope correction:
- Treat `06d55cf` as `Phase 2D.2a`, not full 2D.2 completion.
- Remaining OS/clipboard/notification tools still in `tools/index.mjs` include `COPY_TO_CLIPBOARD_TOOL`, `READ_CLIPBOARD_TOOL`, `NOTIFY_TOOL`, and `TAKE_SCREENSHOT_TOOL`.
- Keep `LAUNCH_APP_TOOL` deferred for now because its Windows/Python launcher path and GUI expectations are higher risk.
- `FILE_OP_TOOL` was moved even though the first 2D.2 outline focused on open/reveal/clipboard/notify. This is acceptable because it is simple and passed verification, but later file-write extraction must account for its new owner.

Verifier gap before 2D.3:
- `scripts/verify-tool-registry-snapshot.mjs` still locks ids/count/order but does not yet enforce source ownership.
- Before marking 2D.2 complete or starting 2D.3, add reverse owner assertions that:
  - only `open-with-default-handler.mjs` defines `function openWithDefaultHandler`;
  - `browser-web-tools.mjs` and `os-app-tools.mjs` import that shared helper;
  - `tools/index.mjs` no longer defines extracted browser/web or OS/app file tool bodies except imports and `BUILTIN_ACTION_TOOLS` aggregation.

Verification rerun by Codex:
- `node --check src/service/action_tools/tools/os-app-tools.mjs`: passed.
- `node --check src/service/action_tools/tools/browser-web-tools.mjs`: passed.
- `node --check src/service/action_tools/tools/index.mjs`: passed.
- `node --check src/service/action_tools/tools/open-with-default-handler.mjs`: passed.
- `node scripts/verify-tool-registry-snapshot.mjs`: passed.
- `node scripts/verify-action-tools.mjs`: passed.
- `node scripts/verify-open-url-surface-gating.mjs`: passed.
- `node scripts/verify-web-search-link-contract.mjs`: passed.
- `node scripts/verify-artifact-surface-snapshot.mjs`: passed.
- `node scripts/verify-user-interaction-smoke.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `npm run check:fast`: passed 65/65, behavior tests 986/986.
- `npm run verify:desktop-gui-smoke`: passed 44/44.

Decision:
- Do not open Phase 2D.3 yet.
- Next DeepSeek step should be `2D.2b`: add source-owner verifier assertions and finish the remaining low/medium-risk OS/clipboard/notification extraction, or explicitly split the plan so 2D.2a is closed and 2D.2b is the blocking follow-up.

## Codex Review: 2D.2b + 2D.3 Scheduler Extraction

Review date: 2026-05-10.

DeepSeek commits reviewed:
- `6c886af` — extracts `COPY_TO_CLIPBOARD_TOOL` and `NOTIFY_TOOL` into `src/service/action_tools/tools/os-app-tools.mjs`.
- `bc98971` — extracts scheduler tools into `src/service/action_tools/tools/scheduler-tools.mjs`.

Accepted behavior:
- Tool ids, `BUILTIN_ACTION_TOOLS` order/count, confirmation-gated ids, and action-tool smoke checks remain stable.
- Scheduler behavior appears preserved: create/list/delete/pause moved together with `getSchedulerRuntime`, and the scheduled-fire anti-reschedule guard stayed with `CREATE_SCHEDULED_TASK_TOOL`.
- `COPY_TO_CLIPBOARD_TOOL` and `NOTIFY_TOOL` now live with the OS/app file tools, which is directionally correct for the current `action_tools` layout.

Process issue:
- The previous Codex review required source-owner verifier assertions before opening 2D.3. DeepSeek did not update `scripts/verify-tool-registry-snapshot.mjs` or add a focused owner verifier in `6c886af`.
- 2D.3 therefore ran with behavior verification but without the requested old-owner regression guard.

Scope correction:
- Do not claim full 2D.2 completion yet. `READ_CLIPBOARD_TOOL` remains a `NOOP_TOOLS` reference in `index.mjs`, and `TAKE_SCREENSHOT_TOOL` still remains in `index.mjs`.
- Do not claim Phase 2D ownership cleanup complete. `scripts/verify-tool-registry-snapshot.mjs` still checks registry ids/count/order and family headings, but it does not enforce extracted-source ownership.

Required before Phase 2D.4:
- Add verifier assertions for extracted owners:
  - `browser-web-tools.mjs` owns browser/web/search/translation tool bodies.
  - `os-app-tools.mjs` owns `OPEN_FILE_TOOL`, `REVEAL_IN_EXPLORER_TOOL`, `FILE_OP_TOOL`, `COPY_TO_CLIPBOARD_TOOL`, and `NOTIFY_TOOL`.
  - `scheduler-tools.mjs` owns scheduler tool bodies and `getSchedulerRuntime`.
  - `tools/index.mjs` only imports those extracted owners and aggregates them in `BUILTIN_ACTION_TOOLS`.
  - only `open-with-default-handler.mjs` defines `function openWithDefaultHandler`.
- Update `docs/architecture/tool-registry-inventory.md` to reflect the current owner files after 2D.2b and 2D.3.
- Keep `LAUNCH_APP_TOOL`, `READ_CLIPBOARD_TOOL`, and `TAKE_SCREENSHOT_TOOL` explicitly deferred with named reasons if they are not moved in the next cleanup.

Verification rerun by Codex:
- `node --check src/service/action_tools/tools/os-app-tools.mjs`: passed.
- `node --check src/service/action_tools/tools/scheduler-tools.mjs`: passed.
- `node --check src/service/action_tools/tools/index.mjs`: passed.
- `node scripts/verify-tool-registry-snapshot.mjs`: passed.
- `node scripts/verify-action-tools.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `node scripts/verify-user-interaction-smoke.mjs`: passed.
- `node scripts/verify-artifact-surface-snapshot.mjs`: passed.
- `npm run check:fast`: passed 65/65, behavior tests 986/986.
- `npm run verify:desktop-gui-smoke`: passed 44/44.

Decision:
- Current product behavior is acceptable.
- Do not proceed to Phase 2D.4 yet.
- Next step must be a verifier/inventory cleanup phase for 2D extracted owner boundaries, then rerun `check:fast` and desktop GUI smoke.

## Codex Review: 2D Owner Verifier + 2D.4 Stat/Verify Slice

Review date: 2026-05-10.

DeepSeek commits reviewed:
- `9d4c67b` — adds source-owner assertions to `scripts/verify-tool-registry-snapshot.mjs` and updates `docs/architecture/tool-registry-inventory.md`.
- `cc14717` — extracts `STAT_FILE_TOOL` and `VERIFY_FILE_EXISTS_TOOL` into `src/service/action_tools/tools/file-read-tools.mjs`.

Accepted:
- DeepSeek did add the missing owner verifier before the 2D.4 product move.
- The verifier now locks current extracted owners for browser/web, OS/app, scheduler, file stat/verify, and the shared open handler.
- The 2D.4 source move is a reasonable narrow first slice: `stat_file` and `verify_file_exists` are self-contained, low-risk file-read tools.
- Direct source search confirms these moved tool bodies are currently only exported from `file-read-tools.mjs`.

Issues to fix before continuing 2D.4:
- `docs/architecture/tool-registry-inventory.md` now has an internal inconsistency: it adds `File Stat / Verify` as an extracted family but the inline `File Discovery / Read / Index` row still lists `stat_file` and `verify_file_exists`.
- `npm run check:fast` did not produce a stable clean run during Codex review. Two full runs failed at `node scripts/verify-behavior-tests.mjs` with `# pass 985 / # fail 1`; direct reruns of `node scripts/verify-behavior-tests.mjs` passed `986/986`, so this may be intermittent, but it is still a release-gate blocker until reproduced cleanly or explained.

Verifier improvement still recommended:
- The new source-owner assertions are useful, but they mostly check named owner files and `index.mjs`. A future hardening pass should scan the full `src/service/action_tools/tools/**` tree for duplicate extracted tool body definitions, not only the expected old and new files.

Verification rerun by Codex:
- `node --check src/service/action_tools/tools/file-read-tools.mjs`: passed.
- `node --check src/service/action_tools/tools/index.mjs`: passed.
- `node --check scripts/verify-tool-registry-snapshot.mjs`: passed.
- `node scripts/verify-tool-registry-snapshot.mjs`: passed.
- `node scripts/verify-action-tools.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `node scripts/verify-artifact-surface-snapshot.mjs`: passed.
- `npm run verify:desktop-gui-smoke`: passed 44/44.
- `node scripts/verify-behavior-tests.mjs`: passed 986/986 when run directly after the failed `check:fast` runs.
- `npm run check:fast`: failed twice at behavior-test aggregation with `# pass 985 / # fail 1`.

Decision:
- Do not continue deeper into 2D.4 yet.
- Next step should fix the inventory inconsistency and obtain a stable `npm run check:fast` pass. If the behavior failure is intermittent, capture the exact failing subtest before proceeding.

## Codex Review: 2D.4 Inventory Fix + Compose Email Extraction

Review date: 2026-05-10.

DeepSeek commits reviewed:
- `e65b668` — removes `stat_file` and `verify_file_exists` from the inline File Discovery / Read / Index inventory row.
- `7809e85` — moves `COMPOSE_EMAIL_TOOL` into `src/service/action_tools/tools/os-app-tools.mjs`.

Accepted:
- The 2D.4a inventory inconsistency called out in the previous Codex review is fixed.
- The previous unstable `check:fast` gate is now clean on rerun.
- `COMPOSE_EMAIL_TOOL` behavior appears preserved: it still builds a `mailto:` URL and uses the shared `openWithDefaultHandler`.
- Tool ids, count/order, confirmation-gated ids, behavior tests, and desktop GUI smoke are stable.

Architecture issue:
- Do not treat `COMPOSE_EMAIL_TOOL` living in `os-app-tools.mjs` as the final architecture.
- The reason for the move was helper reuse, but owner boundaries should follow domain responsibility, not only shared helper dependency.
- `compose_email` is an email-family tool. It should move to a dedicated `src/service/action_tools/tools/email-tools.mjs` owner, or the plan should explicitly define a temporary compatibility reason and a near-term cleanup.
- `scripts/verify-tool-registry-snapshot.mjs` currently accepts `COMPOSE_EMAIL_TOOL` as owned by `os-app-tools.mjs`; that assertion should be revised when the email owner is corrected.

Verifier issue:
- The verifier's inventory family check is too loose: it only checks that the word `Email` appears somewhere in the doc. After `7809e85`, the dedicated inline Email family row was removed, but the verifier still passes because `Email` appears in other text.
- Strengthen the doc assertion to validate actual ownership rows or explicit family table entries, not broad substring presence.

Required before more 2D moves:
- Add a narrow cleanup step: create/verify an email owner module or document `COMPOSE_EMAIL_TOOL` in `os-app-tools.mjs` as temporary only.
- Update the source-owner verifier so email ownership is domain-correct.
- Do not continue broad file-read extraction or high-risk 2D.5 work until this ownership mismatch is addressed.

Verification rerun by Codex:
- `node --check src/service/action_tools/tools/os-app-tools.mjs`: passed.
- `node --check src/service/action_tools/tools/index.mjs`: passed.
- `node --check scripts/verify-tool-registry-snapshot.mjs`: passed.
- `node scripts/verify-tool-registry-snapshot.mjs`: passed.
- `node scripts/verify-action-tools.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `node scripts/verify-behavior-tests.mjs`: passed 986/986.
- `npm run check:fast`: passed 65/65.
- `npm run verify:desktop-gui-smoke`: passed 44/44.

Decision:
- Product behavior is acceptable.
- Current structure is not acceptable as a final owner boundary because email logic is now mixed into the OS/app module.
- Next step should be an email owner cleanup and verifier tightening, not another broad tool-family extraction.

## Codex Review: Email Owner Fix + File Discovery Slice

Review date: 2026-05-10.

DeepSeek commits reviewed:
- `5e2f53c` — moves `COMPOSE_EMAIL_TOOL` from `os-app-tools.mjs` to dedicated `email-tools.mjs`.
- `a343192` — extracts manifest/path helpers to `file-manifest-helpers.mjs`.
- `f967ee1` — moves `LIST_FILES_TOOL`, `GLOB_FILES_TOOL`, `FIND_RECENT_FILES_TOOL`, and `GET_LATEST_ARTIFACT_TOOL` into `file-read-tools.mjs`.

Accepted:
- The previous email ownership issue is fixed: `compose_email` now has a domain-correct owner in `email-tools.mjs`.
- `SEND_EMAIL_SMTP_TOOL` remains explicitly deferred in `index.mjs` because it still depends on the `NOOP_TOOLS` path.
- The file discovery move is a reasonable next slice. It moves read/enumeration/artifact-lookup tools, not write/edit/generate/register behavior.
- `file-manifest-helpers.mjs` gives shared helpers a single owner and avoids copying `resolveDefaultOutputDir`, `readManifest`, `writeManifest`, or `globToRegex`.
- Owner verifier assertions now cover email and the moved file discovery tools.

Cleanup notes before the next move:
- `file-manifest-helpers.mjs` is shared by both read-side discovery and still-inline artifact registration / output resolution paths. Do not let this become a vague dumping ground; if artifact write tools move later, split helper ownership by read manifest vs artifact write/output concerns if needed.
- `index.mjs` currently imports `file-manifest-helpers.mjs` near the file tool section instead of with the other imports. Node accepts this, but future cleanup should keep static imports grouped at the top for readability and predictable ownership scanning.
- The inventory still says Phase 2D.6 moved "4 of 10 tools" while the extracted file-read owner now contains six tools total including the earlier `stat_file` and `verify_file_exists`. This is understandable as a phase-slice count, but later inventory should avoid ambiguous counts.
- The verifier still mostly checks expected files rather than scanning all `tools/**` for duplicate extracted exports. Keep full-tree duplicate-owner scanning on the hardening list.

Verification rerun by Codex:
- `node --check src/service/action_tools/tools/index.mjs`: passed.
- `node --check src/service/action_tools/tools/file-read-tools.mjs`: passed.
- `node --check src/service/action_tools/tools/file-manifest-helpers.mjs`: passed.
- `node --check src/service/action_tools/tools/email-tools.mjs`: passed.
- `node --check scripts/verify-tool-registry-snapshot.mjs`: passed.
- `node scripts/verify-tool-registry-snapshot.mjs`: passed.
- `node scripts/verify-action-tools.mjs`: passed.
- `node scripts/verify-artifact-surface-snapshot.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `npm run check:fast`: passed 65/65.
- `npm run verify:desktop-gui-smoke`: passed 44/44.

Decision:
- Product behavior and current verifier gates are acceptable.
- The next extraction may continue inside the file-read/index family, but do not move `REGISTER_ARTIFACT_TOOL`, `RESOLVE_OUTPUT_PATH_TOOL`, `INDEX_FILE_CONTENT_TOOL`, or artifact-producing/write tools until their artifact/source invariants are separately locked.
- Prefer the next narrow slice to be read-only text/search helpers with targeted tests for file-read evidence coverage.

## Codex Review: 2D Cleanup and 2E Readiness

Review date: 2026-05-10.

DeepSeek commit reviewed:
- `a209cd0` — moves the `file-manifest-helpers.mjs` static import to the top import block in `src/service/action_tools/tools/index.mjs`.

Accepted:
- The import cleanup addresses the previous readability / ownership-scanning note.
- No new tool ids, IPC channels, artifact kinds, storage schema, or runtime behavior changed in this commit.
- Phase 2D low-risk decomposition is now in a reasonable checkpoint state: browser/web, OS/app low-risk tools, scheduler, compose email, file stat/verify, and file discovery tools have owners and verifier coverage.

Remaining 2D high-risk surfaces:
- `WRITE_FILE_TOOL`, `EDIT_FILE_TOOL`, `RUN_SCRIPT_TOOL`, `GENERATE_DOCUMENT_TOOL`, `RENDER_DIAGRAM_TOOL`, `RENDER_SVG_TOOL`.
- `READ_FILE_TEXT_TOOL`, `READ_FOLDER_TEXT_TOOL`, `SEARCH_FILE_CONTENT_TOOL`, `INDEX_FILE_CONTENT_TOOL`.
- `REGISTER_ARTIFACT_TOOL`, `RESOLVE_OUTPUT_PATH_TOOL`.
- `GUI_FIND_ELEMENT_TOOL`, `GUI_CLICK_TOOL`, `GUI_TYPE_TEXT_TOOL`.
- `DRAFT_CAPABILITY_TOOL`, `SAVE_CAPABILITY_DRAFT_TOOL`.
- Deferred `LAUNCH_APP_TOOL`, `TAKE_SCREENSHOT_TOOL`, `READ_CLIPBOARD_TOOL`, and `SEND_EMAIL_SMTP_TOOL`.

2E readiness decision:
- Yes, Phase 2E may start, but only as `2E.0 / 2E.1` artifact boundary inventory and service-owned helper consolidation.
- Do not continue mechanical 2D extraction of artifact-producing/write tools before 2E locks artifact kind/path/source/registration invariants.
- Do not rewrite document generation internals in the first 2E pass.
- Do not change artifact ids, artifact paths, preview URLs, final-answer links, lineage behavior, or artifact manifest schema.

Recommended next DeepSeek task:
- Start `Phase 2E.0` with docs/verifier-only inventory if not already current:
  - map artifact kind inference, path inference, registration, preview/open/reveal, lineage, transform, fallback, and extract call sites;
  - add or strengthen verifier coverage for artifact boundary call sites.
- Then start `Phase 2E.1`:
  - create service-owned artifact boundary helpers for kind/path/source inference and registration options;
  - migrate only low-risk duplicated inference call sites;
  - leave generation/rendering/registering behavior intact.

Verification rerun by Codex:
- `node --check src/service/action_tools/tools/index.mjs`: passed.
- `node --check src/service/action_tools/tools/file-read-tools.mjs`: passed.
- `node --check src/service/action_tools/tools/file-manifest-helpers.mjs`: passed.
- `node --check scripts/verify-tool-registry-snapshot.mjs`: passed.
- `node scripts/verify-tool-registry-snapshot.mjs`: passed.
- `node scripts/verify-action-tools.mjs`: passed.
- `node scripts/verify-artifact-surface-snapshot.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `npm run check:fast`: passed 65/65.
- `npm run verify:desktop-gui-smoke`: passed 44/44.

Decision:
- Close Phase 2D as "low-risk decomposition checkpoint complete", not "all tool families extracted".
- Proceed to Phase 2E with strict artifact-boundary scope.

## Codex Review: 2E.0 Inventory + Artifact Path Helper

Review date: 2026-05-10.

DeepSeek commits reviewed:
- `0ee9b72` — adds Phase 2E.0 artifact boundary call-site inventory and verifier sections.
- `64cbf3b` — extracts artifact path helpers to `src/service/core/artifact-path-helper.mjs`.

Accepted:
- `0ee9b72` is directionally correct: it inventories kind inference, path inference, registration, preview/open/reveal, lineage, transform, fallback, and extract call sites.
- The artifact surface verifier now checks that the 2E.0 inventory sections exist.
- Moving path helper ownership into service core is the right 2E.1 target in principle.

Blocker:
- `64cbf3b` is not behavior-preserving. The new `resolveSandboxedTarget` implementation changed security semantics.
- Previous behavior rejected absolute paths outside the output/allowed roots with `path escapes task workspace`.
- New behavior can rewrite an outside absolute path to `path.resolve(outputDir, path.basename(relativePath))` instead of throwing.
- Previous behavior checked symlink components in the parent chain and rejected symlink targets. The new helper removed those `lstat` symlink checks.
- This weakens the artifact/file-write sandbox and violates the "boundary consolidation, no behavior change" rule.

Required fix before continuing 2E:
- Restore exact old `resolveSandboxedTarget` semantics in `artifact-path-helper.mjs`.
- Absolute path inside output/allowed roots must be accepted as-is.
- Absolute path outside all roots must throw.
- `..` segments must throw.
- Parent-chain symlinks must throw.
- Existing target symlinks must throw.
- Add a focused behavior test or verifier that proves those sandbox invariants.

Verification rerun by Codex:
- `node --check src/service/core/artifact-path-helper.mjs`: passed.
- `node --check src/service/action_tools/tools/index.mjs`: passed.
- `node scripts/verify-artifact-surface-snapshot.mjs`: passed.
- `node scripts/verify-tool-registry-snapshot.mjs`: passed.
- `node scripts/verify-action-tools.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `npm run check:fast`: passed 65/65.
- `npm run verify:desktop-gui-smoke`: passed 44/44.

Decision:
- Phase 2E.0 inventory is accepted.
- Phase 2E.1 path helper extraction is blocked until sandbox semantics are restored and test-locked.
- Do not proceed to registration, kind inference, or artifact-producing tool moves yet.

## Codex Review: 2E.1 Sandbox Fix

Review date: 2026-05-10.

DeepSeek commit reviewed:
- `a6304df` — restores exact `resolveSandboxedTarget` sandbox semantics and wires an artifact sandbox invariant verifier into `check:fast`.

Accepted:
- `src/service/core/artifact-path-helper.mjs` now preserves the old sandbox contract from the former tool index implementation.
- Absolute paths inside the output directory or configured allowed roots are accepted as-is.
- Absolute paths outside all roots throw instead of being rewritten through `basename`.
- `..` path segments still throw.
- Parent-chain symlink checks and existing-target symlink checks are restored with `lstat`.
- `scripts/verify-artifact-sandbox-invariants.mjs` is included in the fast check manifest, so future helper edits cannot silently drop the key sandbox text invariants.

Remaining concern:
- The new verifier is mostly source-text/static. Keep it for guardrail coverage, but add a real runtime behavior test in a later 2E slice for relative paths, allowed absolute paths, outside absolute paths, `..`, and symlink/junction cases where the platform supports them.
- One direct behavior-test aggregation run failed before rerun with transient-looking failures in artifact worker cleanup and file-content recall tests. The failing files passed when run directly, and the full `npm run check:fast` rerun passed. Treat this as a test isolation signal to watch, not as a blocker on `a6304df`.

Verification rerun by Codex:
- `node scripts/verify-artifact-sandbox-invariants.mjs`: passed.
- `node scripts/verify-artifact-surface-snapshot.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- Manual artifact sandbox smoke: passed for relative target, inside absolute target, allowed-root absolute target, `..` rejection, outside absolute rejection, and existing regular target.
- `node --check src/service/core/artifact-path-helper.mjs`: passed.
- `node --check scripts/verify-artifact-sandbox-invariants.mjs`: passed.
- `node --check scripts/check-manifest.mjs`: passed.
- `node --test tests/behavior/artifact-extract-background-lane.test.mjs`: passed 5/5.
- `node --test tests/behavior/file-content-recall-allowlist.test.mjs tests/behavior/file-content-recall-entry.test.mjs`: passed 7/7.
- `npm run verify:desktop-gui-smoke`: passed 44/44.
- `npm run check:fast`: passed 66/66 on rerun.

Decision:
- The Phase 2E.1 sandbox blocker from `64cbf3b` is resolved by `a6304df`.
- Phase 2E may continue to the next narrow artifact-boundary slice.
- Do not consolidate registration, kind inference, artifact-producing tools, or document generation internals until the next slice has explicit behavior tests/verifiers for artifact ids, paths, kinds, lineage, preview/open/reveal behavior, and manifest compatibility.

## Codex Review: 2E.2 Registration Invariant Lock

Review date: 2026-05-10.

DeepSeek commit reviewed:
- `7726016` - locks artifact registration invariants in the artifact surface verifier and updates the inventory.

Accepted:
- This commit did not move product source files or change runtime behavior.
- `scripts/verify-artifact-surface-snapshot.mjs` now checks the key registration surfaces:
  - `artifact-store.mjs` still exposes `registerArtifact` and mentions `artifact_id` / `task_id`.
  - `artifact-action-contract.mjs` still exposes `artifactRegistrationOptionsForPath`.
  - `browser-submission.mjs`, `context-submission.mjs`, `file-submission.mjs`, and `image-submission.mjs` still call `registerArtifact` and `appendArtifact`.
  - `browser-submission.mjs` still uses `artifactRegistrationOptionsForPath`.
- The inventory correctly defers a unified registration facade because the current submission call sites have different metadata and event contexts.

Review notes:
- Treat this as "registration invariants locked", not "registration consolidation complete". The inventory wording should keep that distinction clear in future edits.
- The verifier is still mostly source-shape based. It is useful as a drift guard, but it does not prove that registered artifacts preserve ids, task ids, metadata, lineage, preview links, or final answer visibility.
- `context-submission.mjs` also uses `artifactRegistrationOptionsForPath`; a later hardening pass should lock both browser and context metadata-aware registration paths, not only browser.

Verification rerun by Codex:
- `node --check scripts/verify-artifact-surface-snapshot.mjs`: passed.
- `node scripts/verify-artifact-surface-snapshot.mjs`: passed.
- `node scripts/verify-artifact-sandbox-invariants.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `npm run check:fast`: passed 66/66.

Decision:
- Accept `7726016` as a safe Phase 2E.2 guardrail step.
- Phase 2E may continue, but the next registration-related work must be either a behavior test for registration outputs or a very narrow helper extraction with unchanged call semantics.
- Do not introduce a registration facade yet unless the PR proves metadata, event emission, artifact manifest, lineage, and preview/final-answer behavior stay identical.

## Codex Review: 2E.2 Follow-up + 2F.1 Worker Contract Verifier

Review date: 2026-05-10.

DeepSeek commits reviewed:
- `c30795f` - extends the artifact surface verifier to lock `context-submission.mjs` metadata-aware registration.
- `24ff945` - adds `scripts/verify-artifact-extract-worker.mjs` and wires it into full and fast checks.

Accepted:
- `c30795f` correctly addresses the previous Codex review note: both browser and context submission paths now must keep `artifactRegistrationOptionsForPath`.
- `24ff945` does not create or move worker product code. It locks the already-existing artifact extract worker/background lane surface.
- The new worker verifier checks the current worker entry point, abort protocol, structured result shape, supported kind declaration, progress callback, background lane factory, timeout/concurrency controls, failure storage, queue/running state, extract-kind tagging, and behavior-test presence.
- Adding the worker verifier to `check-manifest.mjs` is appropriate because future worker changes should be caught in `check:fast`.

Review notes:
- Treat `24ff945` as a Phase 2F.1 contract verifier foundation, not as a worker migration or deep parser implementation.
- The verifier is still source-shape based. It protects against accidental removal of the lane protocol, but it does not prove parsing quality, worker isolation under load, cancellation race behavior, or main/renderer non-blocking behavior by itself.
- Do not expand worker functionality in the next step without behavior tests for timeout, cancellation, queue fairness, artifact extract persistence, and error surfaces.

Verification rerun by Codex:
- `node --check scripts/verify-artifact-surface-snapshot.mjs`: passed.
- `node scripts/verify-artifact-surface-snapshot.mjs`: passed.
- `node --check scripts/verify-artifact-extract-worker.mjs`: passed.
- `node scripts/verify-artifact-extract-worker.mjs`: passed.
- `node scripts/verify-artifact-extract-background-lane.mjs`: passed.
- `node --test tests/behavior/artifact-extract-background-lane.test.mjs`: passed 5/5.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `npm run check:fast`: passed 67/67.

Decision:
- Accept both commits as guardrail-only progress.
- Phase 2F may begin only as verifier-first worker hardening.
- Do not implement new extraction worker behavior, move parsing logic, or change artifact extract storage until runtime behavior tests cover cancellation, timeout, persistence, and user-visible artifact availability.

## Codex Review: 2G.1 Provider Boundary + Codebase Inventory Update

Review date: 2026-05-10.

DeepSeek commits reviewed:
- `d90497c` - adds provider boundary inventory and `scripts/verify-provider-boundary.mjs`.
- `f94feda` - updates `docs/architecture/codebase-file-inventory.md` for 2B-2G reorganization.

Accepted:
- Both commits are docs/verifier-only and do not change product runtime behavior.
- Adding a provider boundary verifier to `check:fast` is the right direction.
- The provider adapter/resolver owner surfaces are correctly identified as high-risk service/provider boundaries.
- The codebase inventory update correctly records many 2B desktop helper extractions and 2D tool-family extractions.

Blocking review notes:
- Do not mark Phase 2G.1 complete yet. The provider boundary inventory claims the resolver call-site list is complete, but repository search shows additional provider-boundary references outside the 13 documented callers, including:
  - `src/service/core/planning/runnable-executor.mjs`
  - `src/service/core/http-routes/audio-routes.mjs`
  - `src/service/core/http-routes/config-provider-routes.mjs`
  - `src/service/core/intent/semantic-router.mjs`
- `scripts/verify-provider-boundary.mjs` checks that the listed callers use the resolver, but it does not scan all `src/service/**` imports/usages of `resolveProviderForTask`, `resolveActiveProviderForTask`, `createProviderAdapter`, or dynamic provider-resolver imports and fail on undocumented call sites.
- The provider verifier only scans `src/service/executors/**` for direct `messages.create` / `chat.completions.create` calls. Its "No modules bypass provider-adapter" claim is broader than its scan.
- The codebase inventory still says no dedicated `src/service/workers/` directory exists, but `src/service/workers/artifact-extract-worker.mjs` exists and is now verifier-locked.
- The line counts in the inventory are already stale locally: `electron-main.mjs` is 1022 lines and `tools/index.mjs` is 2900 lines at review time, not the committed 1072 / 3049 values. Prefer approximate counts or regenerate them in verifier-backed docs.

Required correction before accepting 2G.1:
- Update `docs/architecture/provider-boundary-plan.md` to include all current provider resolver/adapter call sites or explicitly classify them as allowed exceptions.
- Strengthen `scripts/verify-provider-boundary.mjs` to scan the tree for provider boundary usages and require every usage to be documented/allowlisted.
- Expand direct provider-call scanning beyond `src/service/executors/**`, or narrow the verifier/doc claim to match the actual scan.
- Update `docs/architecture/codebase-file-inventory.md` to reflect `src/service/workers/` and avoid stale exact line-count assertions unless verified.

Verification rerun by Codex:
- `node --check scripts/verify-provider-boundary.mjs`: passed.
- `node scripts/verify-provider-boundary.mjs`: passed, but with the coverage gaps above.
- `node --check scripts/check-manifest.mjs`: passed.
- `node scripts/verify-artifact-extract-worker.mjs`: passed.
- `node scripts/verify-artifact-surface-snapshot.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `npm run check:fast`: passed 68/68.

Decision:
- Accept the direction of `d90497c` and `f94feda`, but do not accept Phase 2G.1 as complete.
- The next DeepSeek step should fix provider inventory/verifier coverage and inventory freshness before starting provider resolver caching or provider-boundary refactors.

## Codex Review: 2G.1 Provider Boundary Coverage Fix

Review date: 2026-05-10.

DeepSeek commit reviewed:
- `033a154` - completes provider boundary inventory/verifier coverage and updates the worker inventory entry.

Accepted:
- This is still docs/verifier-only; it does not change provider runtime behavior.
- The provider verifier now scans all `src/service/**` files for `resolveProviderForTask` / `provider-resolver` references and fails on undocumented callers.
- Direct provider-call scanning now covers all `src/service/**` instead of only `src/service/executors/**`.
- The previously missing provider-boundary references are now explicitly included: runnable executor, audio routes, config provider routes, intent semantic router, and embeddings semantic routing.
- `docs/architecture/codebase-file-inventory.md` now acknowledges `src/service/workers/artifact-extract-worker.mjs` instead of saying there is no worker directory.

Remaining review notes:
- The provider boundary plan still has wording drift: it says `src/service/embeddings/semantic.mjs` is the only module outside the executor/submission pipeline, but the same document now also allows `src/service/core/intent/semantic-router.mjs`. Update that prose so the exception list is internally consistent.
- `src/service/extractors/file-ingest.mjs` is documented as a resolver call site, but the current match is only a comment reference. Either remove that comment from the enforced caller set or classify it separately as a non-call textual reference.
- The provider adapter call-site table still lists only four callers, while `src/service/core/intent/semantic-router.mjs` dynamically imports and calls `createProviderAdapter`. The verifier should add a tree scan for `createProviderAdapter` / `provider-adapter` usages, mirroring the resolver scan.
- `docs/architecture/codebase-file-inventory.md` still contains stale exact line-count text for `src/service/action_tools/tools/index.mjs` (`4105 -> 3049`) even though the current file is 2900 lines at review time. Prefer approximate or generated counts.

Verification rerun by Codex:
- `node --check scripts/verify-provider-boundary.mjs`: passed.
- `node scripts/verify-provider-boundary.mjs`: passed.
- `node --check scripts/check-manifest.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- Direct `node scripts/verify-behavior-tests.mjs`: passed 986/986 after an initial `check:fast` behavior aggregation failure.
- `npm run check:fast`: passed 68/68 on rerun.

Decision:
- Accept `033a154` as resolving the main Phase 2G.1 blocker from the previous review.
- Phase 2G may proceed to the next narrow verifier-first provider step, but do not implement provider resolver caching until the adapter call-site scan and provider-boundary prose drift are cleaned up.
- Treat the one failed `check:fast` behavior aggregation run as a test stability signal to keep watching; the direct behavior suite and rerun fast gate both passed.

## Codex Review: 2G.1 Cleanup + 2G.2 Hot-Reload Contract

Review date: 2026-05-10.

DeepSeek commits reviewed:
- `b54088f` - adds provider-adapter tree scan, excludes comment-only provider-resolver references, and softens stale exact inventory line counts.
- `62d7970` - documents and verifier-locks the provider resolver hot-reload contract.

Accepted:
- Both commits are verifier/docs focused and do not change provider routing behavior or provider ids.
- `b54088f` improves the provider boundary verifier by scanning all `src/service/**` for `createProviderAdapter` / `provider-adapter` usages, mirroring the resolver scan.
- `b54088f` correctly treats `src/service/extractors/file-ingest.mjs` as comment-only, not a runtime resolver caller.
- `b54088f` replaces stale exact line counts in the codebase inventory with approximate counts.
- `62d7970` correctly frames the current provider resolver disk read as an intentional hot-reload contract, not accidental overhead. This blocks premature provider-config caching that would make Settings changes require a service restart.

Remaining review notes:
- `docs/architecture/provider-boundary-plan.md` still has an inventory mismatch: the adapter call-site table lists only four callers and says `~4`, but `src/service/core/intent/semantic-router.mjs` is now an approved dynamic adapter caller in the verifier. Update the table/count so docs and verifier agree.
- The provider boundary plan still lists `src/service/extractors/file-ingest.mjs` in the call-site table as "Static (comment reference)". Since it is intentionally comment-only, move it to a separate non-runtime textual-reference note instead of presenting it as a call site.
- The hot-reload verifier currently checks for source text (`Re-read on every call`, `no in-memory cache`, `readFileSync`) rather than proving behavior. Before any cache/refactor, add a behavior test that changes provider config between two resolver calls and proves the second call sees the new config without process restart.
- `npm run check:fast` is currently unstable in this workspace: it failed twice at `node scripts/verify-behavior-tests.mjs` with `pass 985 / fail 1`, while direct `node scripts/verify-behavior-tests.mjs` passed 986/986. This should be treated as a release-gate stability issue, even though it does not appear caused by these provider verifier commits.

Verification rerun by Codex:
- `node --check scripts/verify-provider-boundary.mjs`: passed.
- `node scripts/verify-provider-boundary.mjs`: passed.
- `node --check scripts/check-manifest.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- Direct `node scripts/verify-behavior-tests.mjs`: passed 986/986.
- `npm run check:fast`: failed twice at behavior aggregation with `pass 985 / fail 1`.

Decision:
- Accept the verifier direction of `b54088f` and `62d7970`.
- Do not proceed to provider resolver caching yet.
- Before the next provider implementation step, fix the provider-boundary-plan adapter table/comment-only call-site wording and investigate or quarantine the unstable `check:fast` behavior aggregation failure so the phase gate is reliably green.

## Codex Review: Provider Doc Cleanup + CAP-0 Capability Inventory

Review date: 2026-05-10.

DeepSeek commits reviewed:
- `67d108e` - fixes provider adapter table and moves `file-ingest.mjs` to comment-only classification.
- `7c0c8e4` - adds CAP-0 capability directory architecture inventory and `scripts/verify-capability-roots.mjs`.

Accepted:
- `67d108e` correctly aligns the provider adapter table with the verifier by adding `src/service/core/intent/semantic-router.mjs` and the provider-adapter self surface.
- `67d108e` correctly removes `src/service/extractors/file-ingest.mjs` from the runtime provider resolver call-site table and classifies it as comment-only.
- `7c0c8e4` is docs/verifier-only and does not move product source files.
- CAP-0 usefully inventories current capability roots and sets the right target direction: built-in source capabilities under a service-owned capability tree, while user-installed capabilities stay in runtime data paths.
- `verify-capability-roots.mjs` is a useful first guard: it checks current capability roots exist, blocks a few obvious user-installed `src/` paths, checks the architecture doc, and verifies extracted tool constants are not redefined in `tools/index.mjs`.

Remaining review notes:
- `docs/architecture/provider-boundary-plan.md` still has a stale prose sentence in "Direct Provider Calls (Exceptions)": it says `src/service/embeddings/semantic.mjs` is the only module using provider resolution outside the executor/submission pipeline. That conflicts with the later approved `src/service/core/intent/semantic-router.mjs` exception. Clean this before declaring provider boundary docs complete.
- CAP-0 must remain inventory-only. Do not start CAP-1/CAP-2 moves until each family has verifier coverage for imports, exports, tool ids, schemas, risk policy, approvals, and old owner text.
- The capability verifier should become stricter before any move: compatibility barrels must be re-export-only, and every migration-complete claim must prove no stale old-owner text assertions remain in docs/verifiers/source comments.
- The "no user-installed capability directories under src" check currently only blocks a small fixed list (`src/user-skills`, `src/user-mcp`, `src/user-tools`, `src/user-connectors`). Before enabling user-added capability families, broaden this to scan for all documented runtime-installed capability roots under `src/`.

Verification rerun by Codex:
- `node --check scripts/verify-provider-boundary.mjs`: passed.
- `node scripts/verify-provider-boundary.mjs`: passed.
- `node --check scripts/verify-capability-roots.mjs`: passed.
- `node scripts/verify-capability-roots.mjs`: passed.
- `node --check scripts/check-manifest.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `npm run check:fast`: passed 69/69.

Decision:
- Accept `67d108e` and `7c0c8e4` as safe docs/verifier progress.
- CAP-0 may be considered started/accepted as inventory, not as a completed capability migration.
- Do not proceed to source moves under `src/service/capabilities/**` until the next CAP verifier proves no old owner text/assertion drift and no parallel legacy/new implementations.

## Codex Review: Required Tool Contract + Artifact Recovery Block

Review date: 2026-05-10.

DeepSeek work reviewed:
- No new commit was present at review time.
- Uncommitted product-source changes were present in:
  - `src/service/core/policy/success-contract-validator.mjs`
  - `src/service/executors/tool_using/agent-loop.mjs`
  - `tests/behavior/agent-loop-sequencing.test.mjs`
- Existing guardrail/doc change was also present in `AGENTS.md`.

Accepted:
- Adding validation for `success_contract.required_tool_names` is directionally correct. It turns tool-specific hard requirements such as `edit_file` into runtime data instead of relying on prompt text.
- The targeted verifier `scripts/verify-success-contract-groups.mjs` covers the new required-tool behavior for `edit_file`.
- `scripts/verify-artifact-recovery-hook.mjs` now proves that `transform_existing_file` does not synthesize a brand-new `generate_document` artifact when `edit_file` was required.
- The AGENTS.md addition is consistent with recent migration failures: each phase must sweep docs/verifiers/scripts for stale owner/path assertions, not rely on `check:fast` alone.

Blocking review notes:
- `src/service/executors/tool_using/agent-loop.mjs` now contains a new local `artifactRecoveryBlockedReason()` helper that repeats policy already represented in `src/service/core/artifact-fallback-policy.mjs`. This is not clean enough for the framework direction. Move or centralize the rule in the shared artifact fallback/action contract layer, then have the agent loop call that policy instead of owning the `transform_existing_file` / `edit_file` decision itself.
- The new recovery reason is named `transform_existing_file_requires_edit_file` even when it is triggered only by `required_tool_names.includes("edit_file")`. Use a reason that accurately reflects the policy source, or keep separate reasons for goal-based and required-tool-based blocks.
- The test regex change in `tests/behavior/agent-loop-sequencing.test.mjs` broadens the assertion from `请选择要打开哪一个|choose which` to `哪一个|which`. This may be harmless, but it weakens the UI/UX contract. Keep the broader assertion only if the finalization wording is intentionally allowed to vary; otherwise restore a stronger assertion around disambiguation wording.
- Because this is behavior-changing product source, do not commit it as a quick patch. Finish the policy centralization and keep the verifier proving the contract.

Verification rerun by Codex:
- `node --check src/service/core/policy/success-contract-validator.mjs`: passed.
- `node --check src/service/executors/tool_using/agent-loop.mjs`: passed.
- `node --check tests/behavior/agent-loop-sequencing.test.mjs`: passed.
- `node tests/behavior/agent-loop-sequencing.test.mjs`: passed 19/19.
- `node scripts/verify-success-contract-groups.mjs`: passed 36/36.
- `node scripts/verify-artifact-recovery-hook.mjs`: passed 46/46.
- `node scripts/verify-artifact-generation-invariant.mjs`: passed 59/59.
- `node scripts/verify-artifact-action-contract.mjs`: passed.
- `node scripts/verify-claim-guard-phase-c.mjs`: passed 19/19.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `node scripts/verify-capability-roots.mjs`: passed.
- `node scripts/verify-behavior-tests.mjs`: passed 986/986 when run directly.
- `npm run check:fast`: failed again at `node scripts/verify-behavior-tests.mjs` with TAP summary `pass 985 / fail 1`.

Decision:
- Do not accept the uncommitted product-source change as complete yet.
- Accept the required-tool contract direction, but require the artifact recovery block to be centralized in the shared artifact policy layer before commit.
- Treat the recurring `check:fast` behavior aggregation failure as a release-gate stability issue. Direct behavior tests passing is useful evidence, but the phase cannot be called fully green while `check:fast` is intermittently red.

## Codex Review: Provider Stale-Claim Cleanup + Workspace Gate

Review date: 2026-05-10.

DeepSeek commit reviewed:
- `1145b0c` - `docs: fix stale "only module" claim in provider-boundary-plan.md`.

Accepted:
- `1145b0c` correctly removes the stale Direct Provider Calls prose that said `src/service/embeddings/semantic.mjs` was the only out-of-pipeline provider-resolution caller.
- The provider boundary plan now consistently names both approved semantic-router exceptions:
  - `src/service/embeddings/semantic.mjs`
  - `src/service/core/intent/semantic-router.mjs`
- This commit is documentation-only and does not change provider ids, provider routing, provider adapter behavior, provider resolver hot-reload behavior, IPC, HTTP routes, tool ids, or storage schema.

Remaining review notes:
- The provider-boundary doc cleanup is accepted, but it does not resolve the uncommitted product-source blocker from the previous review.
- `src/service/executors/tool_using/agent-loop.mjs` still owns `artifactRecoveryBlockedReason()` locally. That rule still needs to move into the shared artifact fallback/action-contract policy layer before the required-tool/artifact-recovery behavior change can be considered complete.
- `tests/behavior/agent-loop-sequencing.test.mjs` still has the weakened launch-disambiguation regex. DeepSeek should either justify the wording flexibility or restore the stronger UX assertion.
- The workspace still has uncommitted product-source behavior changes, so the safe conclusion is split:
  - accept `1145b0c` as a provider-doc cleanup;
  - do not accept the whole working tree as ready.

Verification rerun by Codex:
- `node --check scripts/verify-provider-boundary.mjs`: passed.
- `node scripts/verify-provider-boundary.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `npm run check:fast`: failed again at `node scripts/verify-behavior-tests.mjs` with TAP summary `pass 985 / fail 1`.

Decision:
- Accept `1145b0c`.
- Provider stale prose cleanup is complete for the previously reported "only module" issue.
- Do not mark the current workspace or required-tool/artifact-recovery work complete until the artifact policy centralization is done and the fast gate is stable green or explicitly fixed/quarantined with a documented reason.

## Codex Review: Artifact Recovery Policy Centralization

Review date: 2026-05-10.

DeepSeek commit reviewed:
- `9d31164` - `fix: centralize artifactRecoveryBlockedReason in shared policy layer`.

Accepted:
- The previous architecture blocker is directionally resolved: `artifactRecoveryBlockedReason()` no longer lives inside `src/service/executors/tool_using/agent-loop.mjs`; it is exported from `src/service/core/artifact-fallback-policy.mjs` and the agent loop now calls the shared policy.
- The reason names are more truthful than the previous single `transform_existing_file_requires_edit_file` value:
  - `goal_transform_existing_file_requires_edit_file`
  - `required_tool_edit_file_not_called`
- The strong launch-disambiguation test assertion was restored in source, which is the right direction for preserving UX contract strength.

Blocking review notes:
- The restored strong launch-disambiguation assertion currently fails. `node tests/behavior/agent-loop-sequencing.test.mjs` fails test 17 because the actual Chinese final text says `请你告诉我你想打开的是哪一个...`, not `请选择要打开哪一个...`. DeepSeek must either update the product finalization wording to satisfy the stronger contract or adjust the assertion to a precise stable phrase that the product actually guarantees. Do not leave this as a red test.
- `required_tool_edit_file_not_called` is defined in the shared policy, but no targeted recovery-hook test currently exercises the branch where `goal !== "transform_existing_file"` and `required_tool_names` includes `edit_file`. Add a verifier/test case for that branch before declaring the policy complete.
- The uncommitted `success-contract-validator.mjs` required-tool enforcement remains outside the new commit. That behavior change still needs its own clean commit once the red test and coverage gap are fixed.
- Historical review text in this handoff still records the earlier blocker (`agent-loop.mjs` owned `artifactRecoveryBlockedReason`). The latest status now supersedes that, but before any migration-complete declaration, make sure the current summary/plan does not leave stale owner assertions that look like present-tense truth.

Verification rerun by Codex:
- `node --check src/service/core/artifact-fallback-policy.mjs`: passed.
- `node --check src/service/executors/tool_using/agent-loop.mjs`: passed.
- `node --check scripts/verify-artifact-recovery-hook.mjs`: passed.
- `node scripts/verify-artifact-recovery-hook.mjs`: passed 46/46.
- `node scripts/verify-success-contract-groups.mjs`: passed 36/36.
- `node scripts/verify-artifact-generation-invariant.mjs`: passed 59/59.
- `node scripts/verify-artifact-action-contract.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `node tests/behavior/agent-loop-sequencing.test.mjs`: failed 18/19; launch ambiguity final answer assertion failed.
- `npm run check:fast`: failed at `node scripts/verify-behavior-tests.mjs` with TAP summary `pass 985 / fail 1`.

Decision:
- Accept the policy centralization architecture direction in `9d31164`.
- Do not mark `9d31164` or the required-tool/artifact-recovery work complete while `agent-loop-sequencing` is red.
- Next DeepSeek action should fix the launch disambiguation contract mismatch and add explicit coverage for the `required_tool_edit_file_not_called` recovery-block branch.

## Codex Review: Launch Disambiguation + Required Edit-File Branch

Review date: 2026-05-10.

DeepSeek commit reviewed:
- `144cdf0` - `fix: match actual launch disambiguation text; add edit_file branch test`.

Accepted:
- The previous red behavior test is fixed: `node tests/behavior/agent-loop-sequencing.test.mjs` now passes 19/19.
- `scripts/verify-artifact-recovery-hook.mjs` now includes explicit coverage for the required-tool branch where:
  - `goal !== "transform_existing_file"`;
  - `success_contract.required_tool_names` includes `edit_file`;
  - deterministic recovery does not call `generate_document`;
  - `artifact_recovery.reason` is `required_tool_edit_file_not_called`.
- The broader launch-disambiguation assertion is acceptable in this test because the actual LLM-composed Chinese output varies, while the test still requires a stable disambiguation signal plus both candidate app names and no internal `launch_args`. The stronger exact finalization phrase remains covered in `tests/behavior/agent-loop-finalization.test.mjs`.
- `npm run check:fast` passed 69/69 in this review run, so the previously recurring fast-gate failure did not reproduce this time.

Minor cleanup note:
- The new recovery-hook test's `generateImpl` body references `toolId`, which is not defined in that closure. The test still passes because the correct behavior is that `generateImpl` is never called. Clean this up in a future small verifier hygiene pass so a failure path reports a clean intentional error instead of relying on an incidental `ReferenceError`.

Remaining review notes:
- The uncommitted `src/service/core/policy/success-contract-validator.mjs` change is still a separate behavior-changing product-source edit. It enforces `success_contract.required_tool_names` generally, and should be committed or reviewed as its own clean unit after confirming its verifier coverage is intentional.
- Historical review text in this file still contains older present-tense blocker descriptions for `artifactRecoveryBlockedReason()`. Those are audit history, not current state. Before a migration-complete declaration, add a fresh current-state summary or sweep so no stale owner assertion is mistaken for active truth.

Verification rerun by Codex:
- `node --check tests/behavior/agent-loop-sequencing.test.mjs`: passed.
- `node --check scripts/verify-artifact-recovery-hook.mjs`: passed.
- `node scripts/verify-artifact-recovery-hook.mjs`: passed 49/49.
- `node tests/behavior/agent-loop-sequencing.test.mjs`: passed 19/19.
- `node scripts/verify-success-contract-groups.mjs`: passed 36/36.
- `node scripts/verify-artifact-generation-invariant.mjs`: passed 59/59.
- `node scripts/verify-artifact-action-contract.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `npm run check:fast`: passed 69/69.

Decision:
- Accept `144cdf0`.
- The `9d31164`/`144cdf0` artifact-recovery policy centralization sequence is now acceptable as a complete structural fix for the earlier agent-loop ownership blocker.
- Do not roll the remaining uncommitted required-tool validator change into this conclusion; review and commit it separately.

## Codex Review: Required Tool Validator Commit + Verifier Hygiene

Review date: 2026-05-10.

DeepSeek commits reviewed:
- `8d02914` - `chore: clean up dead toolId reference in recovery-hook verifier`.
- `d16bbae` - `feat: enforce success_contract.required_tool_names in validator`.

Accepted:
- `8d02914` resolves the verifier hygiene note from the previous review. The recovery-hook branch test now throws a clean intentional error if `generate_document` is incorrectly called, instead of referencing an undefined `toolId`.
- `d16bbae` cleanly commits the previously uncommitted required-tool enforcement behavior in `src/service/core/policy/success-contract-validator.mjs`.
- The required-tool validator now treats `success_contract.required_tool_names` as runtime contract data:
  - no matching tool result creates `<tool>_required_not_called`;
  - only failed matching tool results create `<tool>_required_all_failed`;
  - at least one successful matching tool result satisfies the tool-specific requirement.
- This is consistent with the artifact recovery policy: `edit_file` can be required as a hard contract, and deterministic recovery must not paper over a missing required edit.

Review notes:
- This sequence is a real behavior change, but it is framework-level rather than a phrase/task-specific patch. It generalizes across required tool ids.
- The current targeted verifier coverage is strongest for `edit_file`; before using `required_tool_names` for more high-risk tool families, add explicit cases for those families or lock them through their existing action/approval verifiers.
- Historical handoff/plan sections still contain older blocker text saying `agent-loop.mjs` owned `artifactRecoveryBlockedReason()`. That is audit history, not current state. The current source/verifier state has the policy in `src/service/core/artifact-fallback-policy.mjs`.

Verification rerun by Codex:
- `node --check src/service/core/policy/success-contract-validator.mjs`: passed.
- `node --check scripts/verify-success-contract-groups.mjs`: passed.
- `node --check scripts/verify-artifact-recovery-hook.mjs`: passed.
- `node scripts/verify-success-contract-groups.mjs`: passed 36/36.
- `node scripts/verify-artifact-recovery-hook.mjs`: passed 49/49.
- `node tests/behavior/agent-loop-sequencing.test.mjs`: passed 19/19.
- `node scripts/verify-artifact-generation-invariant.mjs`: passed 59/59.
- `node scripts/verify-artifact-action-contract.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `npm run check:fast`: passed 69/69.

Decision:
- Accept `8d02914` and `d16bbae`.
- The required-tool/artifact-recovery work reviewed across `9d31164`, `144cdf0`, `8d02914`, and `d16bbae` is now structurally acceptable and verifier-backed.
- Before declaring a broader phase complete, add or reference a current-state sweep so historical review text is not mistaken for active owner assertions.

## Codex Review: Handoff Header + AGENTS Sweep Rule + REPO-0 Directory Map

Review date: 2026-05-10.

DeepSeek commits reviewed:
- `075fb76` - `docs: update handoff status header to reflect resolved state`.
- `1684d74` - `docs: add migration-phase verifier sweep rule to AGENTS.md`.
- `4b6d896` - `docs: Phase REPO-0 repository directory architecture map`.

Accepted:
- `1684d74` is accepted. The AGENTS.md rule formalizes the migration discipline we need: every phase must sweep docs/verifiers/scripts for moved names, old owner paths, channels, routes, and event strings. This directly supports the current rule: no migration-complete claim without proving stale old-owner assertions are not active truth.
- `4b6d896` is accepted as a useful REPO-0 draft inventory. It adds the current-vs-target repository layout and correctly frames `apps/` + `packages/` as a long-term target rather than an immediate cosmetic reshuffle.
- `075fb76` correctly records that the required-tool/artifact-recovery blocker sequence has been resolved and that `check:fast` is green in the current review run.

Blocking/required cleanup before treating REPO-0 as complete:
- The Phase REPO-0 plan in `linxi_codebase_reorganization_execution_plan.md` explicitly called for `scripts/verify-repository-directory-architecture.mjs`, but `4b6d896` only added the doc. `Test-Path scripts/verify-repository-directory-architecture.mjs` returned `False`. Add the verifier and wire it into the check manifest before marking REPO-0 complete.
- The handoff header says `Phases 2B-2G + CAP-0 Complete`. This is too broad unless the intended meaning is "current checkpoint/inventory layers complete." Phase 2D was explicitly closed as a low-risk checkpoint, not all tool families extracted; CAP-0 is inventory only, not capability migration complete. Tighten this header so it cannot be read as "all deferred high-risk tools/capability moves are done."
- `docs/architecture/repository-directory-architecture.md` current layout omits several current `src/service/**` directories (`audio`, `cost`, `events`, `failures`, `https`, `memory`, `metrics`, `preview`, `retry`, `scheduler`, `templates`, `utils`) and omits the current native host root. Either make the map explicitly "major selected directories" or include the omitted roots so the document remains a reliable current-state inventory.
- The REPO-0 status table says `2D | Tool family extraction complete (7 modules, 21 tools)`. This should be reworded to `2D low-risk checkpoint complete` or equivalent, with high-risk tool families deferred. Do not imply `write_file`, `edit_file`, `run_script`, `generate_document`, GUI automation, or capability creator moves are complete.

Verification rerun by Codex:
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `node scripts/verify-capability-roots.mjs`: passed.
- `node --check scripts/check-manifest.mjs`: passed.
- `node scripts/verify-provider-boundary.mjs`: passed.
- `node scripts/verify-tool-registry-snapshot.mjs`: passed.
- `npm run check:fast`: passed 69/69.
- `Test-Path docs/architecture/repository-directory-architecture.md`: true.
- `Test-Path scripts/verify-repository-directory-architecture.mjs`: false.

Decision:
- Accept `1684d74`.
- Accept `075fb76` only after wording is tightened from broad "Complete" to checkpoint/inventory-complete language.
- Accept `4b6d896` as REPO-0 draft documentation, but do not mark REPO-0 complete until the repository-directory verifier exists and the current-layout/status wording is corrected.

## Codex Review: REPO-0 Verifier Follow-up

Review date: 2026-05-10.

DeepSeek commit reviewed:
- `bba17ab` - `fix: complete REPO-0 with verifier, tighten status wording`.

Accepted:
- The missing repository-directory verifier now exists at `scripts/verify-repository-directory-architecture.mjs`.
- The verifier is wired into `scripts/check-manifest.mjs`, and `npm run check:fast` now runs 70 commands.
- The handoff header is better scoped as `Inventory/Checkpoint Complete`, and the 2D status wording no longer implies all high-risk tool families were extracted.
- `docs/architecture/repository-directory-architecture.md` is improved as a current-vs-target repository map and now calls the current layout a major-directory map rather than a leaf-complete inventory.

Required cleanup before declaring REPO-0 complete:
- The current directory map lists `native-host/`, but the real repository root is `uca-native-host/`. Target architecture may still use `apps/native-host/**`, but current-state documentation must name the real current path.
- The same map still says `scripts/ # Verifiers (69)`, but `npm run check:fast` now reports 70/70. Avoid exact verifier counts in prose unless a verifier locks the number, because this became stale immediately after adding the REPO-0 verifier.
- `scripts/verify-repository-directory-architecture.mjs` is useful but still shallow: it checks broad root directories and target concept strings, but it does not catch the documented `native-host/` mismatch, stale verifier-count text, or whether documented current roots actually exist.
- The top handoff line says all Codex blockers are resolved. Treat that as "previous review blockers resolved"; this review opens a new REPO-0 follow-up blocker until the current-root mismatch and stale count are corrected.

Verification rerun by Codex:
- `node --check scripts/verify-repository-directory-architecture.mjs`: passed.
- `node scripts/verify-repository-directory-architecture.mjs`: passed.
- `node --check scripts/check-manifest.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `node scripts/verify-capability-roots.mjs`: passed.
- `npm run check:fast`: passed 70/70.

Decision:
- Accept `bba17ab` as progress and keep the verifier/check-manifest wiring.
- Do not declare REPO-0 complete yet.
- Next correction should update the current map from `native-host/` to `uca-native-host/`, remove or verify the exact `Verifiers (69)` text, and strengthen `verify-repository-directory-architecture.mjs` so it validates documented current roots instead of only checking a few broad anchors.

## Codex Review: REPO-0 Current Path + Count Cleanup

Review date: 2026-05-10.

DeepSeek commit reviewed:
- `3b753e2` - `fix: correct native-host path, remove stale verifier count, strengthen REPO-0`.

Accepted:
- `docs/architecture/repository-directory-architecture.md` now uses the real current root `uca-native-host/` in the current layout.
- The stale `scripts/ # Verifiers (69)` prose was removed, which avoids a brittle count assertion now that `check:fast` runs 70 commands.
- `scripts/verify-repository-directory-architecture.mjs` now includes `uca-native-host` in documented current roots and checks that the repo architecture doc names the real path.
- No product source behavior was changed.

Remaining review note:
- The REPO-0 verifier is acceptable for this checkpoint, but it is still an anchor-based verifier. It checks the key current roots and target concepts, not every rendered tree entry in the markdown diagram. Before a physical root move phase such as REPO-1, strengthen it to validate the documented current layout more mechanically, or replace the freehand tree with a manifest-driven current-root table.
- The handoff header still contains historical `check:fast 69/69` text. This is no longer a blocker for `3b753e2` because the new REPO-0 doc removed the stale count, but future top-of-file status updates should avoid exact counts unless regenerated from the check runner.

Verification rerun by Codex:
- `node --check scripts/verify-repository-directory-architecture.mjs`: passed.
- `node scripts/verify-repository-directory-architecture.mjs`: passed.
- `node --check scripts/check-manifest.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `node scripts/verify-capability-roots.mjs`: passed.
- `npm run check:fast`: passed 70/70.

Decision:
- Accept `3b753e2`.
- The previous REPO-0 blocker about the fictional current `native-host/` path and stale `Verifiers (69)` prose is resolved.
- REPO-0 may be treated as checkpoint-complete for documentation/verifier inventory purposes, with the caveat that REPO-1 must not begin physical root moves until the repository-directory verifier is made stricter for move-specific contracts.

## Codex Review: REPO-1.0 Desktop Layout Inventory

Review date: 2026-05-10.

DeepSeek commits reviewed:
- `1f046fc` - `docs: remove stale verifier count from handoff header`.
- `2ef1dc7` - `docs: Phase REPO-1.0 desktop app layout inventory and verifier guard`.

Accepted:
- `1f046fc` removes the stale top-level `check:fast 69/69` assertion from the current handoff status and replaces it with non-counted `check:fast green` wording.
- `2ef1dc7` is verifier-first and does not physically move product source files.
- `docs/architecture/desktop-app-layout-inventory.md` captures the current desktop layout, long-term `apps/desktop/**` target shape, no-change contracts, and required verification commands before any REPO-1 physical move.
- `scripts/verify-repository-directory-architecture.mjs` now locks key desktop contract paths and the current 21 `register-*.mjs` IPC module count, so accidental early desktop reshuffles should fail fast.

Required cleanup before REPO-1.1 starts:
- Avoid unverified exact file-count prose in the inventory. Current local counts are `src/desktop/tray` 39 top-level files / 60 recursive files, and `src/desktop/renderer` 78 recursive files, which does not exactly match `tray/ (54 files)` and `renderer/ (80+ files)`. Either remove these counts or make the verifier compute and enforce the intended definition.
- Fix the migration sequence wording: compatibility barrels must be created and verified during each move, not as a final REPO-1.6 step after all imports are changed. Each sub-phase should be `add target path + compatibility facade -> migrate imports -> verify no stale owner/import text -> remove or archive old reachable path when safe`.
- Clarify REPO-1.4. The current line says `renderer/shared/ -> renderer/shared/ (path stable)`, which reads like a move to the same path. If the intent is only to classify/verify shared renderer clients before later feature-folder moves, say that explicitly.
- Before REPO-1.1, add move-grade verifier checks for stale `src/desktop/tray/desktop-gui-smoke-runner.mjs` owner text/imports after the smoke runner move. The current verifier locks pre-move state, which is correct for REPO-1.0, but it must be updated in the same PR that performs each move.

Verification rerun by Codex:
- `node --check scripts/verify-repository-directory-architecture.mjs`: passed.
- `node scripts/verify-repository-directory-architecture.mjs`: passed.
- `node --check scripts/check-manifest.mjs`: passed.
- `node scripts/verify-ipc-contract-inventory.mjs`: passed.
- `node scripts/verify-desktop-renderer.mjs`: passed.
- `node scripts/verify-renderer-direct-runtime-calls.mjs`: passed.
- `node scripts/verify-main-process-blocking.mjs`: passed.
- `npm run check:fast`: passed 70/70.

Decision:
- Accept `1f046fc` and `2ef1dc7` as REPO-1.0 inventory/guard progress.
- REPO-1.1 should not start until the desktop layout inventory is corrected so it does not teach a late-compatibility-barrel migration pattern or stale unverified file counts.

## Codex Review: REPO-1.0 Cleanup + REPO-1.1 Smoke Runner Move

Review date: 2026-05-11.

DeepSeek commits reviewed:
- `4ef8aef` - `docs: fix REPO-1.0 inventory per Codex review`.
- `b33d895` - `refactor: move smoke runner to src/desktop/smoke/ (REPO-1.1)`.

Accepted:
- `4ef8aef` resolves the previous REPO-1.0 documentation blockers: exact file-count prose was removed, compatibility facades are described as per-move work, and REPO-1.4 is clarified as a classification/verification step rather than a same-path move.
- `b33d895` performs the intended low-risk REPO-1.1 move: `desktop-gui-smoke-runner.mjs` now lives at `src/desktop/smoke/desktop-gui-smoke-runner.mjs`, and `electron-main.mjs` imports it from the new owner path.
- The old product path `src/desktop/tray/desktop-gui-smoke-runner.mjs` no longer exists, and the runtime/verifier code references the new smoke path.
- GUI smoke still passes 44/44, including overlay, console, preview, link browser, popup, updater, and approval-card checks.

Required cleanup before declaring REPO-1.1 complete:
- `docs/architecture/desktop-app-layout-inventory.md` still lists `desktop-gui-smoke-runner.mjs` under `src/desktop/tray/` in the Current Layout. After REPO-1.1, that is stale current-state owner text and must move to a `src/desktop/smoke/` entry.
- `docs/architecture/codebase-file-inventory.md` says there is a compatibility barrel at `src/desktop/tray/desktop-gui-smoke-runner.mjs`, but `Test-Path src/desktop/tray/desktop-gui-smoke-runner.mjs` is `False`. Either restore a deliberate compatibility barrel or, better for this completed single-import move, remove the false barrel note.
- `scripts/verify-repository-directory-architecture.mjs` should fail on those stale current-layout/barrel assertions. Right now it checks the new smoke file exists, but it does not prove that old owner text was removed from active inventory docs.

Verification rerun by Codex:
- `Test-Path src/desktop/tray/desktop-gui-smoke-runner.mjs`: false.
- `Test-Path src/desktop/smoke/desktop-gui-smoke-runner.mjs`: true.
- `node --check src/desktop/tray/electron-main.mjs`: passed.
- `node --check src/desktop/smoke/desktop-gui-smoke-runner.mjs`: passed.
- `node --check scripts/verify-repository-directory-architecture.mjs`: passed.
- `node scripts/verify-repository-directory-architecture.mjs`: passed.
- `node scripts/verify-desktop-gui-perf-smoke.mjs`: passed.
- `node scripts/verify-main-process-blocking.mjs`: passed.
- `node scripts/verify-ipc-contract-inventory.mjs`: passed.
- `node scripts/verify-desktop-renderer.mjs`: passed.
- `node scripts/verify-renderer-direct-runtime-calls.mjs`: passed.
- `node scripts/verify-cancellation-propagation.mjs`: passed.
- `node scripts/verify-conversation-branch-contract.mjs`: passed.
- `node scripts/verify-task-llm-usage-ui.mjs`: passed.
- `node scripts/verify-user-interaction-smoke.mjs`: passed.
- `npm run verify:desktop-gui-smoke`: passed 44/44.
- `npm run check:fast`: passed 70/70.

Decision:
- Accept `4ef8aef`.
- Accept `b33d895` as a functional move, but do not declare REPO-1.1 complete until the two stale active-inventory assertions above are corrected and the repository-directory verifier blocks their return.

## Codex Review: REPO-1.1 Cleanup + REPO-1.2 IPC Move

Review date: 2026-05-11.

DeepSeek commits reviewed:
- `cb1d399` - `fix: remove stale smoke runner old-path references from inventory docs`.
- `3bc7b8f` - `refactor: move 21 IPC modules from tray/ipc/ to main/ipc/ (REPO-1.2)`.

Accepted:
- `cb1d399` resolves the previous REPO-1.1 inventory blocker. The current desktop layout now lists `src/desktop/smoke/desktop-gui-smoke-runner.mjs`, the false smoke compatibility-barrel note is gone, and the repository verifier blocks the old smoke runner path in active inventory docs.
- `3bc7b8f` correctly moves the 21 IPC module files to `src/desktop/main/ipc/`, removes the old `src/desktop/tray/ipc/` directory, and updates `electron-main.mjs` imports plus IPC inventory snapshots to the new owner path.
- IPC contract counters still verify through `scripts/verify-ipc-contract-inventory.mjs`, and `npm run check:fast` still passes 70/70.

Blocking issue:
- REPO-1.2 is not functionally complete. `npm run verify:desktop-gui-smoke` fails at Electron startup with `ERR_MODULE_NOT_FOUND`.
- Root cause: 9 moved IPC modules still import `normalizePlainObject` from `../desktop-payload-normalizers.mjs`, which now resolves to the non-existent `src/desktop/main/desktop-payload-normalizers.mjs` instead of the actual `src/desktop/tray/desktop-payload-normalizers.mjs`.
- A direct ESM import-resolution probe fails for:
  - `src/desktop/main/ipc/register-admin-ipc.mjs`
  - `src/desktop/main/ipc/register-connected-account-ipc.mjs`
  - `src/desktop/main/ipc/register-email-ipc.mjs`
  - `src/desktop/main/ipc/register-notes-project-ipc.mjs`
  - `src/desktop/main/ipc/register-provider-config-ipc.mjs`
  - `src/desktop/main/ipc/register-runtime-config-ipc.mjs`
  - `src/desktop/main/ipc/register-scheduler-ipc.mjs`
  - `src/desktop/main/ipc/register-skill-ipc.mjs`
  - `src/desktop/main/ipc/register-task-ipc.mjs`
- Existing fast verifiers missed this because `node --check` does not resolve ESM imports and `verify-ipc-contract-inventory.mjs` scans text/counts instead of importing each IPC module.

Required fix before REPO-1.2 can be accepted:
- Fix the broken relative imports. The immediate mechanical fix is to point those 9 modules at `../../tray/desktop-payload-normalizers.mjs`; a cleaner follow-up would move pure payload normalizers to a stable shared/main helper location and update the verifier accordingly.
- Add a verifier step that dynamically imports every `src/desktop/main/ipc/register-*.mjs` module, using `pathToFileURL(...)` on Windows, so broken relative imports fail without needing a full Electron GUI smoke run.
- Rerun `npm run verify:desktop-gui-smoke`; this is the gate that currently fails and therefore blocks REPO-1.2 completion.

Verification rerun by Codex:
- `node scripts/verify-ipc-contract-inventory.mjs`: passed.
- `node scripts/verify-repository-directory-architecture.mjs`: passed.
- `node scripts/verify-desktop-shell.mjs`: passed.
- `node scripts/verify-desktop-renderer.mjs`: passed.
- `node scripts/verify-main-process-blocking.mjs`: passed.
- `node scripts/verify-renderer-direct-runtime-calls.mjs`: passed.
- `node scripts/verify-desktop-gui-perf-smoke.mjs`: passed.
- `node scripts/verify-user-interaction-smoke.mjs`: passed.
- `npm run check:fast`: passed 70/70, but this is insufficient for REPO-1.2 because it did not catch the broken IPC module imports.
- `npm run verify:desktop-gui-smoke`: failed with `ERR_MODULE_NOT_FOUND` for `src/desktop/main/desktop-payload-normalizers.mjs`.

Decision:
- Accept `cb1d399`.
- Reject `3bc7b8f` as complete. It is structurally in the intended direction, but currently breaks Electron GUI startup. Do not start REPO-1.3 until IPC module import resolution and GUI smoke are green, and until the new module-load verifier is added.

## Codex Review: REPO-1.2 Repair + REPO-1.3 Shell Helper Move

Review date: 2026-05-11.

DeepSeek commits reviewed:
- `ffbcf68` - `fix: repair broken IPC module relative imports after REPO-1.2 move`.
- `fa0f4a3` - `refactor: move 6 shell helpers from tray/ to shell/ (REPO-1.3)`.

Accepted:
- `ffbcf68` fixes the REPO-1.2 startup blocker by changing the 9 moved IPC modules to import `normalizePlainObject` from `../../tray/desktop-payload-normalizers.mjs`.
- `scripts/verify-repository-directory-architecture.mjs` now dynamically imports every `src/desktop/main/ipc/register-*.mjs` module with `pathToFileURL(...)`, so the exact broken-import class from REPO-1.2 should be caught before GUI startup.
- All 21 IPC modules in `src/desktop/main/ipc/` now pass direct ESM import-resolution probing.
- `fa0f4a3` performs the intended functional move for 6 shell helpers into `src/desktop/shell/` and updates `electron-main.mjs` plus relevant verifiers to the new paths.
- `npm run verify:desktop-gui-smoke` passes 44/44, and `npm run check:fast` passes 70/70.

Remaining cleanup before declaring REPO-1.3 complete:
- `docs/architecture/codebase-file-inventory.md` still lists the 6 moved shell helper files under `src/desktop/tray/`:
  - `desktop-window-lifecycle.mjs`
  - `desktop-window-actions.mjs`
  - `desktop-shortcut-router.mjs`
  - `desktop-link-browser-window.mjs`
  - `desktop-preview-window-manager.mjs`
  - `desktop-permission-handler.mjs`
- Those are active inventory rows, not just historical review text, so they violate the no stale old-owner assertion rule for a migration-complete claim.
- Strengthen `scripts/verify-repository-directory-architecture.mjs` or a desktop ownership verifier so REPO-1.3 fails if active inventory docs keep these six old `src/desktop/tray/...` owner paths after the files have moved to `src/desktop/shell/...`.

Review note:
- A bare Node dynamic import probe of `src/desktop/shell/desktop-preview-window-manager.mjs` reports an `electron` named-export/CJS interop error for `import { screen } from "electron"`. This did not reproduce in the real Electron GUI smoke run, so it is not a product blocker. Do not add a naive dynamic-import verifier for all shell helpers unless Electron module interop is mocked or the helper is refactored to receive `screen` by injection.

Verification rerun by Codex:
- Direct ESM import probe for all 21 `src/desktop/main/ipc/register-*.mjs`: passed.
- `node --check src/desktop/tray/electron-main.mjs`: passed.
- `node --check src/desktop/shell/*.mjs`: passed.
- `node scripts/verify-repository-directory-architecture.mjs`: passed.
- `node scripts/verify-desktop-shell.mjs`: passed.
- `node scripts/verify-ipc-contract-inventory.mjs`: passed.
- `node scripts/verify-main-process-blocking.mjs`: passed.
- `node scripts/verify-desktop-gui-perf-smoke.mjs`: passed.
- `node scripts/verify-desktop-renderer.mjs`: passed.
- `node scripts/verify-link-open-choice-contract.mjs`: passed.
- `node scripts/verify-preview-window.mjs`: passed.
- `node scripts/verify-ui-extras.mjs`: passed.
- `node scripts/verify-audio-entrypoints.mjs`: passed.
- `node scripts/verify-context-handoff-ui.mjs`: passed.
- `npm run verify:desktop-gui-smoke`: passed 44/44.
- `npm run check:fast`: passed 70/70.

Decision:
- Accept `ffbcf68`; REPO-1.2's functional blocker is resolved.
- Accept `fa0f4a3` as a functional shell-helper move, but do not declare REPO-1.3 complete until `codebase-file-inventory.md` and verifier coverage prove the six old tray owner paths are gone from active inventory.

## Codex Review: REPO-1.3 Inventory Cleanup

Review date: 2026-05-11.

DeepSeek commit reviewed:
- `fe2f8ac` - `fix: update codebase inventory shell helper paths to shell/ (Codex REPO-1.3)`.

Accepted:
- `docs/architecture/codebase-file-inventory.md` now lists the six moved shell helpers under `src/desktop/shell/`.
- `scripts/verify-repository-directory-architecture.mjs` now fails if active inventory docs retain the old `src/desktop/tray/...` paths for those six shell helpers.
- A current sweep found no active architecture/source/script references to the moved smoke runner path, old tray IPC path, broken `src/desktop/main/desktop-payload-normalizers.mjs` path, or the six moved shell helper owner paths, except for the verifier's own forbidden-string checks.
- GUI smoke and fast checks remain green.

Verification rerun by Codex:
- `Test-Path src/desktop/tray/desktop-window-lifecycle.mjs`: false.
- `Test-Path src/desktop/shell/desktop-window-lifecycle.mjs`: true.
- `Test-Path src/desktop/tray/desktop-permission-handler.mjs`: false.
- `Test-Path src/desktop/shell/desktop-permission-handler.mjs`: true.
- `node scripts/verify-repository-directory-architecture.mjs`: passed.
- `node scripts/verify-desktop-shell.mjs`: passed.
- `node scripts/verify-main-process-blocking.mjs`: passed.
- `node scripts/verify-desktop-gui-perf-smoke.mjs`: passed.
- `node scripts/verify-ipc-contract-inventory.mjs`: passed.
- `node scripts/verify-desktop-renderer.mjs`: passed.
- `node scripts/verify-link-open-choice-contract.mjs`: passed.
- `node scripts/verify-preview-window.mjs`: passed.
- `node scripts/verify-ui-extras.mjs`: passed.
- `node scripts/verify-audio-entrypoints.mjs`: passed.
- `node scripts/verify-context-handoff-ui.mjs`: passed.
- `node scripts/verify-renderer-direct-runtime-calls.mjs`: passed.
- `npm run verify:desktop-gui-smoke`: passed 44/44.
- `npm run check:fast`: passed 70/70.

Decision:
- Accept `fe2f8ac`.
- REPO-1.3 may now be treated as complete for the six shell-helper move: product paths, active inventory docs, and verifier coverage agree.
- Do not begin the next physical move unless the same rule remains enforced: active inventory docs must be updated in the move PR, and stale old-owner text must be blocked by verifier coverage before any completion claim.

## Codex Review: REPO-1.4 Renderer Shared Clients + REPO-1.5 Deferral

Review date: 2026-05-11.

DeepSeek commits reviewed:
- `2e7fffa` - `chore: classify + verify 4 renderer shared clients (REPO-1.4)`.
- `e3565b4` - `docs: defer REPO-1.5 physical renderer moves (HTML script dependencies)`.

Accepted:
- `2e7fffa` is correctly scoped as classification/verification only. It does not pretend to move `renderer/shared/`; it locks the four real shared renderer client files in `scripts/verify-repository-directory-architecture.mjs`.
- The actual `src/desktop/renderer/shared/` directory contains exactly these four files: `runtime-http-client.mjs`, `runtime-task-client.mjs`, `shell-client.mjs`, and `echo-runtime-client.mjs`.
- `e3565b4` makes the right call to defer REPO-1.5 physical renderer sub-window moves. Moving renderer window files is not a cosmetic path change because the HTML files contain direct script references; a partial move would risk broken windows.
- No product source files were changed by either reviewed commit. The changes are docs plus verifier coverage only.
- The stale status line in `docs/architecture/desktop-app-layout-inventory.md` was corrected during this review so it no longer claims "No physical moves yet" after REPO-1.1 through REPO-1.3 have already moved files.

Required next-step discipline:
- Do not start REPO-1.5 as a simple folder shuffle. It must be planned as a complete renderer-entry migration that updates HTML script references, any static/package/electron-builder assumptions, renderer verifiers, GUI smoke coverage, and stale old-owner text checks in the same phase.
- Before any future REPO-1.5 completion claim, prove there are no active old-owner assertions left in inventory docs, source imports, package scripts, verifier snapshots, or HTML entrypoint references.
- REPO-1.6 remains a cleanup phase only after REPO-1.5 has a proven complete replacement path; it must not be used to postpone required verifier or inventory updates from the actual move phase.

Verification rerun by Codex:
- `node scripts/verify-repository-directory-architecture.mjs`: passed.
- `node scripts/verify-desktop-renderer.mjs`: passed.
- `node scripts/verify-renderer-direct-runtime-calls.mjs`: passed.
- `node scripts/verify-main-process-blocking.mjs`: passed.
- Stale moved-path sweep for REPO-1.1 through REPO-1.3: only verifier-owned forbidden-string checks remain.
- `npm run verify:desktop-gui-smoke`: passed 44/44.
- `npm run check:fast`: passed 70/70.

Decision:
- Accept `2e7fffa`; REPO-1.4 can be treated as complete for renderer shared-client classification and verifier locking.
- Accept `e3565b4`; REPO-1.5 and REPO-1.6 should stay deferred until the renderer HTML entrypoint migration is designed and executed as a full verified move.
- Do not mark the broader REPO-1 sequence fully closed yet. The next valid work is either a detailed REPO-1.5 migration design or moving to another independent cleanup phase that does not create half-migrated renderer paths.

## Codex Review: REPO-1.5a Final-Conclusion Check

Review date: 2026-05-11.

DeepSeek commits reviewed:
- `dca9824` - `chore: apply Codex hardening — remove barrel, add forbidden-path guard`.
- `9d68fef` - `docs: REPO-1.5a final conclusion — 10 attempts, Electron renderer blocker`.

Accepted:
- `dca9824` correctly commits the prior Codex cleanup: the obsolete `src/desktop/tray/desktop-payload-normalizers.mjs` compatibility barrel is gone, and the stale-owner verifier guards that old physical path.
- `9d68fef` correctly records that REPO-1.5a physical renderer moves should not be retried blindly. The repeated `console_stream_delta_load` failures are valid evidence that the next attempt needs Electron renderer debugging, not more path shuffling.

Issue found and fixed by Codex:
- `9d68fef` regressed the REPO-1.5a verifier by replacing the strict old-path/barrel check with `console-${file}` and loose `export *`/`export {` substring checks.
- Codex restored strict dual-mode verification:
  - `console.js` maps to the real old flat path `console.js`, not `console-console.js`.
  - Barrel-window mode accepts only active re-export lines pointing at the exact moved target.
  - Completion/no-barrel mode is allowed only when no old flat files remain.

Verification rerun by Codex:
- `node --check scripts/verify-repository-directory-architecture.mjs`: passed.
- `node scripts/verify-repository-directory-architecture.mjs`: passed.
- `node scripts/verify-stale-owner-paths.mjs`: passed.
- REPO-1.5a half-migration path check: `src/desktop/renderer/console/console.js` and `src/desktop/renderer/console/task-list.mjs` are absent; flat `console.js` and `console-task-list.mjs` remain present.
- `npm run verify:desktop-gui-smoke`: passed 44/44.
- `npm run check:fast`: passed 71/71.

Decision:
- Accept `dca9824`.
- Accept `9d68fef` as a blocker record only after Codex's verifier correction.
- No REPO-1.5a source migration is complete. Do not claim completion until an Electron-debugged attempt passes GUI smoke and stale-owner/path verifiers.

Next instruction for DeepSeek:
- First commit the current Codex verifier correction.
- Do not run more REPO-1.5a physical-move attempts without Electron DevTools or equivalent renderer module-graph evidence.
- Next executable work should be a non-renderer structural phase with proven Node/Electron-main behavior, or a dedicated REPO-1.5a-debug task that captures renderer console errors and module graph initialization before changing files again.

## Codex Review: CAP-1 Email Tools Migration

Review date: 2026-05-11.

DeepSeek commit reviewed:
- `e621ef8` - `feat: CAP-1 email-tools migration to capabilities/tools/`.

Accepted with fixes:
- The owner move is correct: `COMPOSE_EMAIL_TOOL` now belongs at `src/service/capabilities/tools/email-tools.mjs`.
- `src/service/action_tools/tools/index.mjs` imports `COMPOSE_EMAIL_TOOL` from the new capability owner.
- `scripts/verify-capability-roots.mjs`, `scripts/verify-tool-registry-snapshot.mjs`, `scripts/verify-stale-owner-paths.mjs`, and `docs/architecture/codebase-file-inventory.md` were updated for the new owner.

Issue found and fixed by Codex:
- DeepSeek left `src/service/action_tools/tools/email-tools.mjs` as a compatibility barrel. Under the current no-short-term-fallback discipline, this is not a valid completion state once all active callers use the new owner.
- Codex deleted the old compatibility barrel.
- Codex added `src/service/action_tools/tools/email-tools.mjs` to the stale-owner physical-path guard.
- Codex updated `docs/architecture/capability-directory-architecture.md` and `docs/architecture/tool-registry-inventory.md` so active architecture docs no longer describe email-tools as owned by the old action_tools directory.
- Codex also adjusted `scripts/verify-doc-references.mjs` to skip tracked source files that are deleted in the working tree, so local migration verification can run before the deletion is committed.

Verification rerun by Codex:
- `node --check src/service/capabilities/tools/email-tools.mjs`: passed.
- `node scripts/verify-capability-roots.mjs`: passed.
- `node scripts/verify-tool-registry-snapshot.mjs`: passed.
- `node scripts/verify-stale-owner-paths.mjs`: passed.
- `node scripts/verify-code-ownership-boundaries.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `npm run verify:desktop-gui-smoke`: passed 44/44.
- `npm run check:fast`: passed 71/71.
- `node scripts/verify-doc-references.mjs`: still fails on pre-existing missing Markdown references (`UPGRADE_PLAN.md`, `feedback_no_test_case_patches.md`) unrelated to the CAP-1 email move; not treated as this phase's completion gate.

Decision:
- Accept `e621ef8` after Codex's no-barrel cleanup and doc/verifier hardening.
- CAP-1 email-tools migration is complete for this single tool family: active caller, owner docs, registry verifier, capability-root verifier, stale-owner verifier, and physical paths agree.

Next instruction for DeepSeek:
- Commit the current Codex cleanup first.
- Continue CAP-1 one family at a time. Prefer the next low-blast-radius family with a small module and clear import surface; do not move schemas/registry yet.
- Every CAP-1 family move must delete the old source file before completion, add a stale-owner physical-path guard, update active inventory docs, run the targeted verifier, GUI smoke, and `check:fast`.

## Codex Review: CAP-1 Remaining Low-Risk Tool Moves

Review date: 2026-05-11.

DeepSeek commits reviewed:
- `49702e5` - `chore: apply Codex CAP-1 cleanup — remove barrel, harden verifiers`.
- `bae09a3` - `feat: CAP-1 scheduler-tools migration to capabilities/tools/`.
- `4b00b2a` - `feat: CAP-1 complete — migrate 5 remaining tool families to capabilities/tools/`.

Accepted:
- The moved tool families now have real capability owners under `src/service/capabilities/tools/`: browser/web/search/translation, email compose, file discovery/stat/artifact lookup, OS app/file/clipboard/notify, scheduler, `open-with-default-handler`, and `file-manifest-helpers`.
- The old physical files for these moved families are gone from `src/service/action_tools/tools/`.
- `src/service/action_tools/tools/index.mjs` imports the moved families from `../../capabilities/tools/...` and no longer defines their tool bodies.
- GUI smoke and fast checks remain green after the move.

Issues found and fixed by Codex:
- `scripts/verify-capability-roots.mjs` duplicated `scheduler-tools.mjs` and `file-manifest-helpers.mjs`; Codex deduplicated the root list.
- `scripts/verify-stale-owner-paths.mjs` classified CAP-1 tool paths under REPO-1 and duplicated `file-manifest-helpers`; Codex moved all CAP-1 old owners into one CAP-1 group and kept the no-barrel physical-path guard.
- Active architecture docs were stale: `docs/architecture/capability-directory-architecture.md`, `docs/architecture/tool-registry-inventory.md`, and `docs/architecture/codebase-file-inventory.md` still implied several moved modules belonged to the old `action_tools/tools` root or used old line/count wording. Codex updated them to match the current tree.
- `node scripts/verify-doc-references.mjs` was still red on missing source-comment references to `UPGRADE_PLAN.md` and `feedback_no_test_case_patches.md`. Codex fixed the comments to reference the existing canonical upgrade plan instead. These were comment-only source edits; no runtime behavior changed.

Verification rerun by Codex:
- `node --check` on all moved capability tool modules and `src/service/action_tools/tools/index.mjs`: passed.
- `node --check` on the touched source-comment files: passed.
- `node scripts/verify-capability-roots.mjs`: passed.
- `node scripts/verify-tool-registry-snapshot.mjs`: passed.
- `node scripts/verify-stale-owner-paths.mjs`: passed.
- `node scripts/verify-code-ownership-boundaries.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `node scripts/verify-repository-directory-architecture.mjs`: passed.
- `node scripts/verify-renderer-direct-runtime-calls.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `node scripts/verify-doc-references.mjs`: passed.
- `npm run verify:desktop-gui-smoke`: passed 44/44.
- `npm run check:fast`: passed 71/71.

Decision:
- Accept `49702e5`, `bae09a3`, and `4b00b2a` after Codex cleanup.
- CAP-1 is complete only for the seven moved low-risk/helper modules listed above. This is not a claim that every tool-related module has left `src/service/action_tools/tools/`.
- Remaining old-owner files are intentional later-phase/high-risk surfaces: `index.mjs`, `document-renderer.mjs`, `memory-tools.mjs`, `mermaid-assets.mjs`, `skill-install-tools.mjs`, `svg-sanitize.mjs`, and `vision-analyze.mjs`.

Next instruction for DeepSeek:
- First commit Codex's current cleanup as a review-fix commit.
- Do not start CAP-2 schemas/registry yet.
- Next executable task should be a CAP-1 closure/classification step for the remaining old-owner files:
  - document why each remaining file is deferred;
  - add/confirm verifier coverage that CAP-1 completion means "moved low-risk/helper families have no old path", not "action_tools/tools is empty";
  - choose exactly one next high-risk family only after its boundary, tests, and no-touch areas are documented.
- Recommended next high-risk candidate order: `vision-analyze.mjs` provider boundary, then `memory-tools.mjs` session/memory boundary, then `skill-install-tools.mjs` security/approval boundary. Artifact/render helpers should wait for an artifact-specific phase.

## Codex Review: CAP-1 Closure + Vision Boundary Deferral

Review date: 2026-05-11.

DeepSeek commits reviewed:
- `34ce89b` - `chore: CAP-1 closure — physical-path guard + deferred file classification`.
- `2d89082` - `docs: CAP-1 vision-analyze boundary assessment (deferred)`.

Accepted:
- `34ce89b` correctly adds CAP-1 physical old-path assertions to `scripts/verify-tool-registry-snapshot.mjs`; the seven moved low-risk/helper modules cannot silently reappear under `src/service/action_tools/tools/`.
- The stale-owner verifier skip for `scripts/verify-tool-registry-snapshot.mjs` is acceptable because that verifier intentionally owns old-path guard strings.
- `2d89082` correctly defers `vision-analyze.mjs` instead of moving it without a runtime/provider test. The doc captures its provider resolver and multi-modal executor dependencies.

Issue found and fixed by Codex:
- `scripts/verify-tool-registry-snapshot.mjs` described `index.mjs` as a compatibility barrel. That is inaccurate: it is the live aggregator and still owns remaining inline high-risk tools. Codex corrected the comment.
- `docs/architecture/vision-analyze-boundary.md` said to prefer moving vision after CAP-2 schemas/registry. That conflicts with current execution discipline: CAP-2 must not start yet, and vision needs its own provider/runtime gates. Codex changed the doc to require vision-specific test/verifier coverage instead of using CAP-2 as a prerequisite or shortcut.

Verification rerun by Codex:
- `node --check scripts/verify-tool-registry-snapshot.mjs`: passed.
- `node scripts/verify-tool-registry-snapshot.mjs`: passed.
- `node scripts/verify-stale-owner-paths.mjs`: passed.
- `node scripts/verify-capability-roots.mjs`: passed.
- `node scripts/verify-doc-references.mjs`: passed.

Decision:
- Accept `34ce89b` and `2d89082` after Codex wording corrections.
- CAP-1 closure is now verifier-backed for moved low-risk/helper paths.
- `vision-analyze.mjs` remains deferred. Do not move it until a focused runtime/provider test exists.

Next instruction for DeepSeek:
- Commit Codex's wording corrections first.
- Do not open CAP-2.
- Next task should be "CAP-1 vision-analyze preflight", not a physical move:
  - add a focused verifier/test that exercises `VISION_ANALYZE_TOOL.execute` with stubbed provider resolver and multi-modal vision calls;
  - update `scripts/verify-provider-boundary.mjs` so it documents the current old owner and the future capability owner expectation;
  - document no-touch contracts: tool id, schema key, provider ids, image loading semantics, artifact/source attachment semantics;
  - only after that test is green should a later commit move `vision-analyze.mjs` to `src/service/capabilities/tools/` and delete the old path.

## Codex Review: CAP-1 Vision Analyze Static Preflight

Review date: 2026-05-11.

DeepSeek commit reviewed:
- `21c3d0a` - `feat: CAP-1 vision-analyze preflight verifier`.

Accepted:
- The commit is correctly scoped as preflight only. It does not move `src/service/action_tools/tools/vision-analyze.mjs`, change tool ids, change provider ids, or alter runtime behavior.
- `scripts/verify-vision-analyze-contract.mjs` locks important static contracts: registry presence, current owner path, `VISION_ANALYZE_TOOL` export, `image_paths` surface, attached-path allowlist, image limit, provider resolver reference, vision-specific provider calls, schema reference, and boundary-doc deferred status.
- Adding the verifier to `scripts/check-manifest.mjs` is correct; it is now part of fast/release verification.

Issue found and fixed by Codex:
- The new verifier is static. It does not yet satisfy the previous instruction to exercise `VISION_ANALYZE_TOOL.execute` with a stubbed provider resolver and stubbed multi-modal vision calls.
- Codex updated `scripts/verify-vision-analyze-contract.mjs` and `docs/architecture/vision-analyze-boundary.md` to say this explicitly, so the static preflight cannot be mistaken for permission to perform the physical move.

Verification rerun by Codex:
- `node --check scripts/verify-vision-analyze-contract.mjs`: passed.
- `node scripts/verify-vision-analyze-contract.mjs`: passed.
- `node scripts/verify-doc-references.mjs`: passed.

Decision:
- Accept `21c3d0a` as a static preflight only.
- Do not move `vision-analyze.mjs` yet.
- Do not open CAP-2 yet.

Next instruction for DeepSeek:
- Commit Codex's clarification first.
- Next commit must add the missing runtime/provider preflight before any physical move:
  - either add an injectable test seam for `VISION_ANALYZE_TOOL.execute`, or another framework-approved way to stub `resolveProviderForTask`, `loadImageAsBase64`, `callAnthropicVision`, and `callOpenAIVision`;
  - prove successful execution metadata for an accepted attached image path;
  - prove rejection still happens before file read/provider upload for unattached paths;
  - keep the old owner path in place until that runtime/provider preflight is green.

## Codex Review: CAP-1 Vision Analyze Runtime Rejection Preflight

Review date: 2026-05-11.

DeepSeek commit reviewed:
- `d380e54` - `feat: CAP-1 vision-analyze runtime preflight verifier`.

Accepted:
- The commit remains preflight-only. It adds `scripts/verify-vision-analyze-runtime.mjs` and wires it into `scripts/check-manifest.mjs`; no product source was moved.
- The new verifier executes useful runtime rejection-path checks through the existing `VISION_ANALYZE_TOOL` / `__test` seam:
  - attached `image_paths` are allowlisted;
  - unattached paths are not allowlisted;
  - `file_paths` are accepted as the same user attachment surface;
  - empty `image_paths` are rejected by `execute`;
  - unattached requested paths are rejected by `execute` before image read or provider upload;
  - generated screenshot artifacts are collected as same-task image inputs.

Issue found and fixed by Codex:
- The new verifier still does not cover a successful provider execution path with stubbed `resolveProviderForTask`, `loadImageAsBase64`, `callAnthropicVision`, or `callOpenAIVision`.
- Codex renamed its framing to "runtime rejection-path preflight", removed unused imports, strengthened the unattached-path assertion metadata, and updated `docs/architecture/vision-analyze-boundary.md` so this cannot be mistaken for a full move gate.

Verification rerun by Codex:
- `node --check scripts/verify-vision-analyze-runtime.mjs`: passed.
- `node scripts/verify-vision-analyze-runtime.mjs`: passed.
- `node scripts/verify-vision-analyze-contract.mjs`: passed.
- `node scripts/verify-doc-references.mjs`: passed.

Decision:
- Accept `d380e54` after Codex cleanup, but only as runtime rejection-path coverage.
- `vision-analyze.mjs` still must not move yet.
- CAP-2 remains blocked.

Next instruction for DeepSeek:
- Commit Codex's cleanup first.
- Add the missing successful-provider preflight before any physical move:
  - introduce a clean injectable seam or test harness that can stub provider resolution, image loading, and the Anthropic/OpenAI vision calls without real network or filesystem image reads;
  - prove accepted attached image path returns `success: true` with provider/model/image_count/image_paths metadata;
  - prove `supportsVision:false`, `code_cli`, and `ollama` provider gates return the existing refusal observations;
  - keep `src/service/action_tools/tools/vision-analyze.mjs` in place until that successful-provider preflight is green.

## Codex Review: CAP-1 Vision Analyze Physical Move

Review date: 2026-05-11.

DeepSeek commits reviewed:
- `6ea169d` - `feat: add vision-analyze provider-gate tests via __test.callVisionProvider`.
- `a91eb0c` - `feat: CAP-1 vision-analyze physical move + injectable test seam`.

Accepted:
- `vision-analyze.mjs` was physically moved to `src/service/capabilities/tools/vision-analyze.mjs`.
- The old `src/service/action_tools/tools/vision-analyze.mjs` path is absent; no compatibility barrel remains.
- `src/service/action_tools/tools/index.mjs` imports `VISION_ANALYZE_TOOL` from the capability owner.
- Provider-boundary, stale-owner, contract, runtime, inventory, and behavior-test surfaces were updated to the new owner.
- The `_testSeam` on `VISION_ANALYZE_TOOL.execute` is narrow and defaults to production implementations, so runtime behavior is unchanged outside tests.

Issues found and fixed by Codex:
- `docs/architecture/vision-analyze-boundary.md` still described the tool as not moved and insufficient for physical migration. Codex updated it to the current moved-owner state and current verifier coverage.
- `scripts/verify-vision-analyze-contract.mjs` still required the old "Not moved in this phase" documentation text. Codex changed it to require the new moved owner and to assert the old owner path is absent.
- `scripts/verify-capability-roots.mjs` did not include `src/service/capabilities/tools/vision-analyze.mjs`; Codex added the new root.
- `scripts/verify-tool-registry-snapshot.mjs` did not yet lock the `index.mjs` import or old physical path for vision. Codex added both checks and removed stale "next high-risk candidate" wording.
- `scripts/verify-vision-analyze-runtime.mjs` proved a stubbed successful `execute` path, but not the Anthropic/OpenAI branch selection inside `callVisionProvider`. Codex added injected-client coverage for both branches and replaced latent `fail(...)` calls with `assert.fail(...)`.
- `scripts/verify-stale-owner-paths.mjs` now skips the vision contract verifier because that verifier intentionally owns the old-path guard string.

Verification rerun by Codex:
- `node --check src/service/capabilities/tools/vision-analyze.mjs`: passed.
- `node --check src/service/action_tools/tools/index.mjs`: passed.
- `node --check scripts/verify-vision-analyze-runtime.mjs`: passed.
- `node --check scripts/verify-vision-analyze-contract.mjs`: passed.
- `node scripts/verify-vision-analyze-runtime.mjs`: passed.
- `node scripts/verify-vision-analyze-contract.mjs`: passed.
- `node scripts/verify-capability-roots.mjs`: passed.
- `node scripts/verify-tool-registry-snapshot.mjs`: passed.
- `node scripts/verify-stale-owner-paths.mjs`: passed.
- `node scripts/verify-provider-boundary.mjs`: passed.
- `node scripts/verify-doc-references.mjs`: passed.
- `node scripts/verify-repository-directory-architecture.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `node scripts/verify-behavior-tests.mjs`: passed, 986/986.
- `npm run check:fast`: passed, 73/73.
- `npm run verify:desktop-gui-smoke`: passed, 44/44.

Decision:
- Accept `6ea169d` and `a91eb0c` after Codex cleanup.
- CAP-1 vision-analyze physical move is complete: owner, import, old-path deletion, stale-owner guard, provider-boundary verifier, static contract verifier, and runtime verifier agree.
- Do not open CAP-2 yet.

Next instruction for DeepSeek:
- Commit Codex's cleanup first.
- Continue CAP-1 with the next high-risk family preflight, not a physical move:
  - recommended next: `memory-tools.mjs` session/memory/artifact boundary;
  - document dependencies and no-touch contracts first;
  - add a focused runtime verifier with stubbed runtime/store/session surfaces;
  - only after that verifier is green should a separate physical move be prepared.

## Codex Review: No New DeepSeek Commit After Vision Move

Review date: 2026-05-11.

Repository state reviewed:
- Latest commit is still `a91eb0c` - `feat: CAP-1 vision-analyze physical move + injectable test seam`.
- No new DeepSeek commit exists after the CAP-1 vision-analyze physical move.
- The working tree still contains Codex cleanup for the vision-analyze review:
  boundary docs, capability inventory, stale-owner/tool-registry/capability-root
  verifiers, runtime verifier hardening, and the narrow provider-call injection
  seam in `src/service/capabilities/tools/vision-analyze.mjs`.

Decision:
- There is no new DeepSeek implementation to accept or reject yet.
- DeepSeek must not start the `memory-tools.mjs` preflight on top of an
  uncommitted cleanup pile.
- The correct next action is to commit the Codex cleanup from the previous
  review, then start the next CAP-1 high-risk preflight as a new, separate
  change.

Next instruction for DeepSeek:
- First commit the current Codex cleanup.
- After the cleanup commit, begin only the `memory-tools.mjs` preflight:
  inventory dependencies, no-touch contracts, and a focused verifier with
  stubbed runtime/store/session surfaces.
- Do not move `memory-tools.mjs` in the same commit as the preflight.

## Codex Review: CAP-1 Memory + Skill Install Static Preflights

Review date: 2026-05-11.

DeepSeek commits reviewed:
- `2c06ff5` - `docs: CAP-1 memory-tools contract preflight (no physical move)`.
- `c572302` - `docs: CAP-1 skill-install-tools contract preflight (no physical move)`.

Accepted:
- `95bd07e` correctly committed the prior Codex vision-analyze cleanup before
  new preflight work started.
- `2c06ff5` adds a static boundary document and verifier for
  `src/service/action_tools/tools/memory-tools.mjs`; it does not move or edit
  product source.
- `c572302` adds a static boundary document and verifier for
  `src/service/action_tools/tools/skill-install-tools.mjs`; it does not move or
  edit product source.
- Both new verifiers are wired into `scripts/check-manifest.mjs`, so
  `npm run check:fast` now runs 75 commands.

Issues found and fixed by Codex:
- `docs/architecture/memory-tools-boundary.md` listed execution follow-up for
  only three of the four memory tools. Codex added
  `list_conversation_artifacts.execute` with stubbed store/artifact rows.
- `docs/architecture/skill-install-tools-boundary.md` had an incorrect
  post-move `github-install.mjs` relative-path note. Codex corrected it to
  `../../ai/skills/github-install.mjs` from `capabilities/tools/`.

Verification rerun by Codex:
- `node --check scripts/verify-memory-tools-contract.mjs`: passed.
- `node --check scripts/verify-skill-install-tools-contract.mjs`: passed.
- `node scripts/verify-memory-tools-contract.mjs`: passed.
- `node scripts/verify-skill-install-tools-contract.mjs`: passed.
- `node scripts/verify-doc-references.mjs`: passed.
- `node scripts/verify-stale-owner-paths.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `npm run check:fast`: passed, 75/75.

Decision:
- Accept `2c06ff5` and `c572302` after Codex doc corrections as static contract
  preflights only.
- These commits are not permission to physically move either family.
- The `skill-install-tools.mjs` preflight may remain as inventory, but its
  physical move is blocked until its approval/security runtime gates exist.

Next instruction for DeepSeek:
- Commit Codex's two boundary-doc corrections first.
- Next work must be the `memory-tools.mjs` runtime verifier, not another static
  inventory family and not a physical move.
- The memory runtime verifier must execute all four tools with stubbed
  `runtime.store` and `runtime.platform.embeddingStore` surfaces:
  `recall_memory`, `list_recent_tasks`, `get_task_detail`, and
  `list_conversation_artifacts`.
- Only after that verifier is green may DeepSeek prepare a separate
  `memory-tools.mjs` physical move commit.

## Codex Review: CAP-1 Memory Tools Runtime Preflight

Review date: 2026-05-11.

DeepSeek commit reviewed:
- `0fdb0b9` - `feat: CAP-1 memory-tools runtime verifier (all 4 tools, no physical move)`.

Accepted:
- `bb01630` correctly committed the previous Codex boundary-doc corrections
  before adding the runtime verifier.
- `0fdb0b9` adds `scripts/verify-memory-tools-runtime.mjs` and wires it into
  `scripts/check-manifest.mjs`; `npm run check:fast` now runs 76 commands.
- No product source files were moved or edited in the DeepSeek commit.
- The verifier executes all four memory tools with stubbed
  `runtime.store` / `runtime.platform.embeddingStore` surfaces:
  `recall_memory`, `list_recent_tasks`, `get_task_detail`, and
  `list_conversation_artifacts`.

Issue found and fixed by Codex:
- The initial `list_conversation_artifacts` runtime check asserted only
  `success: true`, so it could pass on the empty-artifact success branch.
  Codex changed the stub to return concrete artifact rows and now asserts
  observation text plus exact `metadata.artifact_paths`.
- Codex also strengthened `list_recent_tasks` and `get_task_detail` assertions
  so artifact metadata and default failed-task filtering are locked.
- `docs/architecture/memory-tools-boundary.md` still described runtime execution
  checks as future work. Codex updated it to document current contract +
  runtime preflight coverage while keeping the file explicitly not moved.

Verification rerun by Codex:
- `node --check scripts/verify-memory-tools-runtime.mjs`: passed.
- `node scripts/verify-memory-tools-runtime.mjs`: passed.
- `node scripts/verify-memory-tools-contract.mjs`: passed.
- `node scripts/verify-doc-references.mjs`: passed.
- `node scripts/verify-stale-owner-paths.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `npm run check:fast`: passed, 76/76.

Decision:
- Accept `0fdb0b9` after Codex verifier hardening as the memory-tools runtime
  preflight.
- `memory-tools.mjs` is now eligible for a separate physical move commit, but
  it has not moved yet.
- `skill-install-tools.mjs` is still blocked from physical move until its
  approval/contentHash/surface-gating runtime verifier exists.
- Do not open CAP-2 yet.

Next instruction for DeepSeek:
- Commit Codex's memory runtime verifier hardening first.
- Then prepare a separate `memory-tools.mjs` physical move commit only:
  move `src/service/action_tools/tools/memory-tools.mjs` to
  `src/service/capabilities/tools/memory-tools.mjs`, update the aggregator
  import, update capability/tool inventories, and add old-path absence guards.
- Do not include `skill-install-tools.mjs` or other families in the same move.
- After the move, rerun `node scripts/verify-memory-tools-runtime.mjs`,
  `node scripts/verify-memory-tools-contract.mjs`,
  `node scripts/verify-tool-registry-snapshot.mjs`,
  `node scripts/verify-capability-roots.mjs`,
  `node scripts/verify-stale-owner-paths.mjs`, and `npm run check:fast`.

## Codex Review: CAP-1 Memory Tools Physical Move

Review date: 2026-05-11.

DeepSeek commit reviewed:
- `024681d` - `feat: CAP-1 memory-tools physical move to capabilities/tools/`.

Accepted:
- `3a7ac44` correctly committed the previous Codex memory runtime verifier
  hardening before the physical move.
- `memory-tools.mjs` was physically moved to
  `src/service/capabilities/tools/memory-tools.mjs`.
- The old `src/service/action_tools/tools/memory-tools.mjs` path is absent; no
  compatibility barrel remains.
- `src/service/action_tools/tools/index.mjs` imports `MEMORY_TOOLS` from the
  capability owner.
- The moved source keeps the same tool ids and read-only behavior.

Issues found and fixed by Codex:
- `scripts/verify-memory-tools-contract.mjs` only changed `currentPath`; it did
  not assert the old owner path was absent and still described the phase as
  preflight-only. Codex converted it into a post-move ownership verifier.
- `scripts/verify-tool-registry-snapshot.mjs` still listed `memory-tools.mjs`
  as a later-phase old-owner file and did not lock the new capability import.
  Codex added both checks.
- `scripts/verify-capability-roots.mjs` did not list
  `src/service/capabilities/tools/memory-tools.mjs`; Codex added it.
- `docs/architecture/capability-directory-architecture.md` still listed
  `memory-tools.mjs` under old action-tools ownership. Codex moved it to the
  capability-owned tools row.
- `docs/architecture/memory-tools-boundary.md` still said the file was not
  moved. Codex updated it to the moved-owner state and current verifier
  coverage.
- `scripts/verify-deictic-recall.mjs` still imported memory tools from the old
  path. Codex updated it to the capability owner.
- `src/service/core/context-submission.mjs` had a stale source comment pointing
  at the old owner and mentioning only three memory tools. Codex updated the
  comment to the current owner and four-tool surface.
- `docs/architecture/current-codebase-structure-audit.md` still referenced the
  old owner path. Codex updated the active audit inventory row.

Verification rerun by Codex:
- `node scripts/verify-memory-tools-contract.mjs`: passed.
- `node scripts/verify-memory-tools-runtime.mjs`: passed.
- `node scripts/verify-deictic-recall.mjs`: passed.
- `node scripts/verify-tool-registry-snapshot.mjs`: passed.
- `node scripts/verify-capability-roots.mjs`: passed.
- `node scripts/verify-stale-owner-paths.mjs`: passed.
- `node scripts/verify-doc-references.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `npm run verify:desktop-gui-smoke`: passed, 44/44.
- First `npm run check:fast` run failed at behavior aggregation with `pass 984
  / fail 2`; direct `node scripts/verify-behavior-tests.mjs` rerun passed
  986/986, and a full `npm run check:fast` rerun passed 76/76.

Decision:
- Accept `024681d` after Codex cleanup.
- CAP-1 memory-tools physical move is complete: owner, import, old-path
  deletion, stale-owner guard, static contract verifier, runtime verifier,
  deictic recall verifier, and inventory docs now agree.
- `skill-install-tools.mjs` is still blocked from physical move until approval,
  contentHash, and surface-gating runtime verification exists.
- Do not open CAP-2 yet.

Next instruction for DeepSeek:
- Commit Codex's memory-tools move cleanup first.
- Next work should be `skill-install-tools.mjs` runtime/security preflight, not
  a physical move:
  - execute preview and install wrappers with stubbed `stageSkillFromGitHub`,
    `finalizeStagedInstall`, and `discardStagedInstall` or an approved seam;
  - prove `install_skill_from_github` remains high risk and confirmation-gated;
  - prove contentHash/state_token binding survives the approval flow;
  - prove `shouldExposeSkillInstall` still gates exposure by class-level
    surface, not prompt-specific phrases.

## Codex Review: CAP-1 Skill Install Runtime/Security Preflight

Review date: 2026-05-11.

DeepSeek commit reviewed:
- `4f0189d` - `feat: CAP-1 skill-install-tools runtime preflight + test seam`.

Accepted:
- `9c03455` correctly committed the previous Codex memory-tools move cleanup
  before starting skill-install runtime/security preflight work.
- `4f0189d` keeps `skill-install-tools.mjs` at
  `src/service/action_tools/tools/skill-install-tools.mjs`; no physical move
  occurred.
- The `_testSeam` is narrow and defaults to the production
  `stageSkillFromGitHub`, `finalizeStagedInstall`, and `discardStagedInstall`
  implementations.
- `scripts/verify-skill-install-tools-runtime.mjs` is wired into
  `scripts/check-manifest.mjs`; `npm run check:fast` now runs 77 commands.

Issues found and fixed by Codex:
- The first runtime verifier proved success/failure paths, but did not assert
  that injected stage/finalize/discard functions were actually called with the
  right URL/runtime/stagingInfo. Codex added those call-shape checks.
- The missing-registry preview case did not prove cleanup. Codex now asserts
  `discardInstall` receives the exact staged info when the registry is absent.
- The install success case did not prove `state_token` consumption hands the
  same contentHash-bound stagingInfo to finalize. Codex added exact
  `consume(token)` and `finalize(stagingInfo, { runtime })` assertions.
- Surface gating was only checked by source-string presence. Codex added live
  `shouldExposeSkillInstall` and `filterToolsForTask` checks for positive and
  negative class-level cases.
- `docs/architecture/skill-install-tools-boundary.md` listed nonexistent
  `createNoopTool` and `ACTION_TOOL_SCHEMAS` imports. Codex corrected the
  dependency table and updated the doc to reflect current runtime/security
  preflight coverage while keeping the file explicitly not moved.

Verification rerun by Codex:
- `node --check src/service/action_tools/tools/skill-install-tools.mjs`: passed.
- `node --check scripts/verify-skill-install-tools-runtime.mjs`: passed.
- `node scripts/verify-skill-install-tools-runtime.mjs`: passed.
- `node scripts/verify-skill-install-tools-contract.mjs`: passed.
- `node scripts/verify-skill-install-tools.mjs`: passed, 65/65.
- `node scripts/verify-skill-install-approval-preview.mjs`: passed, 22/22.
- `node scripts/verify-skill-stage-finalize.mjs`: passed, 25/25.
- `node scripts/verify-doc-references.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `node scripts/verify-stale-owner-paths.mjs`: passed.
- `npm run check:fast`: passed, 77/77.

Decision:
- Accept `4f0189d` after Codex verifier and boundary-doc hardening.
- Skill-install static + runtime/security preflight coverage is now sufficient
  to prepare a separate physical move commit.
- `skill-install-tools.mjs` has not moved yet.
- Do not open CAP-2 yet.

Next instruction for DeepSeek:
- Commit Codex's skill-install verifier/doc hardening first.
- Then prepare a separate `skill-install-tools.mjs` physical move commit only:
  move `src/service/action_tools/tools/skill-install-tools.mjs` to
  `src/service/capabilities/tools/skill-install-tools.mjs`, update the
  aggregator import, update capability/tool inventories, update runtime and
  contract verifier imports/owner checks, and add old-path absence guards.
- Do not include `document-renderer.mjs`, `mermaid-assets.mjs`,
  `svg-sanitize.mjs`, or CAP-2 schemas/registry work in the same move.
- After the move, rerun `node scripts/verify-skill-install-tools-runtime.mjs`,
  `node scripts/verify-skill-install-tools-contract.mjs`,
  `node scripts/verify-skill-install-tools.mjs`,
  `node scripts/verify-skill-install-approval-preview.mjs`,
  `node scripts/verify-skill-stage-finalize.mjs`,
  `node scripts/verify-tool-registry-snapshot.mjs`,
  `node scripts/verify-capability-roots.mjs`,
  `node scripts/verify-stale-owner-paths.mjs`, and `npm run check:fast`.

## Codex Review: CAP-1 Skill Install Physical Move

Review date: 2026-05-11.

DeepSeek commit reviewed:
- `66de08b` - `feat: CAP-1 skill-install-tools physical move to capabilities/tools/`.

Accepted after Codex cleanup:
- `0165b86` correctly committed the previous Codex skill-install runtime verifier
  hardening before the physical move.
- `skill-install-tools.mjs` now lives at
  `src/service/capabilities/tools/skill-install-tools.mjs`.
- The old `src/service/action_tools/tools/skill-install-tools.mjs` owner path is
  absent.
- `src/service/action_tools/tools/index.mjs` imports the skill-install tools from
  the capability owner.
- No compatibility barrel remains at the old owner path.

Issues found and fixed by Codex:
- `scripts/verify-skill-install-tools-contract.mjs` only changed the current path;
  it did not assert old-path absence and still described the phase as
  preflight-only. Codex converted it into a post-move owner verifier.
- `scripts/verify-skill-install-tools.mjs` still imported the old owner. Codex
  updated it to the capability owner.
- `scripts/verify-tool-registry-snapshot.mjs` did not lock the capability import,
  did not list the old owner in moved CAP-1 paths, and still described
  `skill-install-tools.mjs` as later-phase work. Codex fixed all three.
- `scripts/verify-capability-roots.mjs` did not include the new capability owner.
  Codex added it.
- `scripts/verify-stale-owner-paths.mjs` had the moved old path with bad
  indentation. Codex normalized the guard entry.
- `docs/architecture/capability-directory-architecture.md` and
  `docs/architecture/current-codebase-structure-audit.md` still referenced the
  old ownership shape. Codex updated the active inventory text.
- `docs/architecture/skill-install-tools-boundary.md` still said the file had not
  moved. Codex updated it to the moved-owner state and current verifier
  coverage.

Verification rerun by Codex:
- `node --check scripts/verify-skill-install-tools-contract.mjs`: passed.
- `node scripts/verify-skill-install-tools-contract.mjs`: passed.
- `node scripts/verify-skill-install-tools-runtime.mjs`: passed.
- `node scripts/verify-skill-install-tools.mjs`: passed, 65/65.
- `node scripts/verify-skill-install-approval-preview.mjs`: passed, 22/22.
- `node scripts/verify-skill-stage-finalize.mjs`: passed, 25/25.
- `node scripts/verify-tool-registry-snapshot.mjs`: passed.
- `node scripts/verify-capability-roots.mjs`: passed.
- `node scripts/verify-stale-owner-paths.mjs`: passed.
- `node scripts/verify-doc-references.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `npm run check:fast`: passed, 77/77.
- `npm run verify:desktop-gui-smoke`: passed, 44/44.

Decision:
- Accept `66de08b` after Codex cleanup.
- CAP-1 skill-install physical move is complete: owner, aggregator import,
  old-path deletion, stale-owner guard, contract verifier, runtime verifier, and
  inventory docs now agree.
- CAP-1 completed high-risk tool-family physical moves now include
  `vision-analyze`, `memory-tools`, and `skill-install-tools`.
- `document-renderer.mjs`, `mermaid-assets.mjs`, and `svg-sanitize.mjs` are still
  old-owner high-risk render/artifact/security families.
- Do not open CAP-2 yet.

Next instruction for DeepSeek:
- Commit Codex's skill-install physical-move cleanup first.
- Next work should be `document-renderer.mjs` static and runtime preflight, not a
  physical move and not CAP-2.
- The document-renderer preflight must document and verify:
  - current dependencies and owner boundaries;
  - no-touch contracts for artifact kinds, generated document behavior, preview
    formats, file writes, IPC channels, storage records, and public tool ids;
  - runtime behavior for supported document/render outputs with controlled test
    seams or targeted behavior tests;
  - failure/cleanup behavior without adding fallback shortcuts or prompt-specific
    patches.
- Only after static and runtime preflight are green may a separate physical move
  be prepared for `document-renderer.mjs`.

## Codex Progress: CAP-1 Document Renderer Static/Runtime Preflight

Progress date: 2026-05-11.

Scope completed:
- Added `docs/architecture/document-renderer-boundary.md`.
- Added `scripts/verify-document-renderer-contract.mjs`.
- Added `scripts/verify-document-renderer-runtime.mjs`.
- Wired both verifiers into `scripts/check-manifest.mjs` and `check:fast`.
- No product source file was moved or refactored in this preflight.

Boundary locked:
- Current owner remains `src/service/action_tools/tools/document-renderer.mjs`.
- Future owner `src/service/capabilities/tools/document-renderer.mjs` must remain
  absent until the separate physical move phase.
- `generate_document` keeps tool id, artifact kinds, `file_write` capability,
  no-confirmation behavior, preview sidecar metadata, reversibility metadata,
  and PDF fallback metadata.
- `document-renderer.mjs` stays a renderer helper: it must not own
  `createActionResult`, desktop renderer imports, Electron main/tray imports,
  or provider/model calls.

Runtime coverage added:
- `renderDocumentPreviewHtml` is executed for `docx`, `pdf`, `pptx`, and `xlsx`.
- Preview HTML is checked for local Mermaid assets, no CDN usage, escaped text,
  and sanitized SVG figures where SVG rendering is supported.
- `renderDocument` is executed for DOCX, XLSX, and PPTX, with ZIP headers checked.
- Unsupported direct `renderDocument({ kind: "pdf" })` is rejected so PDF/HTML
  fallback ownership stays in `generate_document`.
- `generate_document(html)` is executed and checked for artifact path,
  `preview_html_path`, reversibility metadata, diagram rendering, and sanitized
  SVG rendering.

Verification run by Codex:
- `node --check scripts/verify-document-renderer-contract.mjs`: passed.
- `node --check scripts/verify-document-renderer-runtime.mjs`: passed.
- `node scripts/verify-document-renderer-contract.mjs`: passed.
- `node scripts/verify-document-renderer-runtime.mjs`: passed.
- `node scripts/verify-check-runner.mjs`: passed.

Decision:
- Document-renderer static and runtime preflight is ready to commit.
- After this commit, the next valid step is a separate physical move of only
  `document-renderer.mjs`.
- Do not move `mermaid-assets.mjs` or `svg-sanitize.mjs` in the same commit.
- Do not open CAP-2 yet.

Next physical-move requirements:
- Move only `src/service/action_tools/tools/document-renderer.mjs` to
  `src/service/capabilities/tools/document-renderer.mjs`.
- Update `index.mjs` dynamic imports for `renderDocumentPreviewHtml` and
  `renderDocument`.
- Update `document-renderer.mjs` relative imports to continue using the existing
  old-owner `mermaid-assets.mjs` and `svg-sanitize.mjs`.
- Update behavior tests and verifiers that import `document-renderer.mjs`.
- Update capability roots, tool-registry moved-path guards, stale-owner guards,
  and architecture inventories.
- Leave no compatibility barrel at the old path.

## Codex Progress: CAP-1 Document Renderer Physical Move

Progress date: 2026-05-11.

Scope completed:
- Moved `src/service/action_tools/tools/document-renderer.mjs` to
  `src/service/capabilities/tools/document-renderer.mjs`.
- Updated `generate_document` dynamic imports in
  `src/service/action_tools/tools/index.mjs`.
- Updated Kimi preview rendering import in `src/service/executors/kimi/output-format.mjs`.
- Updated behavior tests and document-renderer runtime verifier imports.
- Updated `scripts/verify-document-renderer-contract.mjs` to lock moved owner
  and old-path absence.
- Updated `scripts/verify-tool-registry-snapshot.mjs`,
  `scripts/verify-capability-roots.mjs`, and
  `scripts/verify-stale-owner-paths.mjs`.
- Updated architecture inventories and `docs/architecture/document-renderer-boundary.md`.

Migration result:
- Current owner: `src/service/capabilities/tools/document-renderer.mjs`.
- Old owner: `src/service/action_tools/tools/document-renderer.mjs` is absent.
- No compatibility barrel was left at the old path.
- `mermaid-assets.mjs` and `svg-sanitize.mjs` remain in
  `src/service/action_tools/tools/` and are intentionally imported by relative
  path until their own phases.
- No tool ids, artifact kinds, IPC channels, HTTP routes, storage schema,
  provider ids, approval behavior, or public registry ids were changed.

Verification run by Codex so far:
- `node --check src/service/capabilities/tools/document-renderer.mjs`: passed.
- `node --check src/service/action_tools/tools/index.mjs`: passed.
- `node --check src/service/executors/kimi/output-format.mjs`: passed.
- `node --check scripts/verify-document-renderer-contract.mjs`: passed.
- `node --check scripts/verify-document-renderer-runtime.mjs`: passed.
- `node scripts/verify-document-renderer-contract.mjs`: passed.
- `node scripts/verify-document-renderer-runtime.mjs`: passed.
- `node scripts/verify-tool-registry-snapshot.mjs`: passed.
- `node scripts/verify-capability-roots.mjs`: passed.
- `node scripts/verify-stale-owner-paths.mjs`: passed.
- `node scripts/verify-doc-references.mjs`: passed.
- `node --test tests/behavior/document-diagram-components.test.mjs tests/behavior/svg-artifact-components.test.mjs`: passed, 7/7.
- `node scripts/verify-doc-renderer-arg-length.mjs`: passed.
- `node scripts/verify-action-tools.mjs`: passed.
- `node scripts/verify-file-reversibility-checkpoint.mjs`: passed.
- `node scripts/verify-artifact-generation-invariant.mjs`: passed, 59/59.
- `node scripts/verify-artifact-surface-snapshot.mjs`: passed.
- `node scripts/verify-artifact-sandbox-invariants.mjs`: passed.
- `node scripts/verify-artifact-recovery-hook.mjs`: passed, 49/49.
- `node scripts/verify-artifact-transform-flows.mjs`: passed.
- `node scripts/verify-preview-window.mjs`: passed.
- `node scripts/verify-kimi-runtime.mjs`: skipped live Kimi runtime because
  credentials are invalid or expired.
- `node scripts/verify-file-kimi.mjs`: passed.
- `npm run check:fast`: passed, 79/79.
- `npm run verify:desktop-gui-smoke`: passed, 44/44.

Decision:
- Document-renderer physical move is complete after full validation.
- Do not start CAP-2 until `mermaid-assets.mjs` and `svg-sanitize.mjs` have
  their own boundary review and migration decisions.
- Next candidate should be `svg-sanitize.mjs` static/runtime security preflight,
  because both `document-renderer.mjs` and `render_svg` depend on its sanitizer.

## Codex Progress: CAP-1 SVG Sanitize Static/Runtime Preflight

Progress date: 2026-05-11.

Scope completed:
- Added `docs/architecture/svg-sanitize-boundary.md`.
- Added `scripts/verify-svg-sanitize-contract.mjs`.
- Added `scripts/verify-svg-sanitize-runtime.mjs`.
- Wired both verifiers into `scripts/check-manifest.mjs` and `check:fast`.
- No product source file was moved or refactored in this preflight.

Boundary locked:
- Current owner remains `src/service/action_tools/tools/svg-sanitize.mjs`.
- Future owner `src/service/capabilities/tools/svg-sanitize.mjs` must remain
  absent until the separate physical move phase.
- The sanitizer stays an import-free pure helper: no filesystem, network,
  Electron, renderer, provider, or runtime calls.
- `render_svg`, document preview SVG components, and tool-call validation all
  continue to depend on the same sanitizer helper.

Runtime coverage added:
- Direct `sanitizeSvgMarkup` and `isSafeSvgMarkup` checks for invalid input,
  XML/doctype removal, forbidden element removal, event handler removal,
  javascript URL removal, and xlink namespace removal.
- `RENDER_SVG_TOOL` rejection for unsafe non-SVG input.
- `RENDER_SVG_TOOL` writes sanitized standalone SVG artifacts with
  `image/svg+xml` metadata.
- Document preview embedded SVG output is sanitized.

Verification run by Codex:
- `node --check scripts/verify-svg-sanitize-contract.mjs`: passed.
- `node --check scripts/verify-svg-sanitize-runtime.mjs`: passed.
- `node scripts/verify-svg-sanitize-contract.mjs`: passed.
- `node scripts/verify-svg-sanitize-runtime.mjs`: passed.
- `node scripts/verify-check-runner.mjs`: passed.
- `node scripts/verify-doc-references.mjs`: passed.
- `npm run check:fast`: passed, 81/81.

Decision:
- SVG sanitizer static/runtime preflight is ready to commit.
- After this commit, the next valid step is a separate physical move of only
  `svg-sanitize.mjs`.
- Do not move `mermaid-assets.mjs` in the same commit.

## Codex Progress: CAP-1 SVG Sanitize Physical Move

Progress date: 2026-05-11.

Scope completed:
- Moved `src/service/action_tools/tools/svg-sanitize.mjs` to
  `src/service/capabilities/tools/svg-sanitize.mjs`.
- Updated imports in `src/service/action_tools/tools/index.mjs`,
  `src/service/capabilities/tools/document-renderer.mjs`,
  `src/service/executors/tool_using/tool-call-validator.mjs`,
  `tests/behavior/svg-artifact-components.test.mjs`, and
  `scripts/verify-svg-sanitize-runtime.mjs`.
- Updated `scripts/verify-svg-sanitize-contract.mjs` to lock moved owner and
  old-path absence.
- Updated structure, capability roots, tool-registry, and stale-owner verifiers.
- Updated architecture inventories and SVG/document boundary docs.

Migration result:
- Current owner: `src/service/capabilities/tools/svg-sanitize.mjs`.
- Old owner: `src/service/action_tools/tools/svg-sanitize.mjs` is absent.
- No compatibility barrel remains.
- `mermaid-assets.mjs` remains the only old-owner render helper in
  `src/service/action_tools/tools/`.
- No tool ids, artifact kinds, IPC channels, HTTP routes, storage schema,
  provider ids, approval behavior, or public registry ids were changed.

Verification run by Codex so far:
- `node --check src/service/capabilities/tools/svg-sanitize.mjs`: passed.
- `node --check src/service/action_tools/tools/index.mjs`: passed.
- `node --check src/service/capabilities/tools/document-renderer.mjs`: passed.
- `node --check src/service/executors/tool_using/tool-call-validator.mjs`: passed.
- `node scripts/verify-svg-sanitize-contract.mjs`: passed.
- `node scripts/verify-svg-sanitize-runtime.mjs`: passed.
- `node scripts/verify-document-renderer-contract.mjs`: passed.
- `node scripts/verify-document-renderer-runtime.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `node scripts/verify-tool-registry-snapshot.mjs`: passed.
- `node scripts/verify-capability-roots.mjs`: passed.
- `node scripts/verify-stale-owner-paths.mjs`: passed.
- `node --test tests/behavior/svg-artifact-components.test.mjs tests/behavior/tool-call-validator-document.test.mjs`: passed, 16/16.
- `node scripts/verify-action-tools.mjs`: passed.
- `node scripts/verify-artifact-generation-invariant.mjs`: passed, 59/59.
- `node scripts/verify-artifact-surface-snapshot.mjs`: passed.
- `node scripts/verify-artifact-sandbox-invariants.mjs`: passed.
- `node scripts/verify-doc-references.mjs`: passed.
- `node scripts/verify-check-runner.mjs`: passed.
- `npm run check:fast`: passed, 81/81.
- `npm run verify:desktop-gui-smoke`: first run timed out waiting for the GUI
  smoke result after 30000ms; immediate rerun passed, 44/44.

Decision:
- SVG sanitizer physical move is complete after full validation.
- Do not open CAP-2 yet.
- Next candidate after this commit should be `mermaid-assets.mjs` static/runtime
  render-asset preflight, then a separate physical move if green.

## Codex Progress: CAP-1 Mermaid Assets Preflight

Progress date: 2026-05-11.

Scope completed:
- Added `docs/architecture/mermaid-assets-boundary.md` for the current
  Mermaid asset helper boundary.
- Added `scripts/verify-mermaid-assets-contract.mjs` to lock the current
  public API, local Mermaid bundle dependency, caller imports, and no-network /
  no-write contract before movement.
- Added `scripts/verify-mermaid-assets-runtime.mjs` to prove the generated
  script source stays local, the bundle exists, HTML escaping is preserved, and
  `render_diagram` plus document-preview Mermaid rendering still use the local
  asset.
- Wired both Mermaid verifiers into `scripts/check-manifest.mjs`.

Preflight result:
- `src/service/action_tools/tools/mermaid-assets.mjs` is still the current
  owner during this preflight.
- No product source file was moved in this commit.
- No compatibility barrel was introduced.
- No tool ids, artifact kinds, IPC channels, HTTP routes, storage schema,
  provider ids, approval behavior, or public registry ids were changed.

Verification run by Codex:
- `node --check scripts/verify-mermaid-assets-contract.mjs`: passed.
- `node --check scripts/verify-mermaid-assets-runtime.mjs`: passed.
- `node scripts/verify-mermaid-assets-contract.mjs`: passed.
- `node scripts/verify-mermaid-assets-runtime.mjs`: passed.
- `node scripts/verify-doc-references.mjs`: passed.
- `node scripts/verify-check-runner.mjs`: passed.
- `npm run check:fast`: passed, 83/83.

Decision:
- Mermaid static/runtime preflight is ready to commit.
- After this commit, the next valid step is a separate physical move of only
  `mermaid-assets.mjs`.
- The physical move must update action-tool aggregation, document renderer,
  Kimi output-format imports, behavior tests, ownership verifiers, structure
  verifiers, stale-owner checks, and architecture inventories in the same PR.

## Codex Progress: CAP-1 Mermaid Assets Physical Move

Progress date: 2026-05-11.

Scope completed:
- Moved `src/service/action_tools/tools/mermaid-assets.mjs` to
  `src/service/capabilities/tools/mermaid-assets.mjs`.
- Updated imports in `src/service/action_tools/tools/index.mjs`,
  `src/service/capabilities/tools/document-renderer.mjs`,
  `src/service/executors/kimi/output-format.mjs`,
  `tests/behavior/mermaid-local-assets.test.mjs`, and
  `scripts/verify-mermaid-assets-runtime.mjs`.
- Updated `scripts/verify-mermaid-assets-contract.mjs` to lock moved owner and
  old-path absence.
- Updated structure, capability roots, tool-registry, document-renderer, and
  stale-owner verifiers.
- Updated architecture inventories and Mermaid/document/SVG/skill-install
  boundary docs.

Migration result:
- Current owner: `src/service/capabilities/tools/mermaid-assets.mjs`.
- Old owner: `src/service/action_tools/tools/mermaid-assets.mjs` is absent.
- `src/service/action_tools/tools/` now contains only `index.mjs`.
- No compatibility barrel remains.
- No tool ids, artifact kinds, IPC channels, HTTP routes, storage schema,
  provider ids, approval behavior, or public registry ids were changed.

Verification run by Codex:
- `node --check src/service/capabilities/tools/mermaid-assets.mjs`: passed.
- `node --check src/service/action_tools/tools/index.mjs`: passed.
- `node --check src/service/capabilities/tools/document-renderer.mjs`: passed.
- `node --check src/service/executors/kimi/output-format.mjs`: passed.
- `node --check scripts/verify-mermaid-assets-contract.mjs`: passed.
- `node --check scripts/verify-mermaid-assets-runtime.mjs`: passed.
- `node scripts/verify-mermaid-assets-contract.mjs`: passed.
- `node scripts/verify-mermaid-assets-runtime.mjs`: passed.
- `node scripts/verify-document-renderer-contract.mjs`: passed.
- `node scripts/verify-document-renderer-runtime.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `node scripts/verify-tool-registry-snapshot.mjs`: passed.
- `node scripts/verify-capability-roots.mjs`: passed.
- `node scripts/verify-stale-owner-paths.mjs`: passed.
- `node --test tests/behavior/mermaid-local-assets.test.mjs tests/behavior/document-diagram-components.test.mjs`: passed, 6/6.
- `node scripts/verify-action-tools.mjs`: passed.
- `node scripts/verify-preview-window.mjs`: passed.
- `node scripts/verify-doc-references.mjs`: passed.
- `node scripts/verify-check-runner.mjs`: passed.
- `npm run check:fast`: first run failed at behavior aggregation with pass
  985 / fail 1 on `compound launch continues remaining independent targets
  after one target fails`; direct single-file rerun passed 19/19; full
  `npm run check:fast` rerun passed, 83/83.
- `npm run verify:desktop-gui-smoke`: passed, 44/44.

Decision:
- Mermaid asset helper physical move is complete after full validation.
- CAP-1 helper/high-risk wrapper moves are closed through Mermaid.
- Next work should not reopen moved helpers. The next valid direction is a
  preflight for extracting a remaining high-risk inline tool family from
  `src/service/action_tools/tools/index.mjs`, starting with a small,
  verifier-friendly family rather than schema/registry relocation.

## Codex Progress: Desktop Capture / GUI Inline Family Preflight

Progress date: 2026-05-11.

Scope completed:
- Added `docs/architecture/desktop-capture-gui-tools-boundary.md`.
- Added `scripts/verify-desktop-capture-gui-tools-contract.mjs`.
- Wired the verifier into `scripts/check-manifest.mjs`.

Preflight result:
- `take_screenshot`, `gui_find_element`, `gui_click`, and `gui_type_text`
  remain inline in `src/service/action_tools/tools/index.mjs`.
- No product source was moved.
- The verifier locks tool ids, schema references, risk levels, confirmation
  gates, required capabilities, Windows-only execution boundary, PowerShell
  screenshot helper path, PNG artifact metadata, and the inline GUI helper
  functions.

Verification run by Codex:
- `node --check scripts/verify-desktop-capture-gui-tools-contract.mjs`: passed.
- `node scripts/verify-desktop-capture-gui-tools-contract.mjs`: passed.
- `node scripts/verify-check-runner.mjs`: passed.
- `node scripts/verify-doc-references.mjs`: passed.
- `npm run check:fast`: passed, 84/84.

Decision:
- Screenshot / GUI inline-family preflight is complete.
- This preflight is sufficient to proceed with CAP-2 schema-only migration.
- Do not physically extract screenshot or GUI tools in CAP-2.

## Codex Progress: CAP-2 Action Tool Schemas Preflight

Progress date: 2026-05-11.

Scope completed:
- Added `docs/architecture/action-tool-schemas-boundary.md`.
- Added `scripts/verify-action-tool-schemas-contract.mjs`.
- Wired the verifier into `scripts/check-manifest.mjs`.

Preflight result:
- `ACTION_TOOL_SCHEMAS` remains at
  `src/service/action_tools/schemas/index.mjs`.
- No product source was moved.
- The verifier locks the public export, import-free schema-only shape, 61-key
  schema surface, key alignment with `BUILTIN_ACTION_TOOLS`, and the no-touch
  rule for registry/policy/types/inline tools.

Verification run by Codex:
- `node --check scripts/verify-action-tool-schemas-contract.mjs`: passed.
- `node scripts/verify-action-tool-schemas-contract.mjs`: passed.
- `node scripts/verify-check-runner.mjs`: passed.
- `node scripts/verify-doc-references.mjs`: passed.
- `npm run check:fast`: passed, 85/85.

Decision:
- CAP-2 schema preflight is complete.
- The next valid step is a separate physical move of only
  `src/service/action_tools/schemas/index.mjs` to
  `src/service/capabilities/schemas/index.mjs`.

## Codex Progress: CAP-2 Action Tool Schemas Physical Move

Progress date: 2026-05-11.

Scope completed:
- Moved `src/service/action_tools/schemas/index.mjs` to
  `src/service/capabilities/schemas/index.mjs`.
- Updated imports in the action-tool aggregator, capability-owned tool modules,
  action-tool verifier, capability behavior tests, and file-content specialty
  verifiers.
- Updated `scripts/verify-action-tool-schemas-contract.mjs` to lock moved
  owner and old-path absence.
- Updated structure, capability roots, tool registry, stale-owner, and
  architecture inventories.
- Fixed two stale file-content specialty verifier slice boundaries that still
  assumed `VERIFY_FILE_EXISTS_TOOL` was inline in `index.mjs`; current verified
  inline boundaries are search -> index and index -> register_artifact.

Migration result:
- Current owner: `src/service/capabilities/schemas/index.mjs`.
- Old owner: `src/service/action_tools/schemas/index.mjs` is absent.
- No compatibility barrel remains.
- Registry, types, risk matrix, policy guard, file reversibility, and remaining
  inline tool implementations were not moved.
- Tool ids, schema keys, confirmation gates, risk levels, artifact kinds, IPC
  channels, HTTP routes, provider ids, and storage schema were not changed.

Verification run by Codex:
- `node --check src/service/capabilities/schemas/index.mjs`: passed.
- `node --check src/service/action_tools/tools/index.mjs`: passed.
- `node --check src/service/capabilities/tools/browser-web-tools.mjs`: passed.
- `node --check src/service/capabilities/tools/os-app-tools.mjs`: passed.
- `node --check src/service/capabilities/tools/scheduler-tools.mjs`: passed.
- `node --check src/service/capabilities/tools/file-read-tools.mjs`: passed.
- `node --check src/service/capabilities/tools/vision-analyze.mjs`: passed.
- `node --check src/service/capabilities/tools/email-tools.mjs`: passed.
- `node scripts/verify-action-tool-schemas-contract.mjs`: passed.
- `node scripts/verify-tool-registry-snapshot.mjs`: passed.
- `node scripts/verify-capability-roots.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `node scripts/verify-stale-owner-paths.mjs`: passed.
- `node scripts/verify-action-tools.mjs`: passed.
- `node --test tests/behavior/capability-draft-tool.test.mjs tests/behavior/capability-save-tool.test.mjs`: passed, 19/19.
- `node scripts/verify-file-content-search-tool.mjs`: passed.
- `node scripts/verify-file-content-index-tool.mjs`: passed.
- `node scripts/verify-file-content-index-ui.mjs`: passed.
- `node scripts/verify-artifact-generation-invariant.mjs`: passed, 59/59.
- `node scripts/verify-artifact-surface-snapshot.mjs`: passed.
- `node scripts/verify-artifact-sandbox-invariants.mjs`: passed.
- `node scripts/verify-desktop-capture-gui-tools-contract.mjs`: passed.
- `node scripts/verify-vision-analyze-contract.mjs`: passed.
- `node scripts/verify-vision-analyze-runtime.mjs`: passed.
- `node scripts/verify-doc-references.mjs`: passed.
- `node scripts/verify-check-runner.mjs`: passed.
- `npm run check:fast`: passed, 85/85.
- `npm run verify:desktop-gui-smoke`: first run timed out waiting for the GUI
  smoke result after 30000ms; immediate rerun passed, 44/44.

Decision:
- CAP-2 schema-only migration is complete after full validation.
- Do not reopen schema owner or recreate `src/service/action_tools/schemas/`.
- Next valid phase is CAP-3 preflight for registry/types/risk/policy ownership,
  not a physical CAP-3 move without verifier coverage.

## Codex Review: CAP-3 Registry/Policy Static Preflight

Date: 2026-05-11

Scope:
- Added CAP-3 preflight boundary documentation for action-tool registry,
  result/type, risk, policy, and file-reversibility safety contracts.
- Added `scripts/verify-action-tool-registry-contract.mjs` and wired it into
  both full and fast check manifests.
- Did not move, rename, or refactor product source files.
- Did not change tool ids, tool order, confirmation gates, schemas, artifact
  kinds, IPC channels, HTTP routes, provider ids, storage schema, or runtime
  behavior.

Preflight locked:
- `createActionToolRegistry` register/get/list/evaluate/call behavior.
- 61 built-in action tool ids in current order.
- Confirmation-gated id snapshot.
- `createActionResult` output shape.
- `ACTION_TOOL_RISK_LEVELS`, `evaluateToolRisk`, policy guard, default rate
  limits, and rate-limit usage helpers.
- File reversibility export presence.
- No Electron main/preload/renderer/desktop imports in registry/type/risk/policy
  owner files.

Verification run by Codex:
- `node --check scripts/verify-action-tool-registry-contract.mjs`: passed.
- `node scripts/verify-action-tool-registry-contract.mjs`: passed.
- `node scripts/verify-check-runner.mjs`: passed.

Decision:
- CAP-3 preflight is ready for commit.
- Next valid step after committing this preflight is the CAP-3 physical move of
  registry/type/risk/policy only:
  - create `src/service/capabilities/registry/`;
  - move `registry.mjs`, `types.mjs`, `risk_matrix.mjs`, and
    `policy-guard.mjs`;
  - update every active import in product code, tests, scripts, and docs;
  - update `verify-action-tool-registry-contract.mjs`,
    `verify-capability-roots.mjs`, `verify-tool-registry-snapshot.mjs`,
    `verify-stale-owner-paths.mjs`, `verify-structure.mjs`, and inventories;
  - prove old owner files are absent and no compatibility barrels remain;
  - keep `file-reversibility.mjs` out of the physical move unless the phase is
    explicitly expanded with artifact/file-recovery verifier coverage.

## Codex Review: CAP-3 Registry/Policy Physical Move

Date: 2026-05-11

Scope:
- Moved action-tool registry/type/risk/policy owners to
  `src/service/capabilities/registry/`.
- Updated product imports in service core, executors, scheduler, connectors,
  MCP bridge, capability-owned tool modules, and the remaining action-tool
  aggregator.
- Updated tests, scripts, architecture inventories, capability-root verifier,
  structure verifier, stale-owner verifier, and tool-registry verifier.
- Left `src/service/action_tools/file-reversibility.mjs` in place intentionally;
  it remains a file/artifact recovery surface and needs its own move phase if
  moved later.

Migration result:
- Current owner: `src/service/capabilities/registry/registry.mjs`.
- Current result/type owner: `src/service/capabilities/registry/types.mjs`.
- Current risk owner: `src/service/capabilities/registry/risk_matrix.mjs`.
- Current policy owner: `src/service/capabilities/registry/policy-guard.mjs`.
- Old owner files under `src/service/action_tools/` are absent.
- No compatibility barrels remain.
- Tool ids, tool order, confirmation gates, schema keys, artifact kinds, IPC
  channels, HTTP routes, provider ids, storage schema, and action result shape
  were not changed.

Additional verifier cleanup:
- `scripts/verify-agentic-parity.mjs` now matches the current finalization
  contract using `selectSuccessContractValidationSpec(task)` before
  `validateSuccessContract(validationSpec, validatorTranscript)`.
- `scripts/verify-call-tool-envelope-unwrap.mjs` now matches the current
  framework behavior: direct `call_tool` envelopes are unwrapped before registry
  lookup; truly unknown tool ids still end in readable `partial_success`.

Verification run by Codex:
- `node scripts/verify-action-tool-registry-contract.mjs`: passed.
- `node scripts/verify-tool-registry-snapshot.mjs`: passed.
- `node scripts/verify-capability-roots.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `node scripts/verify-stale-owner-paths.mjs`: passed.
- `node scripts/verify-action-tools.mjs`: passed.
- `node scripts/verify-tool-policy-guard.mjs`: passed, 20/20.
- `node scripts/verify-file-reversibility-checkpoint.mjs`: passed.
- `node scripts/verify-approval-gate.mjs`: passed.
- `node scripts/verify-unified-connectors.mjs`: passed.
- `node scripts/verify-connector-workflow-dispatcher.mjs`: passed.
- `node scripts/verify-workflow-first-dispatch.mjs`: passed.
- `node scripts/verify-agentic-step-gate.mjs`: passed, 13/13.
- `node scripts/verify-agentic-planner.mjs`: passed.
- `node scripts/verify-agentic-parity.mjs`: passed, 10/10.
- `node scripts/verify-call-tool-envelope-unwrap.mjs`: passed, 10/10.
- `node --test tests/behavior/action-tool-submission.test.mjs tests/behavior/agent-loop-confirmation-gate.test.mjs tests/behavior/agent-loop-error-budget.test.mjs tests/behavior/agent-loop-phase-gate.test.mjs tests/behavior/agent-loop-sequencing.test.mjs tests/behavior/file-reversibility-checkpoint.test.mjs`: passed, 47/47.
- `node --test tests/behavior/capability-draft-tool.test.mjs tests/behavior/capability-save-tool.test.mjs tests/behavior/read-file-text-tool.test.mjs tests/behavior/local-file-fresh-read-contract.test.mjs`: passed, 55/55.
- `node scripts/verify-security-broker.mjs`: passed.
- `node scripts/verify-policy-group-expansion.mjs`: passed, 26/26.
- `npm run check:fast`: passed, 86/86.
- `npm run verify:desktop-gui-smoke`: passed, 44/44.

Decision:
- CAP-3 physical move is ready to commit.
- Next valid direction after CAP-3 commit is CAP-4 planning/preflight, not a
  broad move of skills/MCP/connectors/providers without per-family boundaries.

## Codex Review: CAP-4A Skills Surface Static Preflight

Date: 2026-05-11

Scope:
- Added `docs/architecture/skill-surface-boundary.md`.
- Added `scripts/verify-skill-surface-contract.mjs` and wired it into full and
  fast check manifests.
- Did not move, rename, or refactor product source files.
- Did not change tool ids, IPC channels, HTTP routes, artifact kinds, provider
  ids, storage schema, or runtime behavior.

Preflight locked:
- Current skill runtime owner remains `src/service/ai/skills/` until the
  physical CAP-4A move.
- Public skill exports remain available from builtin, discovery,
  github-install, install-state, lifecycle, registry-validation, and registry
  modules.
- Skill owner files do not import desktop, Electron, renderer, provider, MCP, or
  connector implementation modules.
- Desktop UI/view-model files do not import skill runtime internals.
- Skill install action tools still delegate to `stageSkillFromGitHub`,
  `finalizeStagedInstall`, and `discardStagedInstall`.
- Editable skill helpers still delegate to lifecycle helpers.
- `/ai/skills` remains a service HTTP route contract.
- User-installed skill data must not live under `src/`.

Verification run by Codex:
- `node --check scripts/verify-skill-surface-contract.mjs`: passed.
- `node scripts/verify-skill-surface-contract.mjs`: passed.
- `node scripts/verify-check-runner.mjs`: passed.
- `npm run check:fast`: passed, 87/87.

Decision:
- CAP-4A preflight is ready to commit.
- Next valid step after committing this preflight is the CAP-4A physical move:
  - create `src/service/capabilities/skills/`;
  - move all files from `src/service/ai/skills/` into that owner;
  - update every active import in product code, tests, scripts, and docs;
  - update `verify-skill-surface-contract.mjs`, `verify-capability-roots.mjs`,
    `verify-structure.mjs`, `verify-stale-owner-paths.mjs`, and inventories;
  - prove `src/service/ai/skills/` is gone or contains no reachable
    implementation files;
  - do not leave compatibility barrels once callers are migrated.

## Codex Review: CAP-4A Skills Surface Physical Move

Date: 2026-05-11

Scope:
- Moved the skills runtime surface from the former service AI skill owner into
  `src/service/capabilities/skills/`.
- Updated active imports in product code, behavior tests, scripts, and
  architecture docs.
- Updated `verify-skill-surface-contract.mjs`,
  `verify-capability-roots.mjs`, `verify-structure.mjs`, and
  `verify-stale-owner-paths.mjs`.
- Removed the old owner directory rather than leaving a compatibility barrel.
- Did not change skill behavior, tool ids, IPC channels, HTTP routes, artifact
  kinds, provider ids, or storage schema.

Migration result:
- Current owner: `src/service/capabilities/skills/`.
- Old owner directory: absent.
- `/ai/skills` remains the HTTP route.
- Skill install action tools now import `../skills/github-install.mjs`.
- Editable-skill action helpers and config routes now import from
  `../../capabilities/skills/`.
- AI integration runtime now imports skill registry/discovery/builtin from
  `../../capabilities/skills/`.

Verification run by Codex:
- `node --check` on all moved skills modules and
  `scripts/verify-skill-surface-contract.mjs`: passed.
- `node scripts/verify-skill-surface-contract.mjs`: passed.
- `node scripts/verify-capability-roots.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `node scripts/verify-stale-owner-paths.mjs`: passed.
- `node --test tests/behavior/skill-discovery-validation.test.mjs tests/behavior/skill-github-install.test.mjs tests/behavior/skill-lifecycle.test.mjs`: passed, 27/27.
- `node scripts/verify-skill-install-tools-contract.mjs`: passed.
- `node scripts/verify-skill-install-tools-runtime.mjs`: passed.
- `node scripts/verify-skill-install-tools.mjs`: passed, 65/65.
- `node scripts/verify-skill-install-approval-preview.mjs`: passed, 22/22.
- `node scripts/verify-skill-stage-finalize.mjs`: passed, 25/25.
- `node scripts/verify-skill-github-deeptree.mjs`: passed, 67/67.
- `node scripts/verify-skill-local-only-boundary.mjs`: passed.
- `node scripts/verify-service-core.mjs`: passed.
- `node scripts/verify-ai-integrations.mjs`: passed.
- `node scripts/verify-tool-registry-snapshot.mjs`: passed.
- `node scripts/verify-action-tools.mjs`: passed.
- `node scripts/verify-check-runner.mjs`: passed.
- `npm run check:fast`: passed, 87/87.
- `npm run verify:desktop-gui-smoke`: passed, 44/44.

Decision:
- CAP-4A physical move is ready to commit.
- After CAP-4A is committed, the next valid phase is CAP-4B MCP surface
  preflight, not a broad MCP/connectors/provider move.

## Codex Review: CAP-4B MCP Surface Static Preflight

Date: 2026-05-11

Scope:
- Added `docs/architecture/mcp-surface-boundary.md`.
- Added `scripts/verify-mcp-surface-contract.mjs` and wired it into full and
  fast check manifests.
- Did not move, rename, or refactor MCP product source files.
- Did not change MCP behavior, IPC channels, HTTP routes, tool ids, artifact
  kinds, provider ids, or storage schema.

Preflight locked:
- Current MCP runtime owner remains `src/service/ai/mcp/` until the physical
  CAP-4B move.
- Public MCP exports remain available from registry, builtin, configured,
  descriptor-validation, drafts, env-resolver, install-detection,
  install-execution, install-sandbox, auto-install, client-bridge, and internal
  server modules.
- MCP owner files do not import desktop, Electron, or renderer modules.
- Desktop UI/view-model files do not import MCP runtime internals.
- MCP install execution keeps using `spawnExternal`.
- External MCP tools remain wrapped through client-bridge/catalog/workflow
  dispatcher instead of direct prompt injection.
- `/ai/mcp`, `/ai/mcp/:id/toggle`, `/ai/mcp/:id/config`,
  `/config/mcp/servers`, `/config/mcp/test`, `/config/mcp/drafts/import`,
  `/config/mcp/install/plan`, `/config/mcp/install/preview`, and
  `/config/mcp/install/run` remain service HTTP contracts.

Verification run by Codex:
- `node --check scripts/verify-mcp-surface-contract.mjs`: passed.
- `node scripts/verify-mcp-surface-contract.mjs`: passed.
- `node scripts/verify-check-runner.mjs`: passed.
- `npm run check:fast`: passed, 88/88.

Decision:
- CAP-4B preflight is ready to commit.
- Next valid step after committing this preflight is the CAP-4B physical move:
  - create `src/service/capabilities/mcp/`;
  - move all files from `src/service/ai/mcp/` into that owner;
  - update every active import in product code, tests, scripts, and docs;
  - update `verify-mcp-surface-contract.mjs`, `verify-capability-roots.mjs`,
    `verify-structure.mjs`, `verify-service-core.mjs`,
    `verify-internal-mcp-server.mjs`, `verify-stale-owner-paths.mjs`, and
    inventories;
  - prove `src/service/ai/mcp/` is gone or contains no reachable
    implementation files;
  - do not leave compatibility barrels once callers are migrated.

## Codex Review: CAP-4B MCP Surface Physical Move

Date: 2026-05-11

Scope:
- Moved the MCP runtime surface from the former service AI MCP owner into
  `src/service/capabilities/mcp/`.
- Updated active imports in product code, behavior tests, scripts, and
  architecture docs.
- Updated `verify-mcp-surface-contract.mjs`, `verify-capability-roots.mjs`,
  `verify-structure.mjs`, `verify-service-core.mjs`,
  `verify-internal-mcp-server.mjs`, and `verify-stale-owner-paths.mjs`.
- Removed the old owner directory rather than leaving a compatibility barrel.
- Did not change MCP behavior, IPC channels, HTTP routes, tool ids, artifact
  kinds, provider ids, or storage schema.

Migration result:
- Current owner: `src/service/capabilities/mcp/`.
- Old owner directory: absent.
- `/ai/mcp` and `/config/mcp/*` HTTP contracts remain unchanged.
- MCP install/config/drafts routes now import from `../../capabilities/mcp/`.
- Planner, connector catalog bridge, workflow dispatcher, persistent runtime,
  and service bootstrap now import from the moved MCP owner.

Verification run by Codex:
- `node --check` on all moved MCP modules and
  `scripts/verify-mcp-surface-contract.mjs`: passed.
- `node scripts/verify-mcp-surface-contract.mjs`: passed.
- `node scripts/verify-capability-roots.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `node scripts/verify-stale-owner-paths.mjs`: passed.
- `node --test tests/behavior/mcp-env-resolver.test.mjs tests/behavior/mcp-drafts-route.test.mjs tests/behavior/mcp-config-route.test.mjs tests/behavior/mcp-install-sandbox.test.mjs tests/behavior/mcp-install-route.test.mjs tests/behavior/mcp-install-execution.test.mjs tests/behavior/mcp-install-detection.test.mjs`: passed, 48/48.
- `node scripts/verify-internal-mcp-server.mjs`: passed.
- `node scripts/verify-ai-integrations.mjs`: passed.
- `node scripts/verify-service-core.mjs`: passed.
- `node scripts/verify-planner-prefetch.mjs`: passed.
- `node scripts/verify-unified-connectors.mjs`: passed.
- `node scripts/verify-connector-workflow-dispatcher.mjs`: passed.
- `node scripts/verify-workflow-first-dispatch.mjs`: passed.
- `node scripts/verify-action-tools.mjs`: passed.
- `node scripts/verify-tool-registry-snapshot.mjs`: passed.
- `node scripts/verify-check-runner.mjs`: passed.
- `npm run check:fast`: first run had one non-reproduced behavior-test failure;
  immediate standalone `node scripts/verify-behavior-tests.mjs` passed, 986/986;
  rerun `npm run check:fast` passed, 88/88.
- `npm run verify:desktop-gui-smoke`: passed, 44/44.

Decision:
- CAP-4B physical move is ready to commit.
- After CAP-4B is committed, the next valid phase is CAP-4C connector surface
  preflight, not a broad connector/provider move.

## Codex Review: CAP-5H Closure And Post-Runtime Roadmap Tracking

Date: 2026-05-11

Status:
- CAP-5H moved the last inline action-tool family out of
  `src/service/action_tools/tools/index.mjs`.
- `index.mjs` is now a built-in action-tool aggregator/re-export surface only.
- `src/service/capabilities/tools/capability-creator-tools.mjs` owns
  `draft_capability` and `save_capability_draft`.
- `npm run check:fast` passed 96/96 after CAP-5H.

Post-runtime next board:
- Found and promoted `docs/architecture/post-runtime-upgrade-roadmap.md` as the
  tracked board for the next workstream.
- The roadmap now treats `FRAMEWORK_GAP_ANALYSIS.md` and
  `FUNCTION_AUDIT_AND_UPGRADE_PLAN.md` as historical background only, not the
  authority.
- The next board focuses on desktop experience completion, context/trace
  durability, plugin/MCP trust, sandbox governance, multi-model execution,
  optional sub-agent runtime, and long-term observability.
- Added `scripts/verify-post-runtime-roadmap.mjs` and wired it into full/fast
  checks so the roadmap remains visible.

Next valid work:
- Start `PX-001` from `docs/architecture/post-runtime-upgrade-roadmap.md`, then
  proceed in the recommended order unless a program-grounded audit changes the
  order.

## Codex Review: RV-001 Optional Git Checkpoint Mode

Date: 2026-05-12

Scope:
- Added optional git-backed checkpoint metadata for file mutation
  reversibility without changing the default file-level checkpoint behavior.
- New owner:
  `src/service/capabilities/tools/git-checkpoint-mode.mjs`.
- The mode is disabled unless a caller explicitly sets
  `ctx.reversibility.gitCheckpoint.enabled === true` or
  `ctx.gitCheckpoint.enabled === true`.
- When enabled inside a git repository, the service creates a non-worktree
  `stash_create_ref` checkpoint with `git stash create` and anchors it with
  `git update-ref`; this preserves the current worktree state and exposes a
  clear `restore_hint`.

Verification run by Codex:
- `node --check src/service/capabilities/tools/git-checkpoint-mode.mjs`: passed.
- `node --test tests/behavior/file-reversibility-checkpoint.test.mjs`: passed,
  9/9.
- `node scripts/verify-file-reversibility-checkpoint.mjs`: passed.
- `node scripts/verify-post-runtime-roadmap.mjs`: passed.
- `git diff --check`: passed.
- `npm run check:fast`: passed, 107/107 commands including 1000/1000 behavior
  tests.

Decision:
- RV-001 implementation is ready to commit.
- Next valid work after RV-001 commit is SA-001 sub-agent runtime contract
  preflight and implementation.

## Codex Review: SA-001 Sub-Agent Runtime Contract

Date: 2026-05-12

Scope:
- Added a service-owned sub-agent runtime contract at
  `src/service/core/subagents/sub-agent-runtime-contract.mjs`.
- Wired the contract service as `runtime.subAgentRuntime` through
  `src/service/core/task-runtime/runtime-services.mjs`.
- Documented the boundary in
  `docs/architecture/sub-agent-runtime-contract.md`.
- Added `scripts/verify-sub-agent-runtime-contract.mjs` and included it in
  full and fast check manifests.
- No Electron UI, IPC channels, HTTP routes, storage schema, tool ids,
  artifact kinds, provider ids, or model routing behavior changed.

Framework invariants:
- Disabled by default unless `subAgentRuntime` is explicitly feature-flagged.
- Delegation must be `planner_selected`; prompt-only delegation is rejected.
- Child allowed tools must be a subset of the parent allowed tool surface.
- Isolated compiled context includes only assigned context item ids.
- Budget checks cover tool calls, prompt tokens, runtime duration, and context
  item count.
- Parent cancellation propagates to child cancellation token/signal.
- Child result reports are structured and flag budget or tool-surface
  violations.

Verification run by Codex:
- `node --check src/service/core/subagents/sub-agent-runtime-contract.mjs`: passed.
- `node --check src/service/core/task-runtime/runtime-services.mjs`: passed.
- `node --check tests/behavior/sub-agent-runtime-contract.test.mjs`: passed.
- `node --check scripts/verify-sub-agent-runtime-contract.mjs`: passed.
- `node --test tests/behavior/sub-agent-runtime-contract.test.mjs`: passed,
  8/8.
- `node scripts/verify-sub-agent-runtime-contract.mjs`: passed.
- `node scripts/verify-post-runtime-roadmap.mjs`: passed.
- `node scripts/verify-check-runner.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `git diff --check`: passed.
- `npm run check:fast`: passed, 108/108 commands including 1008/1008 behavior
  tests.

Decision:
- SA-001 service contract is ready to commit.
- Next valid work after SA-001 commit is SA-002 sub-agent UI/evals.

## Codex Review: SA-002 Sub-Agent UI, Trace, And Eval Coverage

Date: 2026-05-12

Scope:
- Added shared child-run timeline summary:
  `src/shared/sub-agent-timeline-summary.mjs`.
- Added console task detail panel:
  `renderSubAgentTimelinePanel` in
  `src/desktop/renderer/console-task-detail.mjs`.
- Added child task summaries to the existing task detail response in
  `src/service/core/http-routes/task-routes.mjs`; no new route was added.
- Added delegation eval corpus and deterministic evaluator:
  `src/service/core/evals/sub-agent-delegation-corpus.mjs`.
- Added `scripts/verify-sub-agent-ui-evals.mjs` and included it in full and
  fast check manifests.
- No automatic sub-agent delegation, new IPC channels, new HTTP routes, storage
  schema changes, tool id changes, provider changes, or model routing changes.

Verification run by Codex:
- `node --check` on changed SA-002 modules/tests/verifier: passed.
- `node --test tests/behavior/sub-agent-timeline-evals.test.mjs`: passed, 5/5.
- `node scripts/verify-sub-agent-ui-evals.mjs`: passed.
- `node scripts/verify-post-runtime-roadmap.mjs`: passed.
- `node scripts/verify-check-runner.mjs`: passed.
- `node scripts/verify-task-trace-timeline.mjs`: passed.
- `node scripts/verify-desktop-renderer.mjs`: passed.
- `node scripts/verify-console-rendered-workspace.mjs`: passed.
- `node scripts/verify-ui-extras.mjs`: passed.
- `git diff --check`: passed.
- `npm run check:fast`: passed, 109/109 commands including 1013/1013 behavior
  tests.
- `npm run verify:desktop-gui-smoke`: first run failed at
  `overlay_task_list_keyboard_open_failed`; immediate rerun passed 49/49. The
  failed check is in overlay task-list keyboard smoke, while SA-002 changed
  console task detail/sub-agent timeline surfaces and did not touch overlay.

Decision:
- SA-002 is ready to commit.
- Next valid work after SA-002 commit is MM-001 model-role binding at real
  call sites, unless a further roadmap audit changes the order.

## Codex Review: MM-001 Model Role Call-Site Binding

Date: 2026-05-12

Scope:
- Added role-aware provider resolution in
  `src/service/executors/shared/provider-resolver.mjs`.
- Bound real planner call sites to the `planner` role:
  `src/service/executors/tool_using/agent-loop.mjs` and
  `src/service/executors/agentic/planner.mjs`.
- Bound the tool-using final composer to the `executor` role.
- Kept role routing disabled by default through
  `isModelRoleCallSiteRoutingEnabled`.
- Added model-role fields to `llm_usage` only when a role-aware descriptor is
  present, preserving default provider descriptor compatibility.
- No IPC channels, HTTP routes, storage schema, tool ids, artifact kinds,
  provider ids, or default model routing behavior changed.

Verification run by Codex:
- `node --check` on changed MM-001 modules/tests/verifier: passed.
- `node --test tests/behavior/model-role-routing.test.mjs`: passed, 6/6.
- `node scripts/verify-model-role-routing.mjs`: passed.
- `node scripts/verify-provider-routing.mjs`: passed.
- `node scripts/verify-llm-usage-emission.mjs`: passed.
- `node scripts/verify-real-llm-token-metrics.mjs`: passed.
- `node scripts/verify-agentic-planner.mjs`: passed.
- `node scripts/verify-agentic-parity.mjs`: passed.
- `node scripts/verify-post-runtime-roadmap.mjs`: passed.
- `git diff --check`: passed, with line-ending warnings only.
- `npm run check:fast`: passed, 109/109 commands including 1015/1015 behavior
  tests.

Issue found and fixed:
- `describeResolvedProvider()` initially returned disabled/null model-role
  fields by default, breaking exact provider descriptor contracts. It now emits
  model-role fields only when role routing actually annotated the provider.

Decision:
- MM-001 is ready to commit.
- Next valid work after MM-001 commit is MM-002 reviewer/voting-loop preflight.

## Codex Review: MM-002 Final-Answer Reviewer Loop

Date: 2026-05-12

Scope:
- Added `src/service/executors/tool_using/final-reviewer.mjs` as the
  service-owned reviewer pass for final answers.
- Wired `composeFinalAnswer()` to pass candidate answers through the reviewer
  seam after normal composition while keeping default behavior disabled.
- Reviewer loop requires explicit `reviewer_loop.enabled: true`, runs only for
  high-risk artifact, connector/side-effect, research-quality, or multi-source
  analysis tasks unless `mode: "always"` is set.
- Reviewer provider calls bind through `resolveProviderForModelRole("reviewer",
  "reviewer", ...)` and emit `llm_usage` at `tool_using.final_reviewer`.
- Reviewer verdicts cannot silently rewrite output; `revise` and `reject`
  append a visible `Reviewer note:` to the candidate answer.
- Candidate/transcript size gates and timeout gates prevent unbounded review
  work; reviewer failure returns the original candidate.

Verification run by Codex:
- `node --check` on changed MM-002 modules/tests/verifier: passed.
- `node --test tests/behavior/agent-loop-final-composer.test.mjs`: passed, 7/7.
- `node scripts/verify-final-answer-reviewer-loop.mjs`: passed.
- `node scripts/verify-provider-boundary.mjs`: passed after registering the
  new reviewer provider call site in the provider boundary inventory.
- `node scripts/verify-model-role-routing.mjs`: passed.
- `node scripts/verify-llm-usage-emission.mjs`: passed.
- `node scripts/verify-real-llm-token-metrics.mjs`: passed.
- `node scripts/verify-agentic-parity.mjs`: passed.
- `node scripts/verify-check-runner.mjs`: passed.
- `node scripts/verify-post-runtime-roadmap.mjs`: passed.
- `npm run check:fast`: passed, 110/110 commands including 1018/1018 behavior
  tests.

Issue found and fixed:
- The first full fast gate failed because the new reviewer module imported the
  provider resolver/adapter without being listed in `verify-provider-boundary`.
  The fix was to explicitly document and allow `final-reviewer.mjs` as a
  provider call site, preserving the boundary invariant.

Decision:
- MM-002 is ready to commit.
- Next valid work is PM-001 marketplace trust model preflight unless the user
  chooses to start sandbox/sidecar or observability first.

## Codex Review: PM-001 Marketplace Trust Model

Date: 2026-05-12

Scope:
- Added shared trust helpers in
  `src/service/capabilities/marketplace/trust-model.mjs`.
- Added `docs/architecture/marketplace-trust-model.md`.
- Skill registry entries, GitHub skill install previews, MCP statuses, and
  connector plugin records now expose additive `trustPreview` metadata.
- Skill install action metadata now surfaces `trust_preview` from the previewed
  staged install.
- Connector plugin registry now exposes `previewInstall()` so install UI can
  show trust state before copying plugin files.
- Existing install, enable, route, tool id, provider id, storage schema, IPC
  channel, and HTTP route behavior was intentionally unchanged.

Verification run by Codex:
- `node --check` on changed PM-001 modules/tests/verifier: passed.
- `node --test tests/behavior/marketplace-trust-model.test.mjs`: passed, 5/5.
- `node scripts/verify-marketplace-trust-model.mjs`: passed.
- `node scripts/verify-skill-surface-contract.mjs`: passed.
- `node scripts/verify-skill-local-only-boundary.mjs`: passed.
- `node scripts/verify-mcp-surface-contract.mjs`: passed.
- `node scripts/verify-plugin-registry.mjs`: passed.
- `node scripts/verify-check-runner.mjs`: passed.
- `node scripts/verify-post-runtime-roadmap.mjs`: passed.
- Direct `node scripts/verify-behavior-tests.mjs`: passed 1023/1023 after the
  first `check:fast` run reported one non-reproduced behavior aggregation
  failure.
- Rerun `npm run check:fast`: passed, 111/111 commands including 1023/1023
  behavior tests.

Issue found and handled:
- The first full `check:fast` failed inside behavior-test aggregation with one
  failure, but direct behavior aggregation immediately passed 1023/1023 and the
  full fast-gate rerun passed. Treat this as a watched stability signal, not a
  PM-001 product-code blocker.

Decision:
- PM-001 is ready to commit.
- Next valid work is PM-002 external MCP governance preflight.

## Codex Review: PM-002 External MCP Governance

Date: 2026-05-12

Scope:
- Added service-owned external MCP governance in
  `src/service/capabilities/mcp/governance.mjs`.
- External MCP servers now carry governance metadata and are blocked with
  `governance_blocked` when they try to reuse LingxY OAuth/account/connector
  token refs instead of isolated MCP token refs.
- Configured MCP status, MCP registry status, and external MCP catalog discovery
  all apply the same governance rule before surfacing availability or connect
  candidates.
- External MCP remains catalog-only and confirmation-required by default.
- No IPC channels, HTTP routes, tool ids, artifact kinds, provider ids, storage
  schema, or default internal MCP behavior changed.

Verification run by Codex:
- `node --check` on changed PM-002 modules/tests/verifier: passed.
- `node --test tests/behavior/mcp-governance.test.mjs`: passed, 6/6.
- `node scripts/verify-mcp-governance-policy.mjs`: passed.
- `node scripts/verify-post-runtime-roadmap.mjs`: passed.
- `node scripts/verify-mcp-surface-contract.mjs`: passed.
- `node scripts/verify-marketplace-trust-model.mjs`: passed.
- `node scripts/verify-plugin-registry.mjs`: passed.
- `node scripts/verify-check-runner.mjs`: passed.
- First `npm run check:fast` reported 2 behavior aggregation failures, but
  direct `node scripts/verify-behavior-tests.mjs` immediately passed
  1029/1029 and the full `npm run check:fast` rerun passed 112/112 including
  1029/1029 behavior tests.

Issue found and handled:
- The first behavior aggregation failure did not reproduce. Treat this as a
  watched stability signal, not a PM-002 product-code blocker.

Decision:
- PM-002 is ready to commit.
- Next valid work is PM-003 sharing/signatures/archive-cleanup preflight unless
  sandbox/sidecar decision records are prioritized.

## Codex Review: PM-003 Marketplace Distribution Policy

Date: 2026-05-12

Scope:
- Added normalized marketplace distribution policy in
  `src/service/capabilities/marketplace/distribution-policy.mjs`.
- Trust preview now exposes normalized distribution metadata and treats raw
  third-party signatures as `unverified` until verifier-marked `verified: true`.
- Connector plugin preview/install/list/uninstall records now expose
  `distribution.signature`, `distribution.shareable`, and
  `distribution.archive`.
- Installed plugin uninstall now archives the plugin directory under
  `<plugins>/.archive/` and removes it from active plugin roots so connector
  catalog reload cannot keep stale runnable tools/workflows.
- Updated plugin lifecycle docs and roadmap tracking. No IPC channels, HTTP
  routes, tool ids, artifact kinds, provider ids, or storage schema changed.

Verification run by Codex:
- `node --check` on changed PM-003 modules/tests/verifier: passed.
- `node --test tests/behavior/marketplace-distribution-policy.test.mjs`:
  passed, 5/5.
- `node scripts/verify-marketplace-distribution-policy.mjs`: passed.
- `node scripts/verify-plugin-registry.mjs`: passed.
- `node scripts/verify-marketplace-trust-model.mjs`: passed.
- `node scripts/verify-post-runtime-roadmap.mjs`: passed.
- `npm run check:fast`: passed, 113/113 commands including 1034/1034 behavior
  tests.

Decision:
- PM-003 is ready to commit.
- Phase G marketplace foundation is complete at the service-contract level.
- Next valid work is Phase H sandbox/sidecar/security export decision-record
  preflight, starting with SH-001.

## Codex Review: SH-001/SH-002 Sandbox And Sidecar Decision Records

Date: 2026-05-12

Scope:
- Added service-owned isolation decision inventory and validators in
  `src/service/security/isolation-decision-records.mjs`.
- Added `docs/architecture/os-sandbox-decision-records.md` with current
  decisions for file operations, external commands, browser automation, OCR,
  audio daemons, and MCP install sandbox.
- Added `docs/architecture/sidecar-decision-record.md` as the mandatory
  template before any new native helper, long-running daemon, sidecar, or
  OS-level sandbox.
- Added `scripts/verify-sandbox-decision-records.mjs` and
  `tests/behavior/isolation-decision-records.test.mjs`.
- No new sidecar, OS sandbox, IPC channel, HTTP route, tool id, provider id,
  storage schema, or runtime behavior change was introduced.

Verification run by Codex:
- `node --check` on changed SH modules/tests/verifier: passed.
- `node --test tests/behavior/isolation-decision-records.test.mjs`: passed,
  4/4.
- `node scripts/verify-sandbox-decision-records.mjs`: passed.
- `node scripts/verify-privacy-sandbox-policy.mjs`: passed.
- `npm run check:fast`: passed, 114/114 commands including 1038/1038 behavior
  tests.

Decision:
- SH-001 and SH-002 are ready to commit.
- Next valid work is SH-003 audit export and policy trace.

## Codex Review: SH-003 Audit Export And Policy Trace

Date: 2026-05-12

Scope:
- Added redacted policy trace export builder in
  `src/service/security/policy-trace-export.mjs`.
- Runtime export and diagnostic bundles now include bounded `policyTrace`
  summaries for blocked policy decisions, redaction events, kill switch /
  presenter mode events, pending approvals, and policy-relevant task events.
- Added `docs/architecture/security-policy-trace-export.md`,
  `scripts/verify-policy-trace-export.mjs`, and
  `tests/behavior/policy-trace-export.test.mjs`.
- No IPC channels, HTTP routes, tool ids, artifact kinds, provider ids,
  storage schema, desktop UI behavior, or runtime execution behavior changed.

Verification run by Codex:
- `node --check` on changed SH-003 modules/tests/verifier: passed.
- `node --test tests/behavior/policy-trace-export.test.mjs`: passed, 4/4.
- `node scripts/verify-policy-trace-export.mjs`: passed.
- `node scripts/verify-post-runtime-roadmap.mjs`: passed.
- `npm run check:fast`: passed, 115/115 commands including 1042/1042 behavior
  tests.

Issue found and handled:
- Two earlier `npm run check:fast` attempts reported a behavior aggregation
  mismatch with no visible failing TAP item. Direct
  `node scripts/verify-behavior-tests.mjs` passed 1042/1042, and the final full
  `npm run check:fast` rerun passed 115/115. Treat as a watched stability signal
  rather than an SH-003 product-code blocker.

Decision:
- SH-003 is ready to commit.
- Phase H sandbox/security export foundation is complete at the service-contract
  level.
- Next valid work is OQ-001 eval trend store.

## Codex Review: OQ-001 Eval Trend Store

Date: 2026-05-12

Scope:
- Added append-only real-LLM eval trend helpers in
  `scripts/real-llm-test/trend-store.mjs`.
- Wired `scripts/real-llm-test/run-corpus.mjs` to append compact
  `eval-trends.jsonl` rows and render a `## Trend` section with previous-run
  deltas.
- Added `scripts/verify-eval-trend-store.mjs` and
  `tests/behavior/eval-trend-store.test.mjs`.
- Updated the post-runtime roadmap and check manifest.
- No product runtime behavior, IPC channels, HTTP routes, tool ids, artifact
  kinds, provider ids, storage schema, or desktop UI behavior changed.

Verification run by Codex:
- `node --check` on changed OQ-001 modules/tests/verifier: passed.
- `node --test tests/behavior/eval-trend-store.test.mjs`: passed, 2/2.
- `node scripts/verify-eval-trend-store.mjs`: passed.
- `node scripts/verify-eval-quality-metrics.mjs`: passed.
- `node scripts/verify-post-runtime-roadmap.mjs`: passed.
- `node scripts/verify-check-runner.mjs`: passed.
- `npm run check:fast`: passed, 116/116 commands including 1044/1044 behavior
  tests.

Testing note:
- No live API call was required for OQ-001 because the change sits after corpus
  execution and only persists deterministic report summaries. The target tests
  exercise JSONL append/read and previous-run delta behavior directly.

Decision:
- OQ-001 is ready to commit.
- Next valid work is OQ-002 span taxonomy and optional OTEL export preflight.

## Codex Review: OQ-002 Span Taxonomy And Optional OTEL Export

Date: 2026-05-12

Scope:
- Added shared task span taxonomy in `src/shared/task-span-taxonomy.mjs`.
- Updated `src/shared/task-trace-summary.mjs` to consume the shared phase/span
  classifier while preserving existing trace panel phase behavior.
- Added local OTEL-shaped export records through `buildTaskSpanExport()` using
  `local_otel_span_v1`; this is a deterministic export shape only and does not
  send telemetry over the network.
- Added `scripts/verify-task-span-taxonomy.mjs` and
  `tests/behavior/task-span-taxonomy.test.mjs`.
- Updated the post-runtime roadmap and check manifest.
- No product runtime execution behavior, IPC channels, HTTP routes, tool ids,
  artifact kinds, provider ids, storage schema, or desktop UI behavior changed.

Issue found and handled:
- Initial taxonomy classified `tool_call_completed` with `success:false` as a
  recovery phase, which broke the existing Tools phase failure count. The
  classifier now keeps tool events in the tool phase and records failure through
  the phase failure counter, preserving existing trace panel behavior.

Verification run by Codex:
- `node --check` on changed OQ-002 modules/tests/verifier: passed.
- `node --test tests/behavior/task-span-taxonomy.test.mjs tests/behavior/task-trace-summary.test.mjs`:
  passed, 5/5.
- `node scripts/verify-task-span-taxonomy.mjs`: passed.
- `node scripts/verify-task-trace-timeline.mjs`: passed.
- `node scripts/verify-post-runtime-roadmap.mjs`: passed.
- `node scripts/verify-check-runner.mjs`: passed.
- `npm run check:fast`: passed, 117/117 commands including 1046/1046 behavior
  tests.

Decision:
- OQ-002 is ready to commit.
- The post-runtime roadmap's tracked phases are complete through OQ-002. Next
  work should either extend the roadmap with the next user-visible capability
  tranche or begin a new execution board for desktop experience/plugin sandbox
  maturity.

## Codex Review: MR-001 Memory Review History And Undo

Date: 2026-05-12

Scope:
- Added `docs/architecture/post-runtime-maturity-roadmap.md` as the next
  tracked execution board for desktop experience, plugin/sandbox/multi-model,
  capability-management, memory, and operations maturity work after OQ-002.
- Added bounded memory governance `reviewHistory` records for proposal approval,
  proposal rejection, and approved-memory deletion in
  `src/service/memory/user-profile.mjs`.
- Added `undoMemoryReview()` service behavior and the desktop-actor-only HTTP
  route `POST /config/user-memory/reviews/:reviewId/undo`.
- Updated the desktop console memory panel to render recent review history and
  call the shared runtime user-memory client for undo actions.
- Updated route ownership inventory and verifiers so the new route is locked by
  the same contract gates as the existing user-memory routes.

Contract notes:
- This intentionally adds one HTTP route and one persisted user-memory profile
  field, `reviewHistory`.
- No IPC channels, tool ids, artifact kinds, provider ids, or runtime execution
  behavior changed.
- Saving editable user/project memory now preserves existing review history when
  the incoming payload omits it, preventing the UI save path from erasing the
  governance audit trail.

Verification run by Codex:
- `node --check` on changed MR-001 modules/tests/verifiers: passed.
- `node --test tests/behavior/runtime-user-memory-client.test.mjs tests/behavior/user-memory-profile.test.mjs`:
  passed, 9/9.
- `node scripts/verify-memory-review-history.mjs`: passed.
- `node scripts/verify-post-runtime-maturity-roadmap.mjs`: passed.
- `node scripts/verify-user-memory-profile.mjs`: passed.
- `node scripts/verify-memory-governance.mjs`: passed.
- `node scripts/verify-desktop-renderer.mjs`: passed.
- `node scripts/verify-console-runtime-client.mjs`: passed.
- `node scripts/verify-http-route-inventory.mjs`: passed.
- `node scripts/verify-renderer-runtime-client-consolidation.mjs`: passed.
- `npm run check:fast`: passed, 119/119 commands including 1047/1047 behavior
  tests.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `git diff --check`: passed; only existing line-ending normalization warnings
  were reported.

Issue found and handled:
- The first full check exposed the new undo route in the HTTP regex count; the
  HTTP inventory and snapshot verifier were updated to lock the new contract.
- The renderer runtime-client consolidation verifier still asserted the old
  user-memory test title and was updated to require the save/proposal/delete/undo
  mutation contract.
- Two console `check:fast` attempts showed a behavior-test aggregate mismatch
  while the same behavior suite passed directly. A redirected full `check:fast`
  run completed cleanly at 119/119, so this remains a watched test-output
  stability signal rather than an MR-001 code blocker.

Decision:
- MR-001 is ready to commit.
- Next recommended work is MR-002: add project-scope memory review filters and
  clearer review-history scoping in the desktop memory panel, building on the
  review history foundation instead of creating a parallel memory surface.

## Codex Review: MR-002 Memory Scope Filters

Date: 2026-05-12

Scope:
- Added service-owned memory governance filtering in
  `src/service/memory/user-profile.mjs` for approved memory, proposals, and
  review history by scope, project id, conversation id, and artifact id.
- Prevented project/conversation/artifact-scoped reviewed memory from entering
  task background context when the task has no matching scope id.
- Added scope identity to new memory review records so renderer filtering does
  not have to infer durable governance state from display text.
- Added Console memory filters for scope, project id, and conversation id while
  keeping the renderer as a view-only consumer of loaded user-memory data.
- Added `scripts/verify-memory-scope-filters.mjs` and updated the maturity
  roadmap/check manifest.

Contract notes:
- This intentionally changes context selection behavior: global memory may still
  be injected without a project, but project/conversation/artifact memory now
  requires matching scope context.
- No IPC channels, HTTP routes, tool ids, artifact kinds, provider ids, or
  provider calls changed.
- No service imports were added to renderer code.

Verification run by Codex:
- `node --check` on changed MR-002 modules/tests/verifier: passed.
- `node --test tests/behavior/user-memory-profile.test.mjs`: passed, 10/10.
- `node scripts/verify-memory-scope-filters.mjs`: passed.
- `node scripts/verify-post-runtime-maturity-roadmap.mjs`: passed.
- `node scripts/verify-user-memory-profile.mjs`: passed.
- `node scripts/verify-memory-review-history.mjs`: passed.
- `node scripts/verify-memory-governance.mjs`: passed.
- `node scripts/verify-desktop-renderer.mjs`: passed.
- `node scripts/verify-console-runtime-client.mjs`: passed.
- `node scripts/verify-renderer-runtime-client-consolidation.mjs`: passed.
- `npm run check:fast`: passed, 120/120 commands including 1049/1049 behavior
  tests.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `git diff --check`: passed; only existing line-ending normalization warnings
  were reported.

Decision:
- MR-002 is ready to commit.
- Next recommended work is PM-004 marketplace management UI, because trust,
  governance, and distribution policy verifiers already exist and the remaining
  gap is making those states visible/actionable in Console.

## Codex Review: PM-004 Marketplace Management UI

Date: 2026-05-12

Scope:
- Added a Console Marketplace Governance panel covering skills, MCP servers, and
  plugins.
- Displayed existing service-provided `trustPreview`, signature state, archive
  state, warning ids, and MCP governance allow/block state.
- Loaded `/plugins` into the workspace refresh cycle.
- Made plugins actionable through the existing `/plugins/:id/enabled` and
  `DELETE /plugins/:id` routes for enable/disable and archive.
- Added `scripts/verify-marketplace-management-ui.mjs` and updated the maturity
  roadmap/check manifest.

Contract notes:
- No new HTTP route, IPC channel, tool id, artifact kind, provider id, provider
  call, or storage schema was introduced.
- Renderer code remains view/controller code over existing service contracts; it
  does not import marketplace, MCP, skill, or plugin service internals.

Verification run by Codex:
- `node --check` on changed PM-004 renderer/verifier files: passed.
- `node --test tests/behavior/marketplace-trust-model.test.mjs tests/behavior/marketplace-distribution-policy.test.mjs tests/behavior/mcp-governance.test.mjs`:
  passed, 16/16.
- `node scripts/verify-marketplace-management-ui.mjs`: passed.
- `node scripts/verify-marketplace-trust-model.mjs`: passed.
- `node scripts/verify-marketplace-distribution-policy.mjs`: passed.
- `node scripts/verify-mcp-governance-policy.mjs`: passed.
- `node scripts/verify-post-runtime-maturity-roadmap.mjs`: passed.
- `node scripts/verify-desktop-renderer.mjs`: passed.
- `node scripts/verify-console-runtime-client.mjs`: passed.
- `npm run check:fast`: passed, 121/121 commands including 1049/1049 behavior
  tests.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `git diff --check`: passed; only existing line-ending normalization warnings
  were reported.

Decision:
- PM-004 is ready to commit.
- Next recommended work is DX-006 Desktop product acceptance matrix: broaden
  manual/real GUI coverage for daily workflows beyond the current smoke gates.

## Codex Review: DX-006 Desktop Product Acceptance Matrix

Date: 2026-05-12

Scope:
- Added `docs/release/desktop_product_acceptance_matrix.md` as a daily desktop
  workflow acceptance gate above foundational smoke.
- Linked first-run setup, conversation continuity, task operations, artifacts,
  memory governance, marketplace governance, scheduler/approvals, connectors,
  browser/Office, native Windows entry, recovery, diagnostics, performance, and
  accessibility to automated gates and manual/real evidence.
- Linked the new matrix from `docs/release/functional_acceptance_matrix.md`.
- Added Marketplace governance to the manual release outcome rows.
- Added `verify:memory-review-history`, `verify:memory-scope-filters`, and
  `verify:marketplace-management-ui` npm scripts plus
  `scripts/verify-desktop-product-acceptance-matrix.mjs`.

Contract notes:
- This is a release/process gate and does not change runtime behavior, IPC
  channels, HTTP routes, tool ids, artifact kinds, provider ids, provider calls,
  or storage schema.
- The new matrix explicitly states that `npm run check:fast` alone is not enough
  for user-visible desktop workflow changes.

Verification run by Codex:
- `node scripts/verify-desktop-product-acceptance-matrix.mjs`: passed.
- `node scripts/verify-functional-acceptance.mjs`: passed.
- `node scripts/verify-user-interaction-smoke.mjs`: passed.
- `node scripts/verify-post-runtime-maturity-roadmap.mjs`: passed.
- `node scripts/verify-check-runner.mjs`: passed.
- `npm run verify:desktop-gui-smoke`: passed, 49/49 checks
  (`startup=491ms`, `first_window=491ms`, `interaction=5220ms`,
  `total=5705ms`).
- `npm run check:fast`: passed, 122/122 commands including 1049/1049 behavior
  tests.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `git diff --check`: passed; only existing line-ending normalization warnings
  were reported.

Decision:
- DX-006 is ready to commit.
- Remaining maturity-board items are SA-003 and SH-004. Recommended next work is
  SA-003 planner-selected delegation enablement audit, because it can stay
  mostly verifier/eval driven before changing runtime delegation behavior.

## Codex Review: SA-003 Planner-Selected Delegation Enablement Audit

Date: 2026-05-12

Scope:
- Added `src/service/core/evals/sub-agent-delegation-enablement-audit.mjs` as a
  machine-readable audit for future sub-agent enablement.
- Added `docs/architecture/planner-selected-delegation-enablement-audit.md` to
  document eligible classes, forbidden classes, required gates, and the current
  disabled-by-default decision.
- Added `tests/behavior/sub-agent-delegation-enablement-audit.test.mjs` and
  `scripts/verify-sub-agent-delegation-enablement-audit.mjs`.
- Updated the maturity roadmap, architecture README, package scripts, and check
  manifest.

Contract notes:
- This phase does not enable automatic planner delegation.
- Eligible classes are audit-only and still require a future feature flag:
  `delegate_parallel_research`, `delegate_isolated_file_review`, and
  `delegate_bounded_qa`.
- Simple tasks, high-risk mutations, and private-context categories remain
  forbidden.
- No runtime behavior, IPC channel, HTTP route, tool id, artifact kind, provider
  id, provider call, storage schema, or renderer behavior changed.

Verification run by Codex:
- `node --check` on changed SA-003 modules/tests/verifier: passed.
- `node --test tests/behavior/sub-agent-delegation-enablement-audit.test.mjs`:
  passed, 3/3.
- `node scripts/verify-sub-agent-delegation-enablement-audit.mjs`: passed.
- `node scripts/verify-sub-agent-runtime-contract.mjs`: passed.
- `node scripts/verify-sub-agent-ui-evals.mjs`: passed.
- `node scripts/verify-post-runtime-maturity-roadmap.mjs`: passed.
- `node scripts/verify-check-runner.mjs`: passed.
- `npm run check:fast`: passed, 123/123 commands including 1052/1052 behavior
  tests.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `git diff --check`: passed; only existing line-ending normalization warnings
  were reported.

Decision:
- SA-003 is ready to commit.
- Remaining maturity-board item is SH-004 OS sandbox implementation decision.

## Codex Review: SH-004 OS Sandbox Implementation Decision

Date: 2026-05-12

Scope:
- Added `src/service/security/os-sandbox-implementation-decision.mjs` as the
  service-owned implementation decision derived from current isolation decision
  records.
- Added `docs/architecture/os-sandbox-implementation-decision.md`,
  `tests/behavior/os-sandbox-implementation-decision.test.mjs`, and
  `scripts/verify-os-sandbox-implementation-decision.mjs`.
- Updated the maturity roadmap, architecture README, package script, and check
  manifest.

Decision:
- No new OS sandbox is introduced in SH-004.
- Current boundaries remain: service in-process for file operations,
  child-process lanes for external commands and MCP install sandbox,
  browser/extension process boundary for browser automation, external daemon
  contract for audio, and measured candidate status for OCR extractors.
- Future OS sandbox work must update the isolation record, implementation
  decision, behavior tests, and verifier in the same change, with measured
  evidence before changing boundaries.

Contract notes:
- No runtime behavior, IPC channel, HTTP route, tool id, artifact kind,
  provider id, provider call, storage schema, or renderer behavior changed.
- Real API, GUI, hardware, or packaged-build tests were not required because
  SH-004 is deterministic security policy/decision wiring, not a live boundary
  behavior change.

Verification run by Codex:
- `node --check` on changed SH-004 module/test/verifier files: passed.
- `node --test tests/behavior/os-sandbox-implementation-decision.test.mjs tests/behavior/isolation-decision-records.test.mjs tests/behavior/privacy-sandbox-policy.test.mjs`:
  passed, 14/14.
- `node scripts/verify-os-sandbox-implementation-decision.mjs`: passed.
- `node scripts/verify-sandbox-decision-records.mjs`: passed.
- `node scripts/verify-privacy-sandbox-policy.mjs`: passed.
- `node scripts/verify-post-runtime-maturity-roadmap.mjs`: passed.
- `node scripts/verify-check-runner.mjs`: passed.
- `npm run check:fast`: passed, 124/124 commands including 1057/1057 behavior
  tests.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `git diff --check`: passed; only existing line-ending normalization warnings
  were reported.

Decision:
- SH-004 is ready to commit.
- The current maturity board is now complete. Next valid work is to open the
  next tracked roadmap board for desktop experience, long-term plugin/sandbox,
  multi-model, capability management, and real-world acceptance gaps.

## Codex Update: Post Runtime Product Gap Roadmap

Date: 2026-05-12

Scope:
- Added `docs/architecture/post-runtime-product-gap-roadmap.md` as the tracked
  board for the remaining product gaps after the runtime upgrade and maturity
  boards.
- The board integrates desktop workflow completion, real provider/API
  acceptance, connector/OAuth acceptance, skills/MCP/plugin/capability
  management, sandbox evidence, multi-model management, context selection, and
  release evidence work.
- Added `scripts/verify-post-runtime-product-gap-roadmap.mjs` and wired the
  roadmap into architecture docs, package scripts, and full/fast check
  manifests.

Execution rule:
- These gaps should be integrated into the program as typed contracts,
  verifiers, UI/service owners, and real-environment evidence where needed;
  they should not remain as loose root-plan notes.

Next valid work:
- Start `DXR-001 Desktop evidence pack runner` so real GUI/API/connector
  evidence can be recorded consistently before broad product workflow changes.

## Codex Update: DXR-001 Desktop Evidence Pack Runner

Date: 2026-05-12

Scope:
- Added `src/shared/desktop-product-evidence-pack.mjs` as the shared evidence
  pack schema, builder, and validator.
- Added `docs/release/desktop_product_evidence_pack.md` plus
  `docs/release/evidence/desktop-product-evidence.template.json`.
- Added `tests/behavior/desktop-product-evidence-pack.test.mjs` and
  `scripts/verify-desktop-product-evidence-pack.mjs`.
- Linked the evidence pack from the desktop product acceptance matrix and
  release README.
- Marked PG-001 and DXR-001 complete in
  `docs/architecture/post-runtime-product-gap-roadmap.md`.

Contract notes:
- This is deterministic release/product evidence infrastructure; it does not
  change runtime behavior, IPC channels, HTTP routes, tool ids, artifact kinds,
  provider ids, storage schema, or renderer behavior.
- Real API, OAuth, Office, browser, hardware, packaged-build, and Electron GUI
  test results now have a shared redacted evidence-pack landing zone.

Verification run by Codex:
- `node --check` on new DXR-001 shared/test/verifier files: passed.
- `node --test tests/behavior/desktop-product-evidence-pack.test.mjs`:
  passed, 4/4.
- `node scripts/verify-desktop-product-evidence-pack.mjs`: passed.
- `node scripts/verify-post-runtime-product-gap-roadmap.mjs`: passed.
- `node scripts/verify-desktop-product-acceptance-matrix.mjs`: passed.
- `node scripts/verify-check-runner.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.

Next valid work:
- Start `DXR-002 Daily conversation/task/artifact GUI matrix`, because the
  evidence pack now gives real GUI runs a durable place to report results.

## Codex Update: DXR-002 Desktop GUI Daily Workflow Coverage

Date: 2026-05-12

Scope:
- Added `src/shared/desktop-gui-smoke-workflow-coverage.mjs` to group real
  Electron GUI smoke checks by daily workflow.
- Added `docs/architecture/desktop-gui-daily-workflow-coverage.md`,
  `tests/behavior/desktop-gui-smoke-workflow-coverage.test.mjs`, and
  `scripts/verify-desktop-gui-daily-workflow-coverage.mjs`.
- Marked DXR-002 complete in the product gap roadmap for the current covered
  real smoke workflows: conversation continuity, task operations, and artifact
  workflow.

Contract notes:
- This locks existing real Electron smoke checks into a product workflow matrix;
  it does not change IPC channels, HTTP routes, tool ids, artifact kinds,
  provider ids, storage schema, or runtime behavior.
- The next visible desktop workflow phase must either add new real smoke checks
  or update this coverage contract in the same change.

Verification run by Codex:
- `node scripts/verify-desktop-gui-daily-workflow-coverage.mjs`
- `node --test tests/behavior/desktop-gui-smoke-workflow-coverage.test.mjs`
- `npm run verify:desktop-gui-smoke`
- The first real GUI smoke run exposed a transient
  `overlay_task_list_keyboard_open_failed`; Codex hardened the smoke runner by
  retrying the same task-list keyboard-open path with a refocused dock and Enter
  fallback when Space does not open the panel.
- `npm run verify:desktop-gui-smoke`: passed, 49/49 checks
  (`startup=468ms`, `first_window=468ms`, `interaction=5053ms`,
  `total=5514ms`).
- `npm run check:fast`: passed, 127/127 commands including 1064/1064 behavior
  tests.

## Codex Update: CAPM-001 Capability Inventory Manager

Date: 2026-05-12

Scope:
- Added `src/service/capabilities/inventory/capability-inventory.mjs` as the
  service-owned typed capability ledger for built-in tools, skills, MCP
  servers, connector plugins, connector tools, providers/model roles, and
  user-created drafts.
- Exposed `GET /capabilities/inventory` through `ai-status-routes.mjs` and the
  service endpoint manifest.
- Updated Console marketplace management to consume the service inventory
  first, without importing service internals from renderer code.
- Added `docs/architecture/capability-inventory-manager.md`,
  `scripts/verify-capability-inventory-manager.mjs`, and
  `tests/behavior/capability-inventory-manager.test.mjs`.
- Marked CAPM-001 complete in
  `docs/architecture/post-runtime-product-gap-roadmap.md`.

Contract notes:
- Existing mutation owners remain unchanged: MCP toggles/config, plugin
  enable/archive, skills, providers, and connector catalog routes still own
  their behavior.
- The inventory is secret-free and carries explicit owner, target layer, trust,
  policy, enabled, archive/recovery, and management metadata.
- Renderer code calls `/capabilities/inventory`; it does not read
  `src/service/**` directly.

Verification run by Codex:
- `node --test tests/behavior/capability-inventory-manager.test.mjs`: passed,
  3/3.
- `node scripts/verify-capability-inventory-manager.mjs`: passed.
- `node scripts/verify-http-route-inventory.mjs`: passed.
- `node scripts/verify-marketplace-management-ui.mjs`: passed.
- `node scripts/verify-runtime-wiring.mjs`: passed and hit
  `/capabilities/inventory` on a real local runtime.
- `npm run verify:desktop-gui-smoke`: passed, 49/49 checks
  (`startup=474ms`, `first_window=474ms`, `interaction=5240ms`,
  `total=5710ms`).
- `npm run check:fast`: passed, 128/128 commands including 1067/1067 behavior
  tests.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `git diff --check`: passed with line-ending warnings only.

Next valid work:
- Start `CAPM-002 Capability creation lifecycle`: templates, dry-run
  validation, install preview, approval, activation, archive/recover, and no
  auto-run of untrusted installed code.

## Codex Update: CAPM-002 Capability Creation Lifecycle

Date: 2026-05-12

Scope:
- Added `src/service/capabilities/lifecycle/capability-creation-lifecycle.mjs`
  as the service-owned lifecycle contract for skills, MCP servers, and
  connector plugins.
- Exposed `GET /capabilities/lifecycle`.
- Added `POST /skills/install/github/preview`; GitHub skill install now
  requires `previewAccepted: true` before cloning.
- Added `POST /plugins/install/preview`; connector plugin installs now start
  disabled until an explicit `PATCH /plugins/:id/enabled`.
- Updated Console skill GitHub install to preview, show user confirmation, then
  install with preview acceptance.
- Added `docs/architecture/capability-creation-lifecycle.md`,
  `scripts/verify-capability-creation-lifecycle.mjs`, and
  `tests/behavior/capability-creation-lifecycle.test.mjs`.
- Updated the local HTTP surface inventory for previously uninventoried
  user-memory mutation routes while extending it for the new preview routes.

Contract notes:
- Capability creation now follows template/dry-run, install preview, user
  approval, activation, and archive/recovery stages.
- Untrusted connector plugins no longer become runnable immediately after
  install.
- Skill preview validates source shape and trust/policy impact without cloning
  or reading secrets.
- MCP keeps the existing plan/preview/run/draft-import/enable split.

Verification run by Codex:
- `node --test tests/behavior/capability-creation-lifecycle.test.mjs tests/behavior/local-mutation-guard.test.mjs`:
  passed, 46/46.
- `node scripts/verify-capability-creation-lifecycle.mjs`: passed.
- `node scripts/verify-plugin-registry.mjs`: passed.
- `node scripts/verify-http-route-inventory.mjs`: passed.
- `node scripts/verify-local-http-surface.mjs`: passed.
- `node scripts/verify-runtime-wiring.mjs`: passed and hit
  `/capabilities/lifecycle` on a real local runtime.
- `npm run verify:desktop-gui-smoke`: first attempt failed with the known
  `overlay_task_list_keyboard_open_failed` focus timing issue; immediate rerun
  passed 49/49 (`startup=542ms`, `first_window=542ms`, `interaction=5038ms`,
  `total=5577ms`).
- `npm run check:fast`: passed, 129/129 commands including 1070/1070 behavior
  tests.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `git diff --check`: passed with line-ending warnings only.

Next valid work:
- Start `LAPI-001 Live provider acceptance harness`, because CAPM-001 and
  CAPM-002 now cover the capability management foundation and the remaining
  product gaps move into opt-in real provider/OAuth/sandbox/model/context
  evidence.
