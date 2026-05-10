# Branch Status: task/uca-077-connector-foundation

**Date:** 2026-05-10

## Current Phase

Phase 2B.47 — Desktop GUI smoke runner extraction (next)

## Completed

- **Phase 2B.42** — Window lifecycle handler extraction → `desktop-window-lifecycle.mjs`
- **Phase 2B.43** — Shell window actions extraction → `desktop-window-actions.mjs`
- **Phase 2B.44** — Global shortcut router extraction → `desktop-shortcut-router.mjs`
- **Phase 2B.45** — Link browser window manager extraction → `desktop-link-browser-window.mjs`
- **Codex 2B.45 review fixes** — `verify-auto-updater.mjs` tightened to assert actual notify chain; orphaned link-browser comment removed
- **Phase 2B.46** — Preview window composition extraction → `desktop-preview-window-manager.mjs`

## Phase 2B.46 Details

- New module: `src/desktop/tray/desktop-preview-window-manager.mjs` (124 lines)
- Exports `createPreviewWindowManager(options)` returning `{ sendToPreview, getPreviewWindow, hidePreviewWindow, setPreviewWindowPinned }`
- Migrated: `computePreviewBounds()`, `ensurePreviewWindow()`, `showPreviewWindowIfHidden()`, `flushPreviewPending()`, `sendToPreview()`, preview pending queue, close handler (hide-not-destroy with `quitting` getter)
- Kept in electron-main.mjs: `registerPreviewIpc` composition, `openPreviewWindowForSmoke` assignment
- `electron-main.mjs`: 1958 → 1844 lines (-114 this phase; -699 total from original 2543)

## Verification

- GUI smoke: 44/44 checks pass (all preview checks: tool_input_delta_load, generate_document_initial_draft, draft_family_matrix, task_binding_isolation)
- `npm run check:fast`: 65/65 pass
- `verify-preview-window.mjs`: updated to check `desktop-preview-window-manager.mjs` for bounds/composition functions
- `verify-ipc-contract-inventory.mjs`: added `desktop-preview-window-manager.mjs` to `mainIpcHelperPaths`; send count updated 28 → 27

## Codex Review: Phase 2B.46

Reviewed 2026-05-10.

- Accepted: `desktop-preview-window-manager.mjs` is a proper owner extraction for preview BrowserWindow composition. It preserves lazy creation, centered bounds, hide-not-destroy close behavior, load-aware pending queue flush, pin state, and the `registerPreviewIpc` injection contract.
- Accepted: `electron-main.mjs` now composes the manager and keeps the public preview IPC/smoke hook wiring; no IPC channel, payload, preload bridge, HTTP route, tool id, artifact kind, provider id, or storage schema changed.
- Verification rerun by Codex:
  - `node --check src/desktop/tray/desktop-preview-window-manager.mjs`: pass
  - `node --check src/desktop/tray/electron-main.mjs`: pass
  - `node scripts/verify-preview-window.mjs`: pass
  - `node scripts/verify-ipc-contract-inventory.mjs`: pass
  - `node scripts/verify-main-process-blocking.mjs`: pass
  - `node scripts/verify-desktop-shell.mjs`: pass
  - `npm run check:fast`: pass 65/65
  - `npm run verify:desktop-gui-smoke`: pass 44/44
- Non-blocking verifier improvement: `verify-preview-window.mjs` should eventually assert that `electron-main.mjs` no longer owns `computePreviewBounds`, `ensurePreviewWindow`, or `previewPendingByChannel`, so future regressions cannot reintroduce parallel preview ownership.
- Phase 2B.47 can start. Keep it test-only: extract GUI smoke runner logic without changing check names, stdout prefix, JSON shape, perf fields, failure exit semantics, or production window/runtime behavior.
