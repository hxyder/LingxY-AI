# Post Runtime Maturity Roadmap

This board starts after `docs/architecture/post-runtime-upgrade-roadmap.md`
completed its tracked phases through OQ-002. It is for product maturity gaps
that remain after the runtime spine, desktop boundaries, marketplace trust, and
observability contracts are in place.

Historical root plans remain background context only. This board is governed by
the current code, verifiers, behavior tests, GUI smoke gates, and the upgrade
protocol in `AGENTS.md`.

## Current Gate

- Current green gate: `npm run check:fast` passed 124/124 with 1057/1057
  behavior tests after SH-004.
- The previous board's Tracking Register is complete; do not reopen completed
  phases without a new measured gap.

## Execution Standards

- Prefer framework invariants over local patches.
- Keep product behavior, IPC channels, HTTP routes, tool ids, artifact kinds,
  provider ids, and storage schema stable unless a phase explicitly owns a
  migration.
- Add targeted behavior tests or verifiers before broad wiring.
- Use real GUI/API/hardware tests only when the touched feature depends on
  those surfaces; deterministic service-level changes should use focused
  behavior tests plus `check:fast`.
- Retire old reachable paths when replacement paths are wired and verified.

## Tracking Register

| Phase | Status | Tracking rule |
| --- | --- | --- |
| MR-001 Memory review history and undo | complete | Memory proposal approve/reject/delete actions are reviewable and undoable typed governance records. |
| MR-002 Memory project scope and review filters | complete | Approved/proposed memory can be filtered by scope/project/conversation without leaking unrelated scope. |
| MR-003 Memory activity-history separation | complete | Routine task summaries are stored as bounded activity history and migrated out of the durable-memory Review Inbox. |
| SA-003 Planner-selected delegation enablement audit | complete | Existing sub-agent contract may be enabled only for eval-proven task classes with budget and trace gates. |
| PM-004 Marketplace management UI | complete | Skills/plugins/MCP trust, signature, archive, and governance state must be visible and actionable in Console. |
| SH-004 OS sandbox implementation decision | complete | Convert decision records into implementation only where measured risk/benefit justifies process isolation. |
| DX-006 Desktop product acceptance matrix | complete | Broaden manual/real GUI acceptance for daily desktop workflows beyond foundational smoke. |

## MR-001: Memory Review History And Undo

Status: complete as of 2026-05-12.

Scope:

- Add typed memory governance review history for proposal approval, proposal
  rejection, and approved-memory deletion.
- Add undo support for the latest review actions without silently injecting
  unreviewed memory.
- Surface review history and undo in Console Settings.
- Implemented in `src/service/memory/user-profile.mjs`, the
  `/config/user-memory/reviews/:id/undo` service route, and the shared renderer
  `runtime-user-memory-client`.

Acceptance:

- Approved memory is still injected only after review.
- Rejecting or deleting memory leaves an inspectable review record.
- Undoing approval removes the approved memory and returns the proposal to
  pending.
- Undoing rejection returns the proposal to pending.
- Undoing deletion restores the deleted approved memory.
- Saving editable profile/project memory must not erase review history.

Verification:

- `node scripts/verify-memory-review-history.mjs`
- `node scripts/verify-memory-scope-filters.mjs`
- `node --test tests/behavior/user-memory-profile.test.mjs`
- `node --test tests/behavior/runtime-user-memory-client.test.mjs`

## MR-002: Memory Project Scope And Review Filters

Status: complete as of 2026-05-12.

Scope:

- Add a service-owned governance filter for approved memory, proposals, and
  review history across `scope`, `projectId`, `conversationId`, and `artifactId`.
- Prevent project/conversation/artifact-scoped approved memory from being
  injected when the current task has no matching scope id.
- Persist scope identity on new memory review history records so filtering does
  not depend on renderer-only inference.
- Add Console memory-panel filters for scope, project id, and conversation id
  without importing service modules into the renderer.

Acceptance:

- Unscoped context still receives global reviewed memory.
- Unscoped context does not receive arbitrary project or conversation memory.
- Project-scoped filtering includes the selected project and excludes unrelated
  project memory/proposals/reviews.
- Conversation-scoped filtering includes the selected conversation and excludes
  project memory unless the user explicitly changes the filter.
- Renderer filtering is a view concern only; durable scope rules remain in
  `src/service/memory/user-profile.mjs`.

Verification:

- `node scripts/verify-memory-scope-filters.mjs`
- `node --test tests/behavior/user-memory-profile.test.mjs`

## MR-003: Memory Activity-History Separation

Status: complete as of 2026-05-16.

Scope:

- Upgrade user memory to schema v2 with a bounded `activityHistory` lane.
- Classify generated candidates before review so routine task-completion
  summaries do not become durable-memory approval noise.
- Migrate legacy pending `task_completion_summary` proposals into
  `activityHistory` during profile sanitization.
- Keep typed durable candidates available for the Review Inbox and explicit
  high-signal auto-approval.
- Surface Review Inbox and Activity History separately in Console Settings.

Acceptance:

- Pending routine task summaries do not appear in the Review Inbox.
- Activity history is scoped and filterable, but it is never injected as
  approved memory.
- Existing approved memory governance, review history, undo, and scoped
  background injection keep working.
- Saving Settings preserves activity history and review history.

Verification:

- `node scripts/verify-memory-governance.mjs`
- `node scripts/verify-user-memory-profile.mjs`
- `node scripts/verify-memory-scope-filters.mjs`
- `node --test tests/behavior/user-memory-profile.test.mjs`

## Recommended PR Order

1. MR-001: memory review history and undo.
2. MR-002: memory scope/review filters.
3. MR-003: memory activity-history separation.
4. PM-004: marketplace management UI, because trust data already exists.
5. DX-006: product acceptance matrix expansion.
6. SA-003: planner-selected delegation enablement audit.
7. SH-004: OS sandbox implementation decision if measured evidence supports it.

## PM-004: Marketplace Management UI

Status: complete as of 2026-05-12.

Scope:

- Add a Console Marketplace Governance panel for skills, plugins, and MCP
  servers.
- Display existing `trustPreview`, signature state, archive state, warnings,
  and MCP governance state without duplicating marketplace policy in renderer.
- Load existing `/plugins` registry data into the workspace refresh cycle.
- Make installed plugins actionable through existing enable/disable and archive
  routes.

Acceptance:

- Skills, MCP servers, and plugins are visible in one management surface.
- Third-party/unsigned/disabled/deleted warnings from service trust previews are
  visible.
- MCP governance allow/block state is visible.
- Plugin enable/disable and archive actions call existing service routes; no new
  HTTP route, IPC channel, tool id, artifact kind, provider id, or storage schema
  is introduced.

Verification:

- `node scripts/verify-marketplace-management-ui.mjs`
- `node scripts/verify-marketplace-trust-model.mjs`
- `node scripts/verify-marketplace-distribution-policy.mjs`
- `node scripts/verify-mcp-governance-policy.mjs`

## DX-006: Desktop Product Acceptance Matrix

Status: complete as of 2026-05-12.

Scope:

- Add `docs/release/desktop_product_acceptance_matrix.md` as the daily desktop
  workflow acceptance gate above foundational smoke.
- Tie first-run setup, conversation continuity, task operations, artifact
  workflow, memory governance, marketplace governance, scheduler/approvals,
  connectors, browser/Office, native Windows entry, recovery, diagnostics,
  performance, and accessibility to automated and manual evidence.
- Link the new matrix from the release functional acceptance matrix.
- Record marketplace governance as a release outcome row.

Acceptance:

- Visible desktop workflow changes must name row-specific verifier coverage and
  a manual/real evidence path.
- `check:fast` alone is explicitly insufficient for user-visible desktop
  workflow changes.
- Electron GUI smoke remains the real desktop UI gate when Electron is
  available.

Verification:

- `node scripts/verify-desktop-product-acceptance-matrix.mjs`
- `node scripts/verify-functional-acceptance.mjs`
- `node scripts/verify-user-interaction-smoke.mjs`

## SA-003: Planner-Selected Delegation Enablement Audit

Status: complete as of 2026-05-12.

Scope:

- Add a service eval audit for future planner-selected sub-agent enablement.
- Keep automatic delegation disabled by default.
- Declare only eval-proven positive classes eligible behind a future feature
  flag: `delegate_parallel_research`, `delegate_isolated_file_review`, and
  `delegate_bounded_qa`.
- Keep simple tasks, high-risk mutations, and private-context cases forbidden.
- Require budget, allowed-tool subset, context isolation, cancellation, trace,
  and feature-flag gates before runtime enablement.

Acceptance:

- No runtime planner delegation behavior changes in this phase.
- The audit is machine-readable and covered by behavior tests.
- The maturity board blocks any future enablement that skips eval, budget, or
  trace gates.

Verification:

- `node scripts/verify-sub-agent-delegation-enablement-audit.mjs`
- `node scripts/verify-sub-agent-runtime-contract.mjs`
- `node scripts/verify-sub-agent-ui-evals.mjs`
- `node --test tests/behavior/sub-agent-delegation-enablement-audit.test.mjs`

## SH-004: OS Sandbox Implementation Decision

Status: complete as of 2026-05-12.

Scope:

- Add a service-owned implementation decision for current high-risk isolation
  surfaces without adding a new OS sandbox.
- Derive the implementation decision from
  `src/service/security/isolation-decision-records.mjs` so every current
  isolation record must have a matching implementation decision.
- Keep file operations, external commands, browser automation, audio daemons,
  and MCP install sandbox on their current boundaries.
- Keep OCR extractors as a measured worker/child-process/OS-sandbox candidate
  until latency, memory, packaging, or binary-execution evidence justifies a
  stronger process boundary.

Acceptance:

- `noNewOsSandbox` remains true for the current program.
- Every current isolation decision has an implementation decision, required
  evidence before change, rollback path, and user recovery contract.
- OS sandboxing cannot be introduced as a general business-logic rewrite or a
  broad refactor without updating the decision record, behavior tests, and
  verifier in the same change.
- Real API, GUI, hardware, or packaged-build tests are required only when the
  changed boundary depends on those surfaces; deterministic policy changes stay
  covered by behavior tests and `check:fast`.

Verification:

- `node scripts/verify-os-sandbox-implementation-decision.mjs`
- `node scripts/verify-sandbox-decision-records.mjs`
- `node scripts/verify-privacy-sandbox-policy.mjs`
- `node --test tests/behavior/os-sandbox-implementation-decision.test.mjs`
