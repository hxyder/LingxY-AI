# IPC Contract Inventory

Phase 2A boundary inventory for Electron IPC. This is a read-only snapshot of the current shell contract.

Status: verified against the current repository on 2026-05-09.

## Contract Source

| Surface | Path | Owner |
| --- | --- | --- |
| IPC channel constants | `src/desktop/shared/manifest.mjs` | Desktop shell |
| Main-process handlers and sends | `src/desktop/tray/electron-main.mjs`, `src/desktop/tray/desktop-window-messages.mjs`, `src/desktop/tray/desktop-dock-menu.mjs`, `src/desktop/tray/desktop-clipboard-watcher.mjs`, `src/desktop/main/ipc/register-preview-ipc.mjs`, `src/desktop/main/ipc/register-updater-ipc.mjs`, `src/desktop/main/ipc/register-diagnostics-ipc.mjs`, `src/desktop/main/ipc/register-shell-open-url-ipc.mjs`, `src/desktop/main/ipc/register-mcp-ipc.mjs`, `src/desktop/main/ipc/register-scheduler-ipc.mjs`, `src/desktop/main/ipc/register-provider-config-ipc.mjs`, `src/desktop/main/ipc/register-skill-ipc.mjs`, `src/desktop/main/ipc/register-runtime-config-ipc.mjs`, `src/desktop/main/ipc/register-email-ipc.mjs`, `src/desktop/main/ipc/register-notes-project-ipc.mjs`, `src/desktop/main/ipc/register-connected-account-ipc.mjs`, `src/desktop/main/ipc/register-shell-window-ipc.mjs`, `src/desktop/main/ipc/register-shell-local-ipc.mjs`, `src/desktop/main/ipc/register-admin-ipc.mjs`, `src/desktop/main/ipc/register-approval-ipc.mjs`, `src/desktop/main/ipc/register-audio-service-ipc.mjs`, `src/desktop/main/ipc/register-office-ipc.mjs`, `src/desktop/main/ipc/register-pdf-ipc.mjs`, `src/desktop/main/ipc/register-task-ipc.mjs` | Desktop shell |
| Preload bridge | `src/desktop/renderer/preload.cjs` | Desktop shell / renderer bridge |
| Renderer consumers | `src/desktop/renderer/**`, `src/desktop/console/**`, `src/desktop/overlay/**` | Desktop renderer |

## Snapshot

- IPC channel count: 116
- Main-process handler registration references across `electron-main.mjs` and IPC modules: 113
- Main-process send references across `electron-main.mjs`, desktop main IPC helpers, and IPC modules: 26

PMAT-014 note, 2026-05-20: `capture-and-ask` sends
`uca:shortcut-triggered` once immediately when the hotkey is pressed, shows the
overlay without stealing selection focus, then hydrates selected
file/text/window context asynchronously over `uca:shell-context-received`.
Empty, failed, and timed-out captures use an additive `capture_status` payload
on that existing channel so the overlay can exit its pending state without a
new IPC route.
PMAT-014 follow-up, 2026-05-20: the renderer-side shortcut pending bubble must
not call the shell show/focus bridge for `capture-and-ask`; Electron main owns
the inactive reveal before the native copy probe completes. Delayed clipboard
text is accepted only as a bounded post-copy compensation when no file selection
was captured, and active-window payloads with only process/title still render as
a generic current-window card on the existing context channel.
- Renderer invoke references: 109
- Renderer listener references: 22
- Hard-coded main IPC handler channels outside `IPC_CHANNELS`: 13

## Channel Groups

| Group | Examples | Owner |
| --- | --- | --- |
| Shell/window | `uca:shell-ready`, `uca:shell-show-window`, `uca:shell-hide-window`, `uca:shell-window-focused` | Desktop shell |
| Shell-local state/context | `uca:get-settings`, `uca:capture-active-window-context`, `uca:show-dock-menu`, `uca:register-ctrl-enter` | Desktop shell |
| Popup/preview | `uca:popup-card-show`, `uca:preview-window-show`, `uca:preview-window-delta` | Desktop shell and renderer bridge |
| Task/runtime | `uca:task-cancel`, `uca:task-retry`, `uca:task-delete`, `uca:task-file-recovery-restore`, `uca:context-preview-requested` | Service runtime via shell bridge |
| Config/provider/MCP | `uca:provider-save`, `uca:mcp-server-save`, `uca:routing-config-update`, `uca:runtime-labs-config-update` | Service runtime configuration via desktop shell |
| Skills/capability | `uca:skill-create`, `uca:skill-markdown-read`, `uca:skill-registry-save` | Service runtime configuration via desktop shell |
| Notes/projects/conversations | `uca:note-upsert`, `uca:project-files-attach`, `uca:notes-save` | Service runtime storage via desktop shell |
| Scheduler/DAG/templates | `uca:schedule-create`, `uca:dag-resume`, `uca:template-save` | Service runtime scheduler via desktop shell |
| Audio/Echo | `uca:echo-kws-detect`, `uca:echo-keyword-enroll`, `uca:note-transcribe`, `uca:note-transcribe-stream`, `uca:note-transcribe-stream-event` | Audio runtime via desktop shell |
| Security/budget/export | `uca:security-state-update`, `uca:budget-update`, `uca:export-bundle` | Service runtime admin via desktop shell |
| Approvals | `uca:approval-approve`, `uca:approval-reject` | Service runtime approval scheduler via desktop shell |

## Hard-Coded Main-Process Handler Channels

These are current shell-private or legacy channels registered directly through main-process IPC handlers instead of through `IPC_CHANNELS`. They are inventoried so a later cleanup can either formalize or remove them intentionally.

`uca:capture-active-window-context`, `uca:echo-bubble-show`, `uca:echo-wake`, `uca:get-desktop-audio-source`, `uca:get-note-recording-state`, `uca:get-pdf-worker-url`, `uca:get-settings`, `uca:note-recording-state`, `uca:preview-window-pin`, `uca:register-ctrl-enter`, `uca:set-echo-mode`, `uca:show-dock-menu`, `uca:unregister-ctrl-enter`.

## Renderer Direct Runtime Call Snapshot

Current renderer UI files still call runtime surfaces directly. This is not changed in Phase 2A; it is documented so later extraction can replace these with adapter modules without losing behavior.

- Direct renderer `fetch(` code references: 0
- Direct renderer `window.ucaShell` references: 6
- Files with direct runtime calls: 6

Largest files by direct shell usage:

| File | `fetch(` | `window.ucaShell` |
| --- | ---: | ---: |
| `src/desktop/renderer/shared/shell-client.mjs` | 0 | 1 |
| `src/desktop/renderer/dock-shell-client.mjs` | 0 | 1 |

## Boundary Rules

- New channels must be added to `IPC_CHANNELS` first, then wired through preload and handlers.
- Existing channel strings must not be renamed during reorganization.
- Renderer code should consume channels through `window.ucaShell`; direct Electron imports remain forbidden in renderer UI.
- Main-process handlers must stay out of renderer files.

## Phase 2B Note

Phase 2A locked the current handler/send/invoke/listener counts as a contract snapshot only. Phase 2B now scans `electron-main.mjs` plus extracted IPC modules and main IPC helper modules such as `desktop-window-messages.mjs`, `desktop-dock-menu.mjs`, and `desktop-clipboard-watcher.mjs`. The invariant is IPC channel contract stability, not that every handler/send remains physically registered in `electron-main.mjs`.

The popup-card IPC family is now included in the extracted IPC module scan. Its five existing handlers previously lived inside `popup-card-manager.mjs`; the channel contract is unchanged, but the scanned handler total now includes that family.

Current extracted IPC modules:

- `src/desktop/main/ipc/register-preview-ipc.mjs`: preview window show, append-delta, commit, close, and pin handlers.
- `src/desktop/main/ipc/register-updater-ipc.mjs`: updater status, strategy, check-now, and apply handlers.
- `src/desktop/main/ipc/register-diagnostics-ipc.mjs`: diagnostic bundle and renderer error report handlers.
- `src/desktop/main/ipc/register-shell-open-url-ipc.mjs`: shell open-url handler and link-open mode selection.
- `src/desktop/main/ipc/register-mcp-ipc.mjs`: MCP install, server save/delete/test/toggle/config, and draft import handlers.
- `src/desktop/main/ipc/register-scheduler-ipc.mjs`: schedule create/update/delete/run, template save/import/delete, and DAG resume handlers.
- `src/desktop/main/ipc/register-provider-config-ipc.mjs`: provider save/delete, onboarding suggestion update, and Code CLI adapter save/delete handlers.
- `src/desktop/main/ipc/register-skill-ipc.mjs`: skill registry/state, auto-skill save, skill markdown read/write, create/duplicate/delete/history/rollback/test handlers.
- `src/desktop/main/ipc/register-runtime-config-ipc.mjs`: routing, output, feature, Runtime Labs, and email settings update handlers.
- `src/desktop/main/ipc/register-email-ipc.mjs`: email account save/delete and digest check handlers.
- `src/desktop/main/ipc/register-notes-project-ipc.mjs`: notes save/upsert/delete/restore/append-chip, project store/files pick/attach/remove-index, and preview cache clear handlers.
- `src/desktop/main/ipc/register-connected-account-ipc.mjs`: connected account rename/default/disconnect and connector account disconnect/config save handlers.
- `src/desktop/main/ipc/register-shell-window-ipc.mjs`: shell status/show/hide/open-overlay-voice/drop-files/move/resize/ignore-mouse/notify/navigate-console handlers.
- `src/desktop/main/ipc/register-shell-local-ipc.mjs`: shell-local settings, note recording state, active-window capture, desktop audio source, Echo wake/diagnostics/shortcuts, dock menu, and echo bubble handlers.
- `src/desktop/main/ipc/register-admin-ipc.mjs`: security state update, budget update, and export bundle handlers.
- `src/desktop/main/ipc/register-approval-ipc.mjs`: approval approve and reject handlers.
- `src/desktop/main/ipc/register-audio-service-ipc.mjs`: Echo keyword detection/enrollment and note transcription service proxy handlers.
- `src/desktop/main/ipc/register-office-ipc.mjs`: Office add-in setup handler.
- `src/desktop/main/ipc/register-pdf-ipc.mjs`: PDF preview worker URL handler.
- `src/desktop/main/ipc/register-popup-card-ipc.mjs`: popup-card show/close/toggle-pin/resize/resolve handlers.
- `src/desktop/main/ipc/register-task-ipc.mjs`: task cancel/retry/delete/restore and file checkpoint recovery handlers.

## Verification

Run:

```powershell
node scripts/verify-ipc-contract-inventory.mjs
```

The verifier asserts the exact `IPC_CHANNELS` snapshot and the current handler/send/invoke/listener counts across `electron-main.mjs`, desktop main IPC helpers, plus extracted IPC modules.
