# File Size Inventory

This inventory tracks unusually large source files before release. Large files
are not automatically wrong, but user-facing entrypoints above these thresholds
need an explicit split plan before more features are added.

## Current Hotspots

| Area | File | Current shape | Split direction |
| --- | --- | --- | --- |
| Console renderer | `src/desktop/renderer/console.js` | Very large user-facing shell | chat/session/project, task list/timeline, scheduler, settings/provider panels |
| Overlay renderer | `src/desktop/renderer/overlay.js` | Large realtime interaction shell | voice/audio, tool-call display, rich answer blocks, context handoff |
| Shared styles | `src/desktop/renderer/shared.css` | Import-only aggregator after split | keep import order stable |
| Shared style core | `src/desktop/renderer/shared-core.css` | Base controls and layout primitives | split only when a domain becomes clear |
| Shared style tasks | `src/desktop/renderer/shared-tasks.css` | Task list/detail styles | task cards, timeline, artifact rows |
| Shared style chat | `src/desktop/renderer/shared-chat.css` | Chat shell, message blocks, rich markdown | chat sidebar, composer, rich answer blocks |
| Shared style rest | `src/desktop/renderer/shared-rest.css` | Remaining shared feature styles | future domain splits by feature |
| Electron main | `src/desktop/tray/electron-main.mjs` | Main-process bridge plus window lifecycle | actor inference, IPC bridges, window managers, native integrations |
| Action tools registry | `src/service/action_tools/tools/index.mjs` | Many tool implementations in one registry | split by document, browser, desktop, connector, scheduler, file/RAG domains |

## Release Rule

- Do not block release only because a file is large.
- Do block new feature work that makes one of the hotspot files meaningfully larger without a split note.
- Prefer domain splits with behavior/verifier coverage over cosmetic line-count splits.
- Keep `http-server.mjs` as a shell unless business logic starts returning to it.

## Notes

- `shared.css` is intentionally import-only. This preserves the original CSS
  cascade while allowing the tasks/chat/rest domains to be reviewed separately.
