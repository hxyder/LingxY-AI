# File Size Inventory

This inventory tracks unusually large source files before release. Large files
are not automatically wrong, but user-facing entrypoints above these thresholds
need an explicit split plan before more features are added.

## Current Hotspots

| Area | File | Current shape | Split direction |
| --- | --- | --- | --- |
| Console renderer | `src/desktop/renderer/console.js` | Very large user-facing shell | chat/session/project, task list/timeline, scheduler, settings/provider panels |
| Overlay renderer | `src/desktop/renderer/overlay.js` | Large realtime interaction shell | voice/audio, tool-call display, rich answer blocks, context handoff |
| Shared styles | `src/desktop/renderer/shared.css` | Global style accumulation | tokens/base, chat blocks, task cards, settings, overlay/dock-specific styles |
| Electron main | `src/desktop/tray/electron-main.mjs` | Main-process bridge plus window lifecycle | actor inference, IPC bridges, window managers, native integrations |
| Action tools registry | `src/service/action_tools/tools/index.mjs` | Many tool implementations in one registry | split by document, browser, desktop, connector, scheduler, file/RAG domains |

## Release Rule

- Do not block release only because a file is large.
- Do block new feature work that makes one of the hotspot files meaningfully larger without a split note.
- Prefer domain splits with behavior/verifier coverage over cosmetic line-count splits.
- Keep `http-server.mjs` as a shell unless business logic starts returning to it.
