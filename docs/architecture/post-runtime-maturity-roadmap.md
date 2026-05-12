# Post Runtime Maturity Roadmap

This board starts after `docs/architecture/post-runtime-upgrade-roadmap.md`
completed its tracked phases through OQ-002. It is for product maturity gaps
that remain after the runtime spine, desktop boundaries, marketplace trust, and
observability contracts are in place.

Historical root plans remain background context only. This board is governed by
the current code, verifiers, behavior tests, GUI smoke gates, and the upgrade
protocol in `AGENTS.md`.

## Current Gate

- Current green gate: `npm run check:fast` passed 119/119 with 1047/1047
  behavior tests after MR-001.
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
| SA-003 Planner-selected delegation enablement audit | pending | Existing sub-agent contract may be enabled only for eval-proven task classes with budget and trace gates. |
| PM-004 Marketplace management UI | complete | Skills/plugins/MCP trust, signature, archive, and governance state must be visible and actionable in Console. |
| SH-004 OS sandbox implementation decision | pending | Convert decision records into implementation only where measured risk/benefit justifies process isolation. |
| DX-006 Desktop product acceptance matrix | pending | Broaden manual/real GUI acceptance for daily desktop workflows beyond foundational smoke. |

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

## Recommended PR Order

1. MR-001: memory review history and undo.
2. MR-002: memory scope/review filters.
3. PM-004: marketplace management UI, because trust data already exists.
4. DX-006: product acceptance matrix expansion.
5. SA-003: planner-selected delegation enablement audit.
6. SH-004: OS sandbox implementation decision if measured evidence supports it.

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
