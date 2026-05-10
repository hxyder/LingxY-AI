# Branch Status: task/uca-077-connector-foundation

**Date:** 2026-05-10

## Status: Phases 2B.42–2B.48 Submitted; Codex Review Requires One Verifier Follow-up

DeepSeek has committed the planned 2B.42-2B.48 extraction work and the 2B.47 GUI smoke scheduling code fix. Codex review accepts the product-code fix, but Phase 2B should not be closed until the scheduling-order invariant is locked in a verifier.

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
