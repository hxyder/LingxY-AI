# Branch Status: task/uca-077-connector-foundation

**Date:** 2026-05-10

## Current Phase

Phase 2B.47 review fixes — GUI smoke runner failure-path cleanup (blocking)

## Completed

- **Phase 2B.42** — Window lifecycle handler extraction → `desktop-window-lifecycle.mjs`
- **Phase 2B.43** — Shell window actions extraction → `desktop-window-actions.mjs`
- **Phase 2B.44** — Global shortcut router extraction → `desktop-shortcut-router.mjs`
- **Phase 2B.45** — Link browser window manager extraction → `desktop-link-browser-window.mjs`
- **Codex 2B.45 review fixes** — `verify-auto-updater.mjs` tightened to assert actual notify chain; orphaned link-browser comment removed
- **Phase 2B.46** — Preview window composition extraction → `desktop-preview-window-manager.mjs`
- **Phase 2B.47** — Desktop GUI smoke runner extraction → `desktop-gui-smoke-runner.mjs`

## Phase 2B.47 Details

- New module: `src/desktop/tray/desktop-gui-smoke-runner.mjs` (785 lines)
- Exports `createDesktopGuiSmokeRunner(options)` returning `{ runDesktopGuiSmoke }`
- Migrated: `writeDesktopGuiSmokeResult()`, `waitForDesktopGuiSmoke()`, `runDesktopGuiSmoke()` full check sequence (761 lines)
- Factory receives all dependencies injected (19 parameters): timing constant, window actions, shortcut registry, electron APIs, filesystem helpers, smoke hooks, notification bridge, popup card manager
- Factory call placed after all late-bound dependencies are assigned (after `openLinkBrowserForSmoke` assignment)
- Kept in electron-main.mjs: `DESKTOP_GUI_SMOKE_PROCESS_STARTED_AT` constant, `LINGXY_ELECTRON_GUI_SMOKE` env checks, `app.exit`/`app.quit` coordination
- `electron-main.mjs`: 1844 → 1104 lines (-740 this phase; -1439 total from original 2543)

## Verification

- GUI smoke: 44/44 checks pass (all check names, stdout format, JSON shape, perf fields unchanged)
- `npm run check:fast`: 65/65 pass
- Verifiers updated: `verify-task-llm-usage-ui.mjs`, `verify-desktop-gui-perf-smoke.mjs`, `verify-cancellation-propagation.mjs`, `verify-conversation-branch-contract.mjs`, `verify-user-interaction-smoke.mjs` — all smoke-related assertions moved from electron-main.mjs to desktop-gui-smoke-runner.mjs

## Codex Review: Phase 2B.47

Reviewed 2026-05-10.

- Accepted shape: `desktop-gui-smoke-runner.mjs` is the right owner for the GUI smoke check sequence. It preserves the 44 check names, `LINGXY_GUI_SMOKE_RESULT` stdout prefix, result JSON shape, perf fields, preview/link/popup smoke hooks, and injected Electron dependencies.
- Accepted placement: the factory is created after `openPreviewWindowForSmoke` and `openLinkBrowserForSmoke` are assigned, so those late-bound smoke hooks are available to the runner.
- Blocker before Phase 2B.48: `electron-main.mjs` still references `writeDesktopGuiSmokeResult(...)` in the outer `runDesktopGuiSmoke().catch(...)` failure path, but that helper was moved into `desktop-gui-smoke-runner.mjs` and is no longer in main scope. Normal successful GUI smoke passes, but an unexpected runner rejection would produce a secondary `ReferenceError` instead of the required `LINGXY_GUI_SMOKE_RESULT` failure payload.
- Required fix: either expose a small `writeDesktopGuiSmokeResult`/`writeFailureResult` helper from the runner factory and use it in the outer catch, or keep a tiny local failure writer in `electron-main.mjs`. Preserve the exact stdout prefix and JSON shape.
- Required verifier update: add a reverse assertion that `electron-main.mjs` does not reference migrated internal smoke helpers such as `writeDesktopGuiSmokeResult` or `waitForDesktopGuiSmoke` except through the factory return contract. Also assert the outer failure path still emits `LINGXY_GUI_SMOKE_RESULT` if it remains in main.
- Verification rerun by Codex:
  - `node --check src/desktop/tray/desktop-gui-smoke-runner.mjs`: pass
  - `node --check src/desktop/tray/electron-main.mjs`: pass
  - `node scripts/verify-desktop-gui-perf-smoke.mjs`: pass
  - `node scripts/verify-user-interaction-smoke.mjs`: pass
  - `node scripts/verify-cancellation-propagation.mjs`: pass
  - `node scripts/verify-conversation-branch-contract.mjs`: pass
  - `npm run verify:desktop-gui-smoke`: pass 44/44

Phase 2B.48 should not start until the dangling failure-path reference and verifier gap are fixed.
