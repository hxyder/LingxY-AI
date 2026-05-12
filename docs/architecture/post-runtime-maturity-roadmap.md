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
| MR-002 Memory project scope and review filters | pending | Approved/proposed memory can be filtered by scope/project/conversation without leaking unrelated scope. |
| SA-003 Planner-selected delegation enablement audit | pending | Existing sub-agent contract may be enabled only for eval-proven task classes with budget and trace gates. |
| PM-004 Marketplace management UI | pending | Skills/plugins/MCP trust, signature, archive, and governance state must be visible and actionable in Console. |
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
- `node --test tests/behavior/user-memory-profile.test.mjs`
- `node --test tests/behavior/runtime-user-memory-client.test.mjs`

## Recommended PR Order

1. MR-001: memory review history and undo.
2. MR-002: memory scope/review filters.
3. PM-004: marketplace management UI, because trust data already exists.
4. DX-006: product acceptance matrix expansion.
5. SA-003: planner-selected delegation enablement audit.
6. SH-004: OS sandbox implementation decision if measured evidence supports it.
