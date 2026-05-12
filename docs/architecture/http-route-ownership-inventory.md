# HTTP Route Ownership Inventory

Phase 2A boundary inventory for local service HTTP routes. This file records the current route owner modules before any reorganization.

Status: verified against the current repository on 2026-05-09.

## Dispatcher

| Surface | Path | Owner |
| --- | --- | --- |
| HTTP server and route order | `src/service/core/http-server.mjs` | Service runtime |
| Route modules | `src/service/core/http-routes/*.mjs` | Service runtime |
| Route guards/helpers | `src/service/core/http-route-guards.mjs`, `src/service/core/http-helpers.mjs` | Service runtime |

## Route Groups

The current dispatcher checks route groups in this order:

1. `office-routes.mjs`
2. `note-project-conversation-routes.mjs`
3. `config-provider-routes.mjs`
4. `mcp-install-routes.mjs`
5. `ai-status-routes.mjs`
6. `audio-routes.mjs`
7. `preview-file-routes.mjs`
8. `browser-context-routes.mjs`
9. `scheduler-template-routes.mjs`
10. `task-routes.mjs`
11. `translation-routes.mjs`
12. `runtime-admin-routes.mjs`
13. `connector-routes.mjs`
14. `search-routes.mjs`

## Snapshot By Module

| Module | Methods | Literal routes | Regex routes | Owner scope |
| --- | --- | ---: | ---: | --- |
| `ai-status-routes.mjs` | GET, PATCH | 6 | 2 | provider/executor/MCP/capability inventory status |
| `audio-routes.mjs` | GET, POST | 9 | 0 | Echo, TTS, transcription |
| `browser-context-routes.mjs` | DELETE, GET, POST | 6 | 0 | browser context and overlay handoff |
| `config-provider-routes.mjs` | DELETE, GET, PATCH, POST | 38 | 5 | config, provider, skills, MCP drafts, memory, email, memory review undo |
| `connector-routes.mjs` | DELETE, GET, PATCH, POST | 7 | 15 | connector catalog, plugins, connected accounts |
| `mcp-install-routes.mjs` | POST | 3 | 0 | MCP install planning and execution |
| `note-project-conversation-routes.mjs` | DELETE, GET, PATCH, POST | 8 | 10 | notes, projects, conversations |
| `office-routes.mjs` | GET, POST | 3 | 0 | Office add-in setup and static assets |
| `preview-file-routes.mjs` | GET, POST | 5 | 0 | file preview, PDF, extract text, preview cache |
| `runtime-admin-routes.mjs` | DELETE, GET, POST | 10 | 3 | health, metrics, approvals, audit, export, budget |
| `scheduler-template-routes.mjs` | DELETE, GET, PATCH, POST | 6 | 6 | schedules, templates, DAG execution |
| `search-routes.mjs` | POST | 1 | 0 | local search |
| `task-routes.mjs` | DELETE, GET, POST | 6 | 7 | task submission, task lifecycle, events |
| `translation-routes.mjs` | POST | 1 | 0 | local translation proxy |

## Boundary Rules

- Route paths and HTTP methods are public local contracts; do not rename them during reorganization.
- New route groups should be explicit modules under `src/service/core/http-routes/**` and added to this inventory.
- Renderer or shell code must not duplicate route behavior; they should call the service surface.

## Verification

Run:

```powershell
node scripts/verify-http-route-inventory.mjs
```

The verifier asserts route module ownership, dispatcher order, methods, and current literal/regex route counts.
