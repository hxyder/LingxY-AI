# Codebase File Inventory

Date: 2026-05-09

Scope: important files and directories for Electron, renderer, preload,
service/runtime, workers/heavy jobs, state, tools, artifacts, providers, and
verification. This inventory is descriptive only and does not authorize moves.

Legend:

- Target layer: `main`, `preload`, `renderer`, `service`, `worker`, `shared`,
  `scripts`, `native/helper`, `docs`.
- Misplaced: `no`, `partial`, `yes`.
- Refactor risk: `low`, `medium`, `high`.

## Root

| Path | Current responsibility | Suspected target layer | Misplaced | Dependencies/imports | Risk | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `package.json` | Package metadata, scripts, Electron builder config, dependency list. | shared/scripts | no | Defines `main: index.cjs`; packages `src/**/*`, selected scripts, assets, native host. | medium | Huge verifier script list is useful for ownership clues. |
| `README.md` | Product overview, architecture summary, setup, data locations. | docs | no | References `src/desktop`, `src/service`, `scripts`. | low | Accurate high-level map. |
| `AGENTS.md` | Runtime upgrade guardrails and mandatory intake protocol. | docs | no | Canonical docs. | low | Must be read before runtime changes. |
| `index.cjs` | Electron app entry; handles `ELECTRON_RUN_AS_NODE` relaunch; imports Electron main runtime. | main | no | `electron`, `src/desktop/tray/electron-main.mjs`. | medium | Small and well-scoped. |
| `scripts/start-desktop.mjs` | Dev entrypoint that starts runtime process and Electron shell. | scripts | no | `child_process.spawn`, Electron binary, `scripts/start-runtime.mjs`. | medium | Process orchestration only. |
| `scripts/start-runtime.mjs` | Dev/runtime entrypoint for local service. | scripts/service | no | `createPersistentRuntime`. | low | Thin service starter. |

## Docs

| Path | Current responsibility | Suspected target layer | Misplaced | Dependencies/imports | Risk | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `docs/architecture/agent-runtime-spine.md` | Canonical runtime spine and PR acceptance status. | docs | no | Referenced by `AGENTS.md`. | low | Current next runtime step: memory governance surfaces. |
| `docs/architecture/electron-js-runtime-performance-plan.md` | Electron/service performance guardrails and worker/sidecar plan. | docs | no | Referenced by `AGENTS.md`. | low | Current performance next step: artifact extraction background lane. |
| `docs/protocols/*.schema.json` | Task, task event, context packet, artifact schemas. | shared/docs | no | Verifiers/scripts. | medium | Candidate source for generated shared contracts. |
| `docs/task-runtime/` | Runtime design docs. | docs | no | Verifier references. | low | Keep in sync with implementation. |

## Desktop Main

| Path | Current responsibility | Suspected target layer | Misplaced | Dependencies/imports | Risk | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `src/desktop/tray/electron-main.mjs` | High-level shell composition: app lifecycle, window/watcher/updater/IPC wiring, GUI smoke scheduling. | main | no | Compose-only; delegates to extracted lifecycle/actions/shortcut/link-browser/preview/smoke-runner/permission-handler helpers + IPC modules. | medium | ~2500 → ~1000 lines. Phases 2B.42-2B.48: 7 helpers extracted, remaining is composition glue. |
| `src/desktop/tray/bootstrap.mjs` | Validates desktop shell manifest and exposes bootstrap state. | main | no | `DESKTOP_SHELL_MANIFEST`, `IPC_CHANNELS`. | low | Small boundary helper. |
| `src/desktop/tray/runtime-host.mjs` | Runtime host helper. | main/service boundary | no | Desktop runtime/service startup support. | medium | Boundary file. |
| `src/desktop/tray/popup-card-manager.mjs` | Popup card BrowserWindow manager and popup IPC handlers. | main | no | Electron, `IPC_CHANNELS`. | medium | Main-owned UI shell logic; okay but should stay window/IPC scoped. |
| `src/desktop/tray/active-window-context.mjs` | Active window context capture payload construction. | main | no | PowerShell/script paths, Windows shell. | medium | Desktop integration; keep out of renderer. |
| `src/desktop/tray/brand-icons.mjs` | Icon resolution/loading/badging. | main | no | FS/assets/Electron native image. | low | Already async-focused per guardrail. |
| `src/desktop/tray/auto-updater.mjs` | Auto-update strategy/status/apply helpers. | main | no | Electron updater. | medium | Keep isolated. |
| `src/desktop/tray/desktop-service-client.mjs` | Desktop main-to-service HTTP JSON/binary/SSE bridge helpers with actor headers. | main/service boundary | no | `fetch`, `DESKTOP_CONSOLE_ACTOR`. | medium | Shared helper for main composition and injected IPC modules; keeps HTTP proxy mechanics out of `electron-main.mjs`. |
| `src/desktop/tray/desktop-diagnostics.mjs` | Desktop safe console logging, diagnostic JSONL writes, and process/crashReporter diagnostic setup. | main | no | Async FS, process error hooks, Electron app/crashReporter injection. | medium | Keeps diagnostic write/setup mechanics out of `electron-main.mjs`; no channel or route contracts. |
| `src/desktop/tray/desktop-settings.mjs` | Desktop shell settings defaults, async JSON persistence, settings cache, window preference helpers. | main | no | Async FS, `DOCK_SIZE_PX`, broadcast callback injected by main. | medium | Keeps settings storage/cache mechanics out of `electron-main.mjs`; main still owns window broadcasting policy. |
| `src/desktop/shared/desktop-payload-normalizers.mjs` | Shared tray IPC payload normalization helpers and approval decision body construction. | main/shared | no | Pure functions. | low | Replaces repeated `normalizePlainObject` definitions across tray IPC modules and keeps approval payload helpers out of `electron-main.mjs`. |
| `src/desktop/tray/desktop-window-config.mjs` | Renderer/preload path constants, renderer file URL construction, shell BrowserWindow option templates. | main | no | Path/url helpers. | low | Keeps static window URL/options templates out of `electron-main.mjs`; main still owns BrowserWindow lifecycle and event wiring. |
| `src/desktop/tray/desktop-window-bounds.mjs` | Window bounds clamping/defaulting, dock content-bounds handling, dock renderer zoom lock, and dock HUD scroll-lock CSS injection. | main | no | `dock-geometry.mjs`, injected Electron `screen`, injected settings readers. | medium | Keeps reusable window geometry and dock invariant mechanics out of `electron-main.mjs`; main still owns window lifecycle/events and preference persistence calls. |
| `src/desktop/tray/desktop-overlay-payloads.mjs` | Overlay file/context payload constants and construction helpers for dock drops and shell handoffs. | main/shared | no | Pure functions. | low | Keeps reusable overlay handoff payload shape and Echo dock-drop TTL out of `electron-main.mjs`; callers still own policy/action timing. |
| `src/desktop/tray/desktop-window-messages.mjs` | Pending renderer-window message queue with enqueue/flush/clear operations. | main | no | Injected window lookup/readiness callbacks. | medium | Keeps queued renderer IPC state out of `electron-main.mjs`; main still owns window readiness and event lifecycle. |
| `src/desktop/tray/desktop-dock-menu.mjs` | Initial tray menu and dock context menu controller, Echo TTS menu state, wake enrollment trigger, keyword sample cleanup. | main | no | Electron `Menu` injection, injected window/settings/service callbacks, async FS cleanup. | medium | Keeps tray/dock menu templates and menu-side actions out of `electron-main.mjs`; main still owns tray creation and shell-local IPC wiring. |
| `src/desktop/tray/desktop-tray-badge.mjs` | Tray badge task fetch/count and branded tray icon/tooltip update. | main/service boundary | no | `fetch`, injected tray and brand icon resolver. | low/medium | Keeps `/tasks` tray badge polling details out of `electron-main.mjs`; main still owns timer cadence and tray reference. |
| `src/desktop/tray/desktop-paths.mjs` | Desktop handoff/notification path constants, script paths, screenshot paths, GUI smoke temp paths. | main | no | Path/url/os helpers. | low | Keeps filesystem location and filename-pattern rules out of `electron-main.mjs`; watchers and consumers remain in main for now. |
| `src/desktop/tray/desktop-powershell.mjs` | Reusable hidden PowerShell execution helper for desktop capture/probe scripts. | main | no | `child_process.execFile`, `desktopScriptPath`. | medium | Keeps reusable PowerShell runner details out of `electron-main.mjs`; screenshot shortcut still owns its specific command behavior. |
| `src/desktop/tray/desktop-service-runtime.mjs` | Desktop service URL parsing, embedded-service host eligibility, health probing, wait loop. | main/service boundary | no | `fetch`, `AbortSignal.timeout`. | medium | Main still owns embedded runtime startup and resolved service URL state; helper keeps reusable health logic out of the entrypoint. |
| `src/desktop/tray/desktop-notifications.mjs` | Popup-card/native notification delivery, task notification batching, updater notification card payloads. | main | no | Popup-card manager injection, `Notification`, brand icons, diagnostics callback. | medium | Keeps notification batching/delivery state out of `electron-main.mjs`; main still injects popup manager and window visibility. |
| `src/desktop/tray/desktop-handoff-watcher.mjs` | Explorer handoff JSON file consumption, dedupe, directory drain, and watch loop. | main | no | Async FS watch/read/unlink, injected overlay show/enqueue callbacks. | medium | Keeps handoff file watcher mechanics out of `electron-main.mjs`; main still owns shell context channel wiring and startup/stop timing. |
| `src/desktop/tray/desktop-notification-watcher.mjs` | Desktop notification JSON file consumption, dedupe, directory drain, and watch loop. | main | no | Async FS watch/read/unlink, injected notification delivery callback. | medium | Keeps notification file watcher mechanics out of `electron-main.mjs`; popup/native delivery remains in `desktop-notifications.mjs`. |
| `src/desktop/tray/desktop-morning-digest.mjs` | Morning digest background check HTTP request helper. | main/service boundary | no | Injected `requestDesktopServiceJson`, safe warning callback. | low | Keeps `/email/digest/check` request details out of `electron-main.mjs`; main still owns startup timer. |
| `src/desktop/tray/desktop-remote-features.mjs` | Remote feature flag health fetch helper. | main/service boundary | no | `fetch`, `AbortSignal.timeout`. | low/medium | Keeps feature-gate fetch details out of `electron-main.mjs`; main still owns which feature gates capture behavior. |
| `src/desktop/tray/desktop-launch-args.mjs` | Desktop single-instance launch argument parsing for service URL, handoff file, and open-overlay intent. | main | no | Pure argv helpers. | low | Keeps command-line flag parsing out of `electron-main.mjs`; main still owns action handling. |
| `src/desktop/tray/desktop-external-window-context.mjs` | Detects LingxY self windows and remembers last external active-window context for dock/overlay capture fallback. | main | no | Pure state helper. | medium | Keeps active-window memory state out of `electron-main.mjs`; main still owns capture invocation and clipboard integration. |
| `src/desktop/tray/desktop-active-window-memory-poll.mjs` | Active-window memory poll interval and in-flight guard. | main | no | Injected `captureActiveWindowContext`. | low/medium | Keeps polling state out of `electron-main.mjs`; main still owns capture implementation, feature gate, and startup timing. |
| `src/desktop/tray/desktop-clipboard-watcher.mjs` | Clipboard polling, last-text tracking, and dock clipboard-change notification. | main | no | Electron clipboard injection, injected dock-window lookup. | medium | Keeps clipboard watcher timer/state out of `electron-main.mjs`; main still owns capture hotkey debounce and capture-to-clipboard synchronization call. |
| `src/desktop/tray/desktop-actor.mjs` | Desktop actor resolution for IPC/HTTP guard headers. | main/shared | no | Window sender mapping. | medium | Security boundary helper. |
| `src/desktop/tray/dock-geometry.mjs` | Dock sizing/bounds helpers. | main | no | Pure geometry. | low | Good small module. |
| `src/desktop/shell/desktop-window-lifecycle.mjs` | BrowserWindow event handler installation (close, resize, move, focus, blur, etc.), bounds persistence schedule per window. | main | no | Injected BrowserWindow, windows/readyWindows Maps, settings, diagnostics calls. | medium | Phase 2B.42; replaces inline 103-line lifecycle block. |
| `src/desktop/shell/desktop-window-actions.mjs` | Shell window actions: showWindow, hideWindow, openOverlayVoice, sendEchoShortcutWake. | main | no | Injected window Maps, bounds helpers, dock invariants, message queue. | medium | Phase 2B.43; replaces 4 inline function definitions. |
| `src/desktop/shell/desktop-shortcut-router.mjs` | 7-way global shortcut handler factory (toggle-overlay, voice-wake, note-wake, capture-and-ask, screenshot, console, presenter-mode). | main | no | Injected showWindow, clipboard, windows, settings, service client, diagnostics. | medium | Phase 2B.44; replaces inline handler loop body. |
| `src/desktop/shell/desktop-link-browser-window.mjs` | Link browser BrowserWindow construction, close-control injection, navigation guards, Escape close, bounds persistence, link-open preference reader. | main | no | Injected BrowserWindow, screen, shell, brandIcons, settings, runtime getter. | medium | Phase 2B.45; replaces inline link browser functions. |
| `src/desktop/shell/desktop-preview-window-manager.mjs` | Preview BrowserWindow lifecycle: lazy creation, centered bounds, hide-not-destroy close, load-aware pending queue flush, pin state. | main | no | Injected BrowserWindow, screen, brandIcons, quitting getter, PRELOAD_PATH. | medium | Phase 2B.46; returns sendToPreview/getPreviewWindow/hidePreviewWindow/setPreviewWindowPinned. |
| `src/desktop/smoke/desktop-gui-smoke-runner.mjs` | Test-only 44-check GUI smoke sequence (785 lines) with factory injection of all shell dependencies. | main (test) | no | Injected showWindow, windows, shortcuts, electron APIs, smoke hooks, notification bridge. | low | Phase 2B.47; moved to smoke/ in REPO-1.1; returns runDesktopGuiSmoke + writeDesktopGuiSmokeResult. |
| `src/desktop/shell/desktop-permission-handler.mjs` | Web Speech API microphone permission handler installation (setPermissionRequestHandler + setPermissionCheckHandler). | main | no | Injected session, safeError. | low | Phase 2B.48; 35 lines, replaces inline 34-line block. |

## Preload

| Path | Current responsibility | Suspected target layer | Misplaced | Dependencies/imports | Risk | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `src/desktop/renderer/preload.cjs` | Exposes `window.ucaShell` bridge: shell/window operations, file reads, clipboard, popup/preview, approvals, schedules, providers, skills, MCP, notes, projects, connectors, task operations, audio. | preload | partial | `contextBridge`, `ipcRenderer`, `clipboard`, `shell`, `webUtils`, FS promises. | high | Correct location, but broad API surface. Should eventually be typed/generated and thinner. |

## Renderer

| Path | Current responsibility | Suspected target layer | Misplaced | Dependencies/imports | Risk | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `src/desktop/renderer/console.js` | Main console UI, task list/detail, settings, providers, connectors, skills, MCP, schedules, notes, project files, artifact UI, direct HTTP calls, IPC bridge usage. | renderer | partial | `fetch`, `window.ucaShell`, renderer helper modules. | high | 12,248 lines; contains controller and service-client logic. |
| `src/desktop/renderer/overlay.js` | Overlay UI, chat/task submission, SSE rendering, active context, voice/note capture, approvals, artifact preview/open, popup interactions. | renderer | partial | `fetch`, `window.ucaShell`, renderer modules. | high | 8,196 lines; owns more than UI rendering. |
| `src/desktop/renderer/dock.js` | Dock UI, echo/wake interactions, clipboard/task summary polling, drag/drop. | renderer | partial | `fetch`, `window.ucaShell`. | medium/high | Some direct runtime HTTP calls. |
| `src/desktop/renderer/popup-card.js` | Popup card renderer behavior. | renderer | no | `window.ucaShell` popup methods. | medium | Window-specific UI. |
| `src/desktop/renderer/preview-window.js` | Dedicated preview window renderer. | renderer | no | `window.ucaShell` preview callbacks. | medium | UI preview logic. |
| `src/desktop/renderer/task-event-stream.js` | Renderer SSE client for task events. | renderer | partial | Direct `fetch` to `/task/:id/events`. | medium | Could move behind runtime client. |
| `src/desktop/renderer/live-preview.js` | Live artifact preview client/helper. | renderer | partial | `window.ucaShell`. | medium | Artifact UI boundary. |
| `src/desktop/renderer/console-task-detail.mjs` | Task detail rendering helpers. | renderer | no | Renderer models. | medium | Artifact/status display. |
| `src/desktop/renderer/console-task-list.mjs` | Task list rendering helpers. | renderer | no | Renderer models. | low | UI helper. |
| `src/desktop/renderer/console-task-event-stream.mjs` | Console task event stream UI helper. | renderer | no | SSE/render helpers. | medium | Stream batching guard applies. |
| `src/desktop/renderer/console-task-timeline.mjs` | Task timeline rendering. | renderer | no | Task events. | medium | Display-only if kept pure. |
| `src/desktop/renderer/console-*-view.mjs` | Feature-specific console pane rendering for accounts, files, inbox, MCP, notes, projects, schedules. | renderer | no | UI state and helpers. | low/medium | Good direction for splitting `console.js`. |
| `src/desktop/renderer/preview/handlers/*.js` | File preview handlers for CSV, text, image, PDF, remote iframe. | renderer | partial | `window.ucaShell.readTextFile/readFileAsDataUrl`, `fetch`. | medium | Preview policy may belong in service for sensitive files. |
| `src/desktop/renderer/*.html`, `*.css` | Static renderer markup and styles. | renderer | no | Electron BrowserWindow routes. | medium | `console.html`, `overlay.html`, and shared CSS are large. |
| `src/desktop/console/runtime-client.mjs` | Console HTTP client and workspace view-model assembly. | renderer/service client | partial | Direct `fetch`; imports service pricing JSON/module. | medium | Should not import service internals directly. |
| `src/desktop/console/view-model.mjs` | Console view model composition. | renderer | no | Shared IPC constants. | low | Good small module. |
| `src/desktop/overlay/view-model.mjs` | Overlay view model composition. | renderer | no | Shared IPC constants. | low | Good small module. |

## Shared

| Path | Current responsibility | Suspected target layer | Misplaced | Dependencies/imports | Risk | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `src/desktop/shared/manifest.mjs` | Window ids, IPC channels, shortcuts, desktop shell manifest. | shared/main/preload | no | Imported by main, preload-adjacent code, renderer view models. | medium | Candidate for typed generated IPC contract. |
| `src/shared/provider-catalog.mjs` | Provider catalog, default models, model family detection, route/model sanitization, reasoning options. | shared | no | Used by service and some UI/provider config paths. | medium | Broad but appropriate shared contract. |
| `src/shared/provider-configuration.mjs` | Provider configured/availability helpers. | shared | no | Provider UI/status. | low | Good shared helper. |
| `src/shared/conversation-model-override.mjs` | Conversation model override normalization. | shared | no | Provider resolver and UI. | low | Contract helper. |
| `src/shared/conversation-message-context.mjs` | Conversation message context summaries. | shared | no | Task submission/conversation lifecycle. | low | Runtime-facing shared helper. |
| `src/shared/task-trace-summary.mjs` | Summarizes task trace/event types. | shared | no | Renderer/service. | medium | Useful shared display contract. |
| `src/shared/contracts/*.ts` | Type contracts for AI provider, browser context, desktop shell, MCP, Office, code CLI, skills. | shared | no | Documentation/typed consumers. | medium | Not clearly enforced across JS modules. |
| `src/shared/i18n/` | Locales and i18n helpers. | shared | no | Renderer/service possible. | low | Fine. |

## Service Core

| Path | Current responsibility | Suspected target layer | Misplaced | Dependencies/imports | Risk | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `src/service/core/persistent-runtime.mjs` | Persistent runtime composition, paths, config/secrets, SQLite, HTTP server, pipe server, recovery, scheduler interval. | service | no | Store, bootstrap, server, scheduler, MCP disconnect. | high | Important startup path. |
| `src/service/core/service-bootstrap.mjs` | Creates runtime graph: queue, event bus, executors, tools, scheduler, security, preview, connectors, plugin registry, metrics, email monitor. | service | no | Many service modules. | high | Composition root; changes need broad tests. |
| `src/service/core/http-server.mjs` | HTTP server and route group dispatch. | service | no | Route modules. | medium | Good thin dispatcher. |
| `src/service/core/context-submission.mjs` | Main task submission orchestrator: context normalization, triage, semantic router, task creation, memory/file/artifact recall patches, executor dispatch, Kimi fallback. | service/orchestrator | partial | Many core/executor/policy/provider modules. | high | Too many responsibilities; central hot path. |
| `src/service/core/task-spec.mjs` | TaskSpec construction/validation, routing decisions, artifact requirements, success contracts. | service | no | Policy/router/context data. | high | Sensitive behavior contract. |
| `src/service/core/task-runtime.mjs` | Barrel export for task runtime helpers. | service | no | Re-exports task runtime modules. | low | Fine as facade. |
| `src/service/core/task-runtime/*.mjs` | Task record creation, submission transaction, lifecycle/status, event emission/logs, cancellation, conversation lifecycle, runtime service attachment. | service | no | Store, session, context compiler, event bus. | high | Correct layer; important contracts. |
| `src/service/core/session/conversation-session-service.mjs` | ConversationSession service and session item persistence. | service | no | Store methods, metrics. | high | Runtime spine core. |
| `src/service/core/session/follow-up-resolver.mjs` | Follow-up parent/session/artifact anchor resolution. | service | no | Store/session items. | high | Some regex heuristics remain; target single resolver entry. |
| `src/service/core/context/context-compiler.mjs` | Compiled context candidate collection, ranking, selection, metrics. | service | no | Runtime store/session/artifact extracts. | high | Correct owner. |
| `src/service/core/artifact-extracts/artifact-extract-service.mjs` | Typed artifact extract record normalization/persistence. | service | no | Store, metrics. | high | Correct owner; extraction worker still missing. |
| `src/service/core/artifact-lineage/artifact-lineage-service.mjs` | Artifact lineage contract validation and writes. | service | no | Store, metrics. | high | Correct owner. |
| `src/service/core/artifact-transforms/artifact-transform-service.mjs` | Structure-first transform flow, currently xlsx-to-pptx outline/validation/generation/lineage. | service | no | Artifact/extract/lineage/generate_document. | high | Correct owner; heavy extraction must not move here. |
| `src/service/core/store/sqlite-schema.mjs` | SQLite schema and indexes. | service/storage | no | Store. | high | Additive migrations only. |
| `src/service/core/store/sqlite-store.mjs` | SQLite implementation for tasks/events/artifacts/conversations/session items/search data. | service/storage | no | better-sqlite3, schema. | high | Sensitive data contract. |
| `src/service/core/store/memory-store.mjs` | In-memory test/scaffold store. | service/storage | no | Tests/bootstrap. | medium | Must mirror SQLite contracts. |
| `src/service/core/store/search-index.mjs` | Unified search FTS indexing. | service/storage | no | SQLite. | medium | Search consistency path. |
| `src/service/core/http-routes/*.mjs` | Local HTTP route ownership by feature group. | service | no | Runtime/store/service modules. | medium/high | Some route files are broad, especially config/audio/conversation/task. |
| `src/service/core/policy/*.mjs` | Submission, tool, evidence, budget, success-contract, side-effect policies. | service | no | TaskSpec/tool/executor callers. | high | Policy is correctly service-owned. |
| `src/service/core/intent/*.mjs` | Triage, semantic router, context source classification, route verifier, signals. | service | no | Provider resolver/adapter, task spec. | high | Correct layer. |
| `src/service/core/runtime/*.mjs` | Execution graph, runbook engine, routing monitor, error budget. | service/orchestrator | no | Task runtime/executors. | high | Early graph-runtime surface. |
| `src/service/core/queue/task-queue.mjs` | Task queue scaffold. | service | no | Runtime/task submission. | medium | Queue behavior is runtime-critical. |
| `src/service/core/external-call.mjs` | External process call boundary. | service/worker-adjacent | no | `child_process.spawn`. | medium | Could become worker/sidecar broker. |

## Executors and Providers

| Path | Current responsibility | Suspected target layer | Misplaced | Dependencies/imports | Risk | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `src/service/executors/registry.mjs` | Executor registry. | service | no | Executor list from bootstrap. | medium | Stable contract. |
| `src/service/executors/fast/fast-executor.mjs` | Fast/simple model executor. | service/provider | no | Provider resolver/adapter. | high | Provider behavior sensitive. |
| `src/service/executors/tool_using/agent-loop.mjs` | Tool-using planner loop, provider/tool calls, approvals, policy, preview, finalization. | service/orchestrator | partial | Provider resolver, tool registry, policies. | high | Oversized and mixed. |
| `src/service/executors/tool_using/tool-surface.mjs` | Tool visibility/filtering for tool-using executor. | service | no | Task spec/policy. | high | Duplicates some agentic surface logic. |
| `src/service/executors/tool_using/planners/*.mjs` | Deterministic, connector, launch helper planners. | service | no | Tool catalog. | medium | Keep service-owned. |
| `src/service/executors/agentic/executor.mjs` | Agentic executor wrapper. | service | no | Agentic planner. | high | Thin wrapper. |
| `src/service/executors/agentic/planner.mjs` | Agentic provider/tool loop and event production. | service/orchestrator | partial | Provider adapter, tool execution, tool surface. | high | Oversized; overlaps tool-using loop. |
| `src/service/executors/agentic/provider-adapter.mjs` | Provider-agnostic chat adapter for Anthropic/OpenAI-compatible/Ollama/code CLI. | service/provider | no | Provider catalog, code CLI bridge, fetch. | high | Good central boundary; keep isolated. |
| `src/service/executors/agentic/code-cli-bridge.mjs` | CLI prompt protocol, subprocess invocation, JSON tool call parsing. | service/provider | no | child process via shared invocation helpers. | high | Important subprocess boundary. |
| `src/service/executors/agentic/tool-execution.mjs` | Executes agentic tool call through registry and approval checks. | service/tool | no | Action tool registry. | high | Duplicates raw tool execution pattern risk. |
| `src/service/executors/shared/provider-resolver.mjs` | Resolves configured provider/model/API key/code-CLI runtime per task. | service/provider | partial | Sync FS, secret store, provider catalog. | high | Sync config read is known hot-path tradeoff. |
| `src/service/executors/shared/conversation-history-loader.mjs` | Structured history loading/budget selection. | service/context | no | Store. | medium | Should align with ContextCompiler. |
| `src/service/executors/shared/previewable-artifact-tools.mjs` | Registry of previewable artifact tools. | service/shared | no | Executors/renderers indirectly. | medium | Good single source for previewable tool ids. |
| `src/service/executors/kimi/*.mjs` | Kimi/code-CLI task package, execution, output-format artifact writing/parsing. | service/provider/artifact | partial | CLI subprocess, artifact generation. | high | Artifact path overlaps with newer artifact services. |
| `src/service/executors/multi_modal/multi-modal-executor.mjs` | Multimodal/vision execution path. | service/provider | no | Provider resolver/vision. | high | Provider/image contracts. |
| `src/service/executors/translate/translate-executor.mjs` | Translation executor. | service | no | Free translator. | medium | Narrow. |
| `src/service/capabilities/providers/*.mjs` | Provider registry, configured providers, health, model discovery. | service/provider | no | Config/routes/provider catalog/fetch. | medium/high | Correct owner. |
| `src/service/capabilities/code_cli/*.mjs` | Code CLI configuration/runtime detection. | service/provider | no | spawnSync/path. | medium | Correct capability owner. Some sync detection acceptable in setup/status paths. |

## Action Tools

| Path | Current responsibility | Suspected target layer | Misplaced | Dependencies/imports | Risk | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `src/service/capabilities/registry/registry.mjs` | Action tool registry and `call()`. | service/tools | no | Tool definitions. | high | Central tool dispatch. |
| `src/service/action_tools/tools/index.mjs` | Tool aggregator: imports 5 capability-owned tool families + owns remaining high-risk inline tools. | service/tools | no | Aggregates from `src/service/capabilities/tools/`, connector tools, memory tools, vision tools, skill install tools, and artifact-path-helper. | medium | ~4100 → 3048 lines. Phase 2D/CAP-1: low-risk families extracted and moved; high-risk tools (write/edit/run/generate/render/gui/capability) remain inline. |
| `src/service/capabilities/schemas/index.mjs` | Tool schemas. | service/shared | no | Tool registry/executors. | high | Must stay aligned with tool ids. |
| `src/service/capabilities/tools/document-renderer.mjs` | DOCX/PPTX/XLSX/PDF/HTML preview rendering. | service/artifact | no | docx/exceljs/pptx/pdf/html helpers, sibling Mermaid asset helper, shared SVG sanitizer. | high | Correct layer but heavy; worker may be needed for large docs. |
| `src/service/capabilities/tools/mermaid-assets.mjs` | Local Mermaid browser bundle resolver and script-tag helper for diagram artifacts/previews. | service/tools/render-asset | no | Imported by action tool aggregator, document renderer, and Kimi output formatter. | high | Must stay local-only: no CDN, network calls, write/delete IO, or desktop imports. |
| `src/service/capabilities/tools/svg-sanitize.mjs` | Import-free SVG markup sanitizer for render_svg, document previews, and tool validation. | service/security | no | Imported by action tools, document renderer, and tool-call validator. | high | Security helper; keep pure and covered by runtime sanitizer verifier. |
| `src/service/capabilities/tools/memory-tools.mjs` | Runtime memory/session task recall tools. | service/tools/context | no | Store/session/artifacts. | high | Important context surface. |
| `src/service/capabilities/tools/skill-install-tools.mjs` | Skill GitHub preview/install tools. | service/tools/security | no | Skill lifecycle/install state. | high | Side-effect approval sensitive. |
| `src/service/capabilities/tools/vision-analyze.mjs` | Vision analysis action tool. | service/tools/provider | no | Provider resolver/adapter. | high | Provider/image boundary. |
| `src/service/capabilities/registry/policy-guard.mjs` | Tool policy/rate limits. | service/policy | no | Runtime/tool policy. | high | Security-sensitive. |
| `src/service/capabilities/registry/risk_matrix.mjs` | Tool risk evaluation. | service/policy | no | Tool calls. | high | Security-sensitive. |
| `src/service/capabilities/tools/file-reversibility.mjs` | File mutation checkpoint/restore helpers. | service/tools/artifact | no | FS, task events. | high | Correct capability owner; must align with approvals and recovery. |

## Artifacts and Preview

| Path | Current responsibility | Suspected target layer | Misplaced | Dependencies/imports | Risk | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `src/service/store/artifact-store.mjs` | Filesystem artifact output store. | service/artifact | no | Runtime paths/FS. | high | Output path contract. |
| `src/service/core/artifact-action-contract.mjs` | Artifact action/source classification and registration options. | service/artifact | no | Tools/executors. | high | Correct artifact contract owner. |
| `src/service/core/artifact-fallback-policy.mjs` | Tracks requested artifact generation attempts/fallbacks. | service/artifact | no | Executors/tools. | high | Prevents fake success. |
| `src/service/core/artifact-quality.mjs` | Artifact quality validation. | service/artifact | no | File/artifact metadata. | high | Correct layer. |
| `src/service/core/spreadsheet-outline.mjs` | Spreadsheet outline helpers. | service/artifact | no | XLSX transform/generation. | medium | Artifact helper. |
| `src/service/preview/registry.mjs` | Preview provider registry. | service/preview | no | Preview providers/cache. | medium | Correct service boundary. |
| `src/service/preview/providers/*.mjs` | Preview provider implementations for artifact file families. | service/preview | no | File parsers/libs. | medium/high | Heavy preview should avoid main/renderer. |
| `src/service/preview/cache.mjs` | Preview cache. | service/preview | no | FS/cache paths. | medium | Correct owner. |
| `src/service/core/http-routes/preview-file-routes.mjs` | Preview/file rendering HTTP routes. | service/preview | no | Preview registry, file serving. | high | Route surface for file access. |

## Connectors, Scheduler, Memory, Search

| Path | Current responsibility | Suspected target layer | Misplaced | Dependencies/imports | Risk | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `src/service/capabilities/connectors/core/*.mjs` | Connector catalog, account registry/router, workflow dispatcher, token/reauth, contract loader. | service/connectors | no | Google/Microsoft/connectors tools. | high | Side-effect and auth sensitive. |
| `src/service/capabilities/connectors/google/google-connector.mjs` | Google connector implementation. | service/connectors | no | OAuth/API fetch. | high | External side effects. |
| `src/service/capabilities/connectors/microsoft/microsoft-connector.mjs` | Microsoft connector implementation. | service/connectors | no | Graph API. | high | External side effects. |
| `src/service/capabilities/connectors/tools/*.mjs` | Connector action tool wrappers/aggregator. | service/tools/connectors | no | Connector catalog/workflows. | high | Tool-call surface. |
| `src/service/scheduler/*.mjs` | Schedule lifecycle, store, dispatch, NL parsing, approval resume, reminders. | service/scheduler | no | Task submission, approvals, store. | high | Runtime task source. |
| `src/service/memory/user-profile.mjs` | User memory profile read/apply. | service/memory | no | Config store/context. | high | Next MX work likely touches this. |
| `src/service/embeddings/*.mjs` | Embedding store/search/semantic local BGE. | service/memory/search | no | Files/config/optional models. | medium/high | Potential heavy/background lane. |
| `src/service/search/free-search.mjs` | Free search implementation. | service/search | no | Fetch/readability. | medium | Web/external boundary. |
| `src/service/email/*.mjs` | Email accounts, IMAP/Graph, monitor, summarizer, digest. | service/connectors | no | Email APIs/provider? | high | Connector/security sensitive. |

## Extractors, Audio, Heavy Jobs, Worker-Like Code

| Path | Current responsibility | Suspected target layer | Misplaced | Dependencies/imports | Risk | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `src/service/extractors/file-ingest.mjs` | File content ingest/extraction, bounded concurrent worker function internally. | worker/service | partial | FS, child process, parsers. | medium/high | Should be candidate for `src/service/workers`. |
| `src/service/extractors/pdf_text.mjs` | PDF text extraction. | worker/service | partial | `execFile`, pdf tools/libs. | medium/high | Heavy parsing candidate. |
| `src/service/extractors/pdf_table.mjs` | PDF table extraction. | worker/service | partial | PDF parsing. | medium/high | Heavy parsing candidate. |
| `src/service/extractors/pdf_ocr.mjs` | PDF OCR helper. | worker/service | partial | `pdftoppm`, OCR tooling. | high | Worker/sidecar candidate. |
| `src/service/extractors/image_ocr.mjs` | Image OCR helper. | worker/service | partial | PowerShell/OCR. | high | Worker/sidecar candidate. |
| `src/service/extractors/page_source/*.mjs` | Page/article/Youtube transcript extraction. | service/extractor | no | Readability/linkedom/fetch. | medium | Service-owned. |
| `src/service/audio/*.mjs` | Whisper/sherpa daemons, TTS engine, locale/fixture metrics. | worker/service | partial | Python/subprocess/audio models. | high | Long-running daemon candidates for worker/sidecar isolation. |
| `src/service/core/http-routes/audio-routes.mjs` | Audio HTTP API and streaming transcription/TTS/KWS. | service/worker boundary | partial | Python subprocess, SSE. | high | Too broad; should delegate heavy work. |
| `src/helper/explorer_selection/` | Native Explorer selection helper project/contracts. | native/helper | no | .NET helper. | medium | Keep separate from JS runtime. |
| `src/helper/Screenshot/` | Screenshot helper contracts/scripts. | native/helper | no | Windows screenshot tooling. | medium | Desktop integration. |
| `uca-native-host/` | Native host project for browser/desktop integration. | native/helper | no | C# project. | high | Outside JS layer but packaged. |

No dedicated `src/service/workers/` directory currently exists.

## Storage and State

| Path | Current responsibility | Suspected target layer | Misplaced | Dependencies/imports | Risk | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `src/service/core/config-store.mjs` | Runtime config JSON store. | service/storage | no | FS. | high | User config contract. |
| `src/service/security/secret-store.mjs` | Local secret store and API key refs. | service/security/storage | no | FS/config. | high | Credential-sensitive. |
| `src/service/store/notes-store.mjs` | Notes store. | service/storage | no | FS. | medium | User data. |
| `src/service/core/deletion-lifecycle.mjs` | Soft delete/restore lifecycle. | service/storage | no | Store. | high | Data retention. |
| `src/service/core/export-bundle.mjs` | Export bundle generation. | service/storage/admin | no | Runtime paths/store. | medium | Data export surface. |
| `src/service/core/diagnostic-bundle.mjs` | Diagnostics bundle. | service/admin | no | Runtime paths/logs. | medium | Redaction/privacy risk. |
| `src/service/security/*.mjs` | Broker, audit log, privacy sandbox, kill switch, screen share monitor. | service/security | no | Runtime/config/store. | high | Security boundary. |
| `src/service/metrics/registry.mjs` | Runtime metrics registry and `/metrics` output source. | service/metrics | no | Store/queue. | medium | Correct service layer. |

## Scripts and Verification

| Path | Current responsibility | Suspected target layer | Misplaced | Dependencies/imports | Risk | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `scripts/run-checks.mjs` | Check runner. | scripts | no | Spawns verifier scripts. | high | CI/local gate. |
| `scripts/verify-runtime-upgrade-guardrails.mjs` | Guardrail verifier. | scripts | no | Docs/source scans. | medium | Must run after guardrail docs change. |
| `scripts/verify-main-process-blocking.mjs` | Main-process blocking guard. | scripts | no | Scans `index.cjs`, `src/desktop/tray`. | medium | Protects main layer. |
| `scripts/verify-renderer-stream-batching.mjs` | Renderer stream batching guard. | scripts | no | Scans renderer streaming code. | medium | Protects renderer perf. |
| `scripts/verify-context-compiler-boundary.mjs` | ContextCompiler layer boundary verifier. | scripts | no | Scans service/desktop imports. | medium | Protects service ownership. |
| `scripts/verify-artifact-*.mjs` | Artifact generation/extract/lineage/transform verifiers. | scripts | no | Service/artifact modules. | high | Protect artifact contracts. |
| `scripts/verify-service-core.mjs` | Broad service-core structural verifier. | scripts | no | Many service modules. | high | Useful but large. |
| `scripts/real-llm-test/` | Real/mocked LLM test harness and reports. | scripts/tests | no | Runtime service, corpus fixtures. | high | Avoid editing historical reports. |
| `scripts/app_launcher/` | Python app-launcher helper. | scripts/helper | no | Action tool launcher. | medium | Subprocess helper. |

## High-Risk Refactor Candidates

| Path | Reason |
| --- | --- |
| `src/desktop/tray/electron-main.mjs` | Too many main responsibilities; broad IPC surface. |
| `src/desktop/renderer/console.js` | Renderer UI plus runtime client/workflow logic. |
| `src/desktop/renderer/overlay.js` | Renderer UI plus context/task/approval/artifact logic. |
| `src/desktop/renderer/preload.cjs` | Very broad bridge; source of cross-layer API coupling. |
| `src/service/action_tools/tools/index.mjs` | Aggregator plus remaining high-risk inline tools: imports 5 capability-owned tool families + helper modules + external modules. Low-risk decomposition and CAP-1 capability moves are complete for the moved families only. |
| `src/service/capabilities/tools/browser-web-tools.mjs` | Browser/web/search/translation: 5 tools (open_url, web_search, web_search_fetch, fetch_url_content, translate_text). | service/tools | no | Phase 2D.1. |
| `src/service/capabilities/tools/os-app-tools.mjs` | OS/app/clipboard/notify: 5 tools (open_file, reveal_in_explorer, file_op, copy_to_clipboard, notify). | service/tools | no | Phases 2D.2a-2D.2b. |
| `src/service/capabilities/tools/scheduler-tools.mjs` | Scheduler: 4 tools (create, list, delete, pause scheduled tasks). | service/tools | no | Phase 2D.3. |
| `src/service/capabilities/tools/file-read-tools.mjs` | File discovery/read/stat: 6 tools (stat_file, verify_file_exists, list_files, glob_files, find_recent_files, get_latest_artifact). | service/tools | no | Phases 2D.4-2D.6. |
| `src/service/capabilities/tools/email-tools.mjs` | Email: 1 tool (compose_email). | service/tools | no | Phase 2D.5. |
| `src/service/capabilities/tools/file-manifest-helpers.mjs` | Shared file manifest/path/glob helpers: resolveDefaultOutputDir, readManifest, writeManifest, globToRegex. | service/tools/shared | no | Phase 2D.6a. |
| `src/service/capabilities/tools/open-with-default-handler.mjs` | Shared OS helper: openWithDefaultHandler (Windows/macOS/Linux). | service/tools/shared | no | Phase 2D.1. |
| `src/service/core/artifact-path-helper.mjs` | Service-owned artifact path helpers: resolveOutputDirForTool, ensureOutputDir, configuredWritableArtifactRoots, resolveSandboxedTarget. | service/core | no | Phase 2E.1. Sandbox invariants verifier-locked. |
| `src/service/core/context-submission.mjs` | Main orchestration hot path with several recall/fallback/provider branches. |
| `src/service/executors/tool_using/agent-loop.mjs` | Tool loop, policy, provider, preview, finalization all mixed. |
| `src/service/executors/agentic/planner.mjs` | Provider/tool orchestration and special paths mixed. |
| `src/service/executors/shared/provider-resolver.mjs` | Sync config/secret reads on provider resolution path. |
| `src/service/core/store/sqlite-store.mjs` | Central storage contract; broad blast radius. |

## Main / Preload / Renderer / Service / Worker Locations

| Layer | Current location |
| --- | --- |
| main | `index.cjs`; `src/desktop/tray/electron-main.mjs`; `src/desktop/tray/*.mjs` |
| preload | `src/desktop/renderer/preload.cjs` |
| renderer | `src/desktop/renderer/`; `src/desktop/console/`; `src/desktop/overlay/` |
| service | `src/service/` |
- **Worker/heavy** — `src/service/workers/` exists with `artifact-extract-worker.mjs` (verifier-locked in Phase 2F.1). Background lane under `src/service/core/artifact-extracts/`. Audio/extraction code also lives in `src/service/extractors/` and `src/service/audio/`. Helper/native projects and scripts handle OS-integration work.
