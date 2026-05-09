# Code Ownership Map

Phase 2A boundary inventory. This file records current ownership before any codebase reorganization. It is a contract map, not a refactor plan.

Status: verified against the current repository on 2026-05-09.

## Non-Goals

- Do not move, rename, or refactor product code in Phase 2A.
- Do not change IPC channel names, HTTP routes, tool ids, artifact kinds, provider ids, or storage schema.
- Do not use this map to justify prompt-only fixes.

## Owner Layers

| Owner layer | Current paths | Owns | Boundary rule |
| --- | --- | --- | --- |
| Desktop shell | `src/desktop/tray/**`, `src/desktop/shared/manifest.mjs` | Electron main process, window lifecycle, IPC handlers, local service process lifecycle | May import shared contracts and service host modules needed to launch the runtime. Renderer code must not own shell process state. |
| Desktop renderer | `src/desktop/renderer/**` | Console, dock, overlay, popup, preview UI | Talks through preload `window.ucaShell` and local HTTP APIs. Must not import `src/service/**` directly. |
| Desktop view models | `src/desktop/console/**`, `src/desktop/overlay/**` | UI state models and desktop-facing runtime client helpers | Transitional desktop-owned layer. Current exception: `src/desktop/console/runtime-client.mjs` reads service pricing data and should be revisited before broader movement. |
| Service runtime | `src/service/core/**`, `src/service/executors/**`, `src/service/action_tools/**`, `src/service/store/**` | task runtime, HTTP server/routes, tool registry/execution, artifacts, memory, connectors, scheduler, metrics | Owns task and artifact behavior. Must not import renderer UI modules. |
| Shared contracts | `src/shared/**`, `docs/protocols/**` | shared schemas, provider/config contracts, project-store and model helpers | Must remain runtime-neutral: no Electron imports and no `src/service/**` or renderer imports. |
| Scripts/verifiers | `scripts/**`, `tests/**` | build/test/verification gates and one-off repo tooling | May read product code to verify contracts, but must not become runtime dependencies. |
| Native host and CLI | `uca-native-host/**`, `uca-cli/**` | external process surfaces and command-line/native integration | Must remain explicit integration surfaces, not hidden renderer or service dependencies. |
| Office add-in | `office_addin/**` | Office web add-in UI/bridge/runtime | Talks through documented HTTP/bridge surfaces only. |

## Current Hotspots To Stabilize Before Moving Code

| Hotspot | Current owner | Why it matters |
| --- | --- | --- |
| `src/desktop/tray/electron-main.mjs` | Desktop shell | Large IPC and window orchestration surface. Any split must preserve channel names and handler semantics. |
| `src/desktop/renderer/console.js` | Desktop renderer | Main console UI has many direct `window.ucaShell` and `fetch` call sites. It needs adapter extraction before movement. |
| `src/desktop/renderer/overlay.js` | Desktop renderer | Overlay UI shares task/context responsibilities with console and service APIs. |
| `src/service/action_tools/tools/index.mjs` | Service runtime | Single built-in tool registry surface with 64 current tool ids. |
| `src/service/core/http-server.mjs` and `src/service/core/http-routes/**` | Service runtime | 14 route groups are mounted in a fixed order. |
| `src/service/core/context-submission.mjs` | Service runtime | Session/context compilation and task submission boundary. |
| `src/service/core/agent-loop.mjs` | Service runtime | Agent loop behavior and tool execution orchestration. |

## Verification

Run:

```powershell
node scripts/verify-code-ownership-boundaries.mjs
```

The verifier checks that this map exists, required owner paths are documented, `src/shared/**` stays runtime-neutral, and renderer UI files do not import `src/service/**` directly.
