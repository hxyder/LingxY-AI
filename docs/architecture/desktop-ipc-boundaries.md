# Desktop IPC Boundaries

DX-002 locks Electron main IPC registration as a composition boundary.

## Decision

`src/desktop/tray/electron-main.mjs` owns Electron lifecycle composition,
window/tray construction, and dependency injection. It must not register
`ipcMain.handle(...)` or `ipcMain.on(...)` handlers inline.

IPC handlers live under `src/desktop/main/ipc/register-*.mjs`. Those modules
may normalize small request payloads and call injected desktop service-client
helpers, but they must not import `src/service/**` directly.

## Current State

- `electron-main.mjs` imports and calls extracted IPC registration modules.
- `src/desktop/main/ipc/` owns 112 IPC registrations.
- Public channel names stay in `src/desktop/shared/manifest.mjs` except for the
  documented hardcoded legacy desktop helper channels already tracked by the IPC
  inventory.
- Duplicate channel registration is forbidden.
- Large handler bodies are forbidden; normalization and runtime/service work
  must move behind focused helpers.

## Invariants

- Electron main process remains lifecycle and IPC composition only.
- IPC channel contract stability is the invariant, not that every handler stays
  in a single file.
- IPC modules inject service access through desktop service-client helpers.
- New IPC handlers must be discoverable under `src/desktop/main/ipc/`, unique,
  and small enough to review.

## Verification

- `node scripts/verify-desktop-ipc-boundaries.mjs`
- `node scripts/verify-ipc-contract-inventory.mjs`
- `node scripts/verify-main-process-blocking.mjs`
- `node scripts/verify-desktop-shell.mjs`
- `npm run verify:desktop-gui-smoke`
- `npm run check:fast`
