# Desktop App Layout Inventory

Phase REPO-1 inventory of current vs target desktop app directory layout.
Status: 2026-05-10. No physical moves yet; verifier-first only.

## Current Layout (`src/desktop/`)

```
src/desktop/
├── tray/                        # Main process (54 files)
│   ├── electron-main.mjs        # Composition root (~1000 lines, -58%)
│   ├── ipc/                     # 21 IPC modules (register-*-ipc.mjs)
│   ├── desktop-window-lifecycle.mjs   # Phase 2B.42
│   ├── desktop-window-actions.mjs     # Phase 2B.43
│   ├── desktop-shortcut-router.mjs    # Phase 2B.44
│   ├── desktop-link-browser-window.mjs # Phase 2B.45
│   ├── desktop-preview-window-manager.mjs # Phase 2B.46
│   ├── desktop-gui-smoke-runner.mjs   # Phase 2B.47 (test-only)
│   ├── desktop-permission-handler.mjs # Phase 2B.48
│   └── ... (30+ other helpers)
├── renderer/                    # Renderer windows + shared clients (80+ files)
│   ├── console.js/html          # Main console window
│   ├── overlay.js/html          # Overlay window
│   ├── dock.js/html             # Dock window
│   ├── popup-card.js/css/html   # Popup card window
│   ├── preview-window.js/html   # Preview window
│   ├── preload.cjs              # Preload bridge
│   ├── shared/                  # Shared renderer clients (5 files)
│   ├── preview/                 # Preview handlers
│   └── console/                 # Console-specific clients
├── shared/
│   └── manifest.mjs             # IPC channels + shell manifest
├── console/                     # Console view models (10 subdirs)
├── overlay/                     # Overlay view models
└── assets/                      # Brand assets
```

## Target Layout (long-term, per REPO-1 plan)

```
apps/desktop/
├── main/                  ← src/desktop/tray/ (composition root + helpers)
│   ├── electron-main.mjs  # unchanged entry point
│   ├── ipc/               ← src/desktop/tray/ipc/
│   └── ... (extracted helpers)
├── preload/               ← src/desktop/renderer/preload.cjs
├── renderer/              ← src/desktop/renderer/
│   ├── shared/            # shared renderer clients
│   ├── console/           # console window + sub-clients
│   ├── overlay/           # overlay window
│   ├── dock/              # dock window
│   ├── popup/             # popup card
│   └── preview/           # preview window
├── shell/                 ← src/desktop/tray/ shell helpers (7 extracted modules)
│   ├── desktop-window-lifecycle.mjs
│   ├── desktop-window-actions.mjs
│   ├── desktop-shortcut-router.mjs
│   ├── desktop-link-browser-window.mjs
│   ├── desktop-preview-window-manager.mjs
│   ├── desktop-permission-handler.mjs
│   └── ... (other shell helpers)
├── smoke/                 ← src/desktop/tray/desktop-gui-smoke-runner.mjs
├── shared/                ← src/desktop/shared/manifest.mjs
└── assets/                ← src/desktop/assets/
```

## Migration Sequence (each step is a separate PR)

1. **REPO-1.0** ✅ inventory + strengthen verifier (current step)
2. **REPO-1.1** — move smoke runner: `tray/desktop-gui-smoke-runner.mjs` → `smoke/`
3. **REPO-1.2** — move IPC modules: `tray/ipc/` → `main/ipc/`
4. **REPO-1.3** — move shell helpers: `tray/desktop-*.mjs` (7 files) → `shell/`
5. **REPO-1.4** — move renderer shared clients: `renderer/shared/` → `renderer/shared/` (path stable)
6. **REPO-1.5** — move renderer feature folders: reorganize `renderer/` sub-windows
7. **REPO-1.6** — add compatibility barrels at old paths, update all imports

## Contracts That Must Not Change

- Preload API (`window.ucaShell` method names, payload shapes, return shapes)
- IPC channel names (`IPC_CHANNELS` in `manifest.mjs`)
- Build config (`package.json` electron-builder paths, `index.cjs` entry)
- GUI smoke stdout format (`LINGXY_GUI_SMOKE_RESULT` prefix, JSON shape)
- `electron-main.mjs` import paths to helpers (updated during move, behavior unchanged)

## Verification

Each REPO-1 sub-phase must pass:
```powershell
node scripts/verify-ipc-contract-inventory.mjs
node scripts/verify-desktop-renderer.mjs
node scripts/verify-renderer-direct-runtime-calls.mjs
node scripts/verify-main-process-blocking.mjs
node scripts/verify-repository-directory-architecture.mjs
npm run verify:desktop-gui-smoke
npm run check:fast
```
