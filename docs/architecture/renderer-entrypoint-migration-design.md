# Renderer Entrypoint Migration Design

Phase REPO-1.5/1.6 design for reorganizing `src/desktop/renderer/` sub-windows.
Status: 2026-05-11, design-only, no physical moves.

## Problem

`src/desktop/renderer/` currently has ~80 flat + loosely-organized files:
- Window entrypoints: `console.js/html`, `overlay.js/html`, `dock.js/html`, `popup-card.js/html/css`, `preview-window.js/html`
- Console sub-components: `console-*.mjs` (flat, ~15 files)
- Shared clients: `shared/` (4 files), `preview/` (handlers)
- Various helpers: `live-preview.js`, `task-event-stream.js`, `drop-guard.js`, etc.

HTML files use `<script src="./file.js">` — moving a file requires updating
all HTML entrypoints that reference it. This is the blocker for REPO-1.5.

## Current Renderer File Classification

### Window Entrypoints (each window = .html + .js)

| Window | HTML | JS | CSS |
|--------|------|----|-----|
| Console | `console.html` | `console.js` | `shared-chat.css`, `shared-tasks.css` |
| Overlay | `overlay.html` | `overlay.js` | `shared-chat.css`, `shared-tasks.css` |
| Dock | `dock.html` | `dock.js` | |
| Popup Card | `popup-card.html` | `popup-card.js` | `popup-card.css` |
| Preview | `preview-window.html` | `preview-window.js` | |
| Echo Bubble | `echo-bubble.html` | `echo-bubble.js` | |

### Console Sub-Components (console-page-specific)

```
console-account-connectors-view.mjs
console-chat-attachments.mjs
console-chat-sidebar.mjs
console-conversation-viewer.mjs
console-file-content-index-panel.mjs
console-files-view.mjs
console-floating-ui.mjs
console-inbox-view.mjs
console-mcp-view.mjs
console-notes-model.mjs
console-projects-view.mjs
console-schedules-view.mjs
console-task-detail.mjs
console-task-event-stream.mjs
console-task-list.mjs
console-task-timeline.mjs
```

### Shared / Cross-Window

```
shared/runtime-http-client.mjs
shared/runtime-task-client.mjs
shared/shell-client.mjs
shared/echo-runtime-client.mjs
live-preview.js, live-preview-shell-client.js
task-event-stream.js
popup-card-shell-client.js, dock-shell-client.js, echo-bubble-shell-client.js
drop-guard.js, icons.mjs, shared-ui.mjs, shared.css, tokens.css
```

## Target Layout (REPO-1.5)

```
src/desktop/renderer/
├── console/
│   ├── console.html, console.js          # entrypoint
│   ├── chat-attachments.mjs              # renamed from console-chat-attachments
│   ├── chat-sidebar.mjs
│   ├── conversation-viewer.mjs
│   ├── file-content-index-panel.mjs
│   ├── files-view.mjs
│   ├── floating-ui.mjs
│   ├── inbox-view.mjs
│   ├── mcp-view.mjs
│   ├── notes-model.mjs
│   ├── projects-view.mjs
│   ├── schedules-view.mjs
│   ├── task-detail.mjs
│   ├── task-event-stream.mjs
│   ├── task-list.mjs
│   ├── task-timeline.mjs
│   └── account-connectors-view.mjs
├── overlay/
│   ├── overlay.html, overlay.js
│   ├── audio-view.mjs
│   ├── auto-tasks.mjs
│   ├── project-model.mjs
│   └── task-routing.mjs
├── dock/
│   ├── dock.html, dock.js
│   └── dock-shell-client.js
├── popup/
│   ├── popup-card.html, popup-card.js, popup-card.css
│   └── popup-card-shell-client.js
├── preview/
│   ├── preview-window.html, preview-window.js
│   ├── handlers/             # existing, stays
│   ├── client-registry.js    # existing
│   ├── streaming.js          # existing
│   ├── runtime-preview-client.js
│   └── shell-preview-client.js
├── shared/                   # stays, already classified (REPO-1.4)
├── preload.cjs               # stays
├── live-preview.js, live-preview-shell-client.js
├── echo-bubble.html, echo-bubble.js, echo-bubble-shell-client.js
├── task-event-stream.js
├── drop-guard.js, icons.mjs, shared-ui.mjs
├── shared.css, tokens.css, shared-chat.css, shared-rest.css, shared-tasks.css
└── ... (remaining cross-window helpers)
```

## Migration Plan

### REPO-1.5a — Console sub-components

1. Create `renderer/console/` sub-directory
2. Move 16 `console-*.mjs` files into `renderer/console/`, dropping the `console-` prefix
3. Update `<script>` references in `console.html`
4. Update imports in `console.js`
5. Add compatibility barrels at old flat paths
6. Verify: GUI smoke (console checks), renderer verifiers
7. Remove barrels

### REPO-1.5b — Overlay sub-components

1. Move `overlay-*.mjs` files into `renderer/overlay/`
2. Update `overlay.html` and `overlay.js`
3. Same barrel+verify pattern

### REPO-1.5c — Other windows

1. Move dock, popup, preview window files into sub-directories
2. Update respective HTML entrypoints
3. Same barrel+verify pattern

### REPO-1.6 — Final cleanup

1. Remove any remaining compatibility barrels
2. Final stale-owner sweep
3. Update all inventory docs

## REPO-1.5a Console File Mapping (old → new)

Existing `renderer/console/` already contains 3 client files; REPO-1.5a
must preserve them and add the 16 moved console-*.mjs files.

| Old path | New path |
|----------|----------|
| `renderer/console.js` | `renderer/console/console.js` |
| `renderer/console.html` | `renderer/console/console.html` |
| `renderer/console-account-connectors-view.mjs` | `renderer/console/account-connectors-view.mjs` |
| `renderer/console-chat-attachments.mjs` | `renderer/console/chat-attachments.mjs` |
| `renderer/console-chat-sidebar.mjs` | `renderer/console/chat-sidebar.mjs` |
| `renderer/console-conversation-viewer.mjs` | `renderer/console/conversation-viewer.mjs` |
| `renderer/console-file-content-index-panel.mjs` | `renderer/console/file-content-index-panel.mjs` |
| `renderer/console-files-view.mjs` | `renderer/console/files-view.mjs` |
| `renderer/console-floating-ui.mjs` | `renderer/console/floating-ui.mjs` |
| `renderer/console-inbox-view.mjs` | `renderer/console/inbox-view.mjs` |
| `renderer/console-mcp-view.mjs` | `renderer/console/mcp-view.mjs` |
| `renderer/console-notes-model.mjs` | `renderer/console/notes-model.mjs` |
| `renderer/console-projects-view.mjs` | `renderer/console/projects-view.mjs` |
| `renderer/console-schedules-view.mjs` | `renderer/console/schedules-view.mjs` |
| `renderer/console-task-detail.mjs` | `renderer/console/task-detail.mjs` |
| `renderer/console-task-event-stream.mjs` | `renderer/console/task-event-stream.mjs` |
| `renderer/console-task-list.mjs` | `renderer/console/task-list.mjs` |
| `renderer/console-task-timeline.mjs` | `renderer/console/task-timeline.mjs` |
| `renderer/preview-window.js` | `renderer/preview/preview-window.js` |
| `renderer/preview-window.html` | `renderer/preview/preview-window.html` |

Verifier coverage required for each old path → new path → compatibility barrel → barrel removal.

## Pre-Move Checklist (per sub-phase)

- [ ] All `<script>` references in affected HTML files updated
- [ ] All ESM `import` paths updated
- [ ] Main-process HTML loading paths updated:
  - `src/desktop/tray/desktop-window-config.mjs` (`buildRendererFileUrl`, `buildWindowUrl`)
  - `src/desktop/tray/popup-card-manager.mjs` (popup-card.html load)
  - `src/desktop/shell/desktop-preview-window-manager.mjs` (preview-window.html load)
- [ ] Compatibility barrels created at old paths
- [ ] All verifier flat-path references updated in the same PR (not deferred to REPO-1.6):
  - `verify-desktop-renderer.mjs`
  - `verify-renderer-direct-runtime-calls.mjs`
  - `verify-ui-extras.mjs`
  - `verify-overlay-composer.mjs`
  - `verify-preview-window.mjs`
  - Any other verifier that reads `src/desktop/renderer/<name>.js/html`
- [ ] GUI smoke 44/44 (covers console, overlay, preview, popup)
- [ ] Stale-owner scan for old flat paths in active inventory docs + verifiers
- [ ] Existing `renderer/console/` contents preserved (3 console client files)
- [ ] Barrels removed after all references migrated

## Lessons Learned (2026-05-11 Attempt)

An attempted REPO-1.5a execution revealed additional complexity beyond the
design doc:

1. **Internal cross-references**: Moving files and dropping the `console-`
   prefix requires updating internal imports within the moved files
   (e.g., `task-list.mjs` imported from `./console-task-detail.mjs`).
2. **Barrel creation timing**: Compatibility barrels at old flat paths must
   exist during the entire migration window; if deleted prematurely,
   any lingering reference causes `ERR_MODULE_NOT_FOUND`.
3. **GUI smoke is the gate**: `console_stream_delta_load` failed after the
   move, indicating that the console window ESM loading is sensitive to
   path changes. The failure did not reproduce with `node --check` or
   individual import tests.
4. **Bulk verifier updates are not enough**: 22 verifier path updates were
   made, but runtime failures still occurred due to the issues above.

The attempt was reverted. REPO-1.5a should be executed as a focused session
with stricter pre-move checks for internal cross-references, barrel existence
verification, and incremental GUI smoke testing after each file group.

## Contracts That Must Not Change

- Preload API (`window.ucaShell`)
- IPC channel names
- Renderer window URLs (used by main process to load windows)
- GUI smoke check names and coverage
- CSS class names and DOM structure
- `package.json` electron-builder file patterns
