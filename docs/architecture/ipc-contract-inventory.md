# IPC Contract Inventory

Phase 2A boundary inventory for Electron IPC. This is a read-only snapshot of the current shell contract.

Status: verified against the current repository on 2026-05-09.

## Contract Source

| Surface | Path | Owner |
| --- | --- | --- |
| IPC channel constants | `src/desktop/shared/manifest.mjs` | Desktop shell |
| Main-process handlers and sends | `src/desktop/tray/electron-main.mjs` | Desktop shell |
| Preload bridge | `src/desktop/renderer/preload.cjs` | Desktop shell / renderer bridge |
| Renderer consumers | `src/desktop/renderer/**`, `src/desktop/console/**`, `src/desktop/overlay/**` | Desktop renderer |

## Snapshot

- IPC channel count: 115
- Main handler registration references: 107
- Main send references: 28
- Renderer invoke references: 108
- Renderer listener references: 22
- Hard-coded main IPC handler channels outside `IPC_CHANNELS`: 13

## Channel Groups

| Group | Examples | Owner |
| --- | --- | --- |
| Shell/window | `uca:shell-ready`, `uca:shell-show-window`, `uca:shell-hide-window`, `uca:shell-window-focused` | Desktop shell |
| Popup/preview | `uca:popup-card-show`, `uca:preview-window-show`, `uca:preview-window-delta` | Desktop shell and renderer bridge |
| Task/runtime | `uca:task-cancel`, `uca:task-retry`, `uca:task-delete`, `uca:context-preview-requested` | Service runtime via shell bridge |
| Config/provider/MCP | `uca:provider-save`, `uca:mcp-server-save`, `uca:routing-config-update` | Service runtime configuration via desktop shell |
| Skills/capability | `uca:skill-create`, `uca:skill-markdown-read`, `uca:skill-registry-save` | Service runtime configuration via desktop shell |
| Notes/projects/conversations | `uca:note-upsert`, `uca:project-files-attach`, `uca:notes-save` | Service runtime storage via desktop shell |
| Scheduler/DAG/templates | `uca:schedule-create`, `uca:dag-resume`, `uca:template-save` | Service runtime scheduler via desktop shell |
| Audio/Echo | `uca:echo-kws-detect`, `uca:note-transcribe-stream-event` | Audio runtime via desktop shell |
| Security/budget/export | `uca:security-state-update`, `uca:budget-update`, `uca:export-bundle` | Service runtime admin via desktop shell |

## Hard-Coded Main Handler Channels

These are current shell-private or legacy channels registered directly in `src/desktop/tray/electron-main.mjs` instead of through `IPC_CHANNELS`. They are inventoried so a later cleanup can either formalize or remove them intentionally.

`uca:capture-active-window-context`, `uca:echo-bubble-show`, `uca:echo-wake`, `uca:get-desktop-audio-source`, `uca:get-note-recording-state`, `uca:get-pdf-worker-url`, `uca:get-settings`, `uca:note-recording-state`, `uca:preview-window-pin`, `uca:register-ctrl-enter`, `uca:set-echo-mode`, `uca:show-dock-menu`, `uca:unregister-ctrl-enter`.

## Renderer Direct Runtime Call Snapshot

Current renderer UI files still call runtime surfaces directly. This is not changed in Phase 2A; it is documented so later extraction can replace these with adapter modules without losing behavior.

- Direct renderer `fetch(` references: 28
- Direct renderer `window.ucaShell` references: 375
- Files with direct runtime calls: 15

Largest files by direct shell usage:

| File | `fetch(` | `window.ucaShell` |
| --- | ---: | ---: |
| `src/desktop/renderer/console.js` | 18 | 209 |
| `src/desktop/renderer/overlay.js` | 4 | 97 |
| `src/desktop/renderer/dock.js` | 2 | 46 |

## Boundary Rules

- New channels must be added to `IPC_CHANNELS` first, then wired through preload and handlers.
- Existing channel strings must not be renamed during reorganization.
- Renderer code should consume channels through `window.ucaShell`; direct Electron imports remain forbidden in renderer UI.
- Main-process handlers must stay out of renderer files.

## Verification

Run:

```powershell
node scripts/verify-ipc-contract-inventory.mjs
```

The verifier asserts the exact `IPC_CHANNELS` snapshot and the current handler/send/invoke/listener counts.
