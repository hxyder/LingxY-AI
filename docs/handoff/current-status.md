# Branch Status: task/uca-077-connector-foundation

**Date:** 2026-05-10

## Status: Phases 2B.42–2B.48 Submitted; Codex Review Requires One 2B.47 Follow-up

DeepSeek has committed the planned 2B.42-2B.48 extraction work. Codex review accepts the general extraction direction and the Phase 2B.48 permission-handler move, but Phase 2B must not be closed until the 2B.47 GUI smoke runner startup-order issue below is fixed and verified.

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
- DeepSeek commits inspected: `15faf80`, `af684e3`, `e4c4d33`.
- Product source changed by DeepSeek, not by Codex in this review.
- Codex only updated planning/handoff notes.

Accepted:
- Phase 2B.48 `src/desktop/tray/desktop-permission-handler.mjs` is a focused Electron-main helper with explicit dependency injection.
- The permission handler is installed before window creation, preserving the previous Web Speech/media permission behavior surface.
- Phase 2B.47 now returns `writeDesktopGuiSmokeResult` from `createDesktopGuiSmokeRunner(...)`, so the previous dangling outer failure-path symbol has been addressed.

Required follow-up before Phase 2B closure or Phase 2C:
- Move the `LINGXY_ELECTRON_GUI_SMOKE` `setTimeout(() => runDesktopGuiSmoke(), 250)` registration until after `const { runDesktopGuiSmoke, writeDesktopGuiSmokeResult } = createDesktopGuiSmokeRunner(...)` has executed.
- Current code registers the timer before the runner is initialized, then performs additional startup work including dynamic `electron-updater` import. A slow import can let the timer fire while `runDesktopGuiSmoke` / `writeDesktopGuiSmokeResult` are still in the temporal dead zone. Normal GUI smoke passed on this machine, but the ordering is not a framework-safe invariant.
- Add or strengthen a verifier comment/assertion so future edits preserve the invariant: GUI smoke scheduling must happen after runner creation and after all required smoke dependencies have been assigned.

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

## Deferred

- `app.on("activate")` / `app.on("before-quit")` handlers remain in electron-main.mjs — they touch too many internal states to extract cleanly without disproportionate ceremony
- Recurring tray badge / morning digest timers (6 lines) — extraction ceremony outweighs benefit
