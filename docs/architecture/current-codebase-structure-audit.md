# Current Codebase Structure Audit

Date: 2026-05-09

Scope: read-only audit of the Electron + JavaScript/TypeScript codebase. This
document does not propose source edits in the current phase.

Guardrails read before audit:

- `AGENTS.md`
- `docs/architecture/agent-runtime-spine.md`
- `docs/architecture/electron-js-runtime-performance-plan.md`
- `lingxy_codex_ready_agent_runtime_upgrade_plan.md`
- `lingxy_electron_js_codex_execution_plan.md`

## Executive Summary

The repository already has a recognizable split:

- Electron shell code lives under `src/desktop`.
- Local runtime/service code lives under `src/service`.
- Shared contracts and constants live under `src/shared`.
- Verification and developer tooling live under `scripts`.

The biggest structural risks are not missing directories. They are oversized
files and cross-layer coupling:

- `src/desktop/tray/electron-main.mjs` owns Electron lifecycle, IPC, service
  request normalization, desktop settings, popup/preview wiring, smoke-test
  code, active-window capture, update wiring, and many HTTP proxy handlers.
- `src/desktop/renderer/console.js` and `src/desktop/renderer/overlay.js` own
  UI rendering plus direct runtime HTTP access, task/event orchestration,
  artifact preview behavior, approval flows, settings mutation calls, and some
  context assembly.
- `src/service/action_tools/tools/index.mjs` is a large multi-tool registry
  containing app launch, browser/open URL, clipboard, search/fetch, scheduler,
  files, document rendering, GUI automation, capability drafting, and artifact
  registration logic in one file.
- Provider calls are partly centralized in
  `src/service/executors/agentic/provider-adapter.mjs`, but provider resolution
  also synchronously reads runtime config in
  `src/service/executors/shared/provider-resolver.mjs`, and several service
  modules perform provider/CLI/probe work directly.
- Artifact handling is partially formalized by artifact extract, lineage, and
  transform services, but artifact creation/registration/preview/fallback logic
  remains scattered across tools, executors, task lifecycle, renderer, and route
  modules.

Target-layer comparison:

| Target layer | Current fit | Main issue |
| --- | --- | --- |
| renderer: UI only | Partial | Renderer performs direct service calls, reads files through preload, owns task/artifact UI workflows, and contains large controller logic. |
| main: Electron lifecycle and IPC only | Partial | Main process has many IPC-to-HTTP proxy handlers and local shell coordination; file/open/smoke/settings logic is mixed with lifecycle. |
| preload: safe typed bridge only | Partial | Bridge is safe-ish and explicit, but very broad and exposes file read/open/clipboard plus many runtime mutation methods without typed generated contracts. |
| service: runtime/orchestrator/tool/artifact/provider logic | Mostly | Most runtime logic is here, but some runtime client and artifact/display logic leaks into renderer and main proxy code. |
| workers: long-running/heavy jobs | Weak | No `src/service/workers` exists. Heavy work is mostly async in service modules, child processes, scripts, or helpers. |
| shared: types, schemas, events, errors, constants | Partial | `src/shared` has useful contracts/catalogs, but IPC/API contracts are not fully typed/generated across main/preload/renderer/service. |

## Current Directory Map

Top-level directories relevant to this audit:

```text
AGENTS.md
README.md
package.json
index.cjs
docs/
  architecture/
  protocols/
  runtime/
  task-runtime/
scripts/
  start-desktop.mjs
  start-runtime.mjs
  verify-*.mjs
  real-llm-test/
src/
  desktop/
    tray/
    renderer/
    console/
    overlay/
    shared/
    assets/
  helper/
    explorer_selection/
    Screenshot/
  service/
    action_tools/
    ai/
    audio/
    connectors/
    core/
    cost/
    dag/
    email/
    embeddings/
    events/
    executors/
    extractors/
    memory/
    metrics/
    preview/
    scheduler/
    search/
    security/
    store/
    templates/
    translation/
    utils/
  shared/
    contracts/
    i18n/
tests/
uca-native-host/
browser_ext/
office_addin/
```

Directories requested but not present as top-level directories:

- `app/`
- `electron/`
- `main/`
- `preload/`
- `renderer/`
- `services/`
- `workers/`
- `orchestrator/`

Their current equivalents are:

| Requested layer | Actual location |
| --- | --- |
| main | `index.cjs`, `src/desktop/tray/` |
| preload | `src/desktop/renderer/preload.cjs` |
| renderer | `src/desktop/renderer/`, plus UI view-model helpers under `src/desktop/console/` and `src/desktop/overlay/` |
| service/services | `src/service/` |
| worker | No dedicated worker directory; current heavy/long-running work is in `src/service/extractors/`, `src/service/audio/`, `src/service/action_tools/tools/index.mjs`, subprocess helpers, and scripts |
| orchestrator | `src/service/core/context-submission.mjs`, `src/service/core/task-runtime/`, `src/service/executors/`, `src/service/dag/`, `src/service/scheduler/` |

## Actual Responsibility Map

| Area | Current responsibility |
| --- | --- |
| `index.cjs` | Electron entrypoint; relaunch guard when `ELECTRON_RUN_AS_NODE=1`; imports Electron main runtime. |
| `src/desktop/tray/` | Electron app lifecycle, windows, tray/dock, global shortcuts, active-window capture, desktop notifications, popup cards, preview window, IPC handlers, service proxy calls, desktop diagnostics, update checks, GUI smoke orchestration. |
| `src/desktop/renderer/preload.cjs` | Exposes `window.ucaShell`; wraps IPC calls, shell/file/clipboard operations, dropped-file path resolution, popup/preview callbacks, settings, providers, schedules, skills, MCP, approvals, audio, notes, project files, task actions. |
| `src/desktop/renderer/` | UI for overlay, console, dock, popup cards, preview window; direct runtime HTTP clients; SSE event consumption; artifact preview/open/reveal; approval cards; settings/connectors/providers/skills/schedules/notes UI. |
| `src/desktop/console/`, `src/desktop/overlay/` | View-model helpers for console/overlay panes; console runtime client and task-detail models. |
| `src/service/core/` | Runtime bootstrap, HTTP server and routes, task submission, context normalization, routing, policy, task records/lifecycle/events, storage schemas, session/context/artifact services, runtime paths/config. |
| `src/service/executors/` | Fast, tool-using, agentic, Kimi/code-CLI, multimodal, translate executors; prompt building, provider calls, tool loop, finalization, validation. |
| `src/service/action_tools/` | Built-in action tool registry, tool schemas, policy/risk, file/artifact/document/search/browser/system/scheduler/GUI/capability tools. |
| `src/service/ai/` | Provider catalogs/status/discovery, configured providers, code CLI runtime, MCP clients/install, skills lifecycle, integration runtime, onboarding suggestions. |
| `src/service/connectors/` | Connector catalog, account registry/routing, Google/Microsoft connectors, workflow dispatcher, connector tools. |
| `src/service/scheduler/` | Schedule store, lifecycle, trigger parsing, dispatch, approval resume, reminder watcher, pending approvals. |
| `src/service/store/` and `src/service/core/store/` | Artifact store, notes store, SQLite schema/store, memory store scaffold, migrations, search index. |
| `src/service/extractors/` | File/page/PDF/image extractors and OCR helpers; current extraction is service-owned but not in a dedicated worker layer. |
| `src/service/preview/` | Preview registry/cache/providers for xlsx/docx/pptx/pdf/image/text/html/csv/markdown. |
| `src/shared/` | Provider catalog/config, task trace summary, conversation/model helpers, project store helpers, i18n, TypeScript contracts. |
| `scripts/` | Runtime/desktop start scripts, check runner, verifier suite, real LLM test harnesses, packaging/release helpers. |

## Entry Points

| Entry point | Layer | Responsibility |
| --- | --- | --- |
| `package.json` `main: index.cjs` | main | Electron app entry. |
| `index.cjs` | main | Imports `src/desktop/tray/electron-main.mjs` and calls `initializeElectronShellRuntime`. |
| `scripts/start-desktop.mjs` | dev tooling | Starts runtime child process and Electron desktop. |
| `scripts/start-runtime.mjs` | service | Creates `createPersistentRuntime` and listens on default port `4310`. |
| `src/service/core/persistent-runtime.mjs` | service | Creates runtime paths, config/secret stores, SQLite store, service bootstrap, HTTP server, explorer pipe server, scheduler timer, recovery. |
| `src/service/core/service-bootstrap.mjs` | service | Constructs runtime object: store, event bus, queue, executors, action tools, preview registry, connectors, scheduler, metrics, AI integrations, email monitor. |
| `src/service/core/http-server.mjs` | service | Local HTTP server and route group dispatcher. |
| `src/desktop/renderer/preload.cjs` | preload | Exposes `window.ucaShell` bridge to renderer windows. |
| `src/desktop/shared/manifest.mjs` | shared/main/preload | Window ids and IPC channel constants. |

## IPC Map

Canonical IPC channel constants live in `src/desktop/shared/manifest.mjs`.

Main IPC handlers live mostly in:

- `src/desktop/tray/electron-main.mjs`
- `src/desktop/tray/popup-card-manager.mjs`

Preload bridge lives in:

- `src/desktop/renderer/preload.cjs`

Main-to-renderer sends include:

- shell readiness/focus/context/shortcut events
- settings changes
- clipboard notifications
- note recording state
- echo wake/bubble/session events
- popup card init/resolved events
- preview window init/delta/committed events

Renderer-to-main invokes include:

| IPC family | Channels/examples | Current owner |
| --- | --- | --- |
| Shell/window lifecycle | `uca:shell-status`, `uca:shell-show-window`, `uca:shell-hide-window`, `uca:shell-move-window-by`, `uca:shell-resize-window-by`, `uca:shell-set-ignore-mouse-events` | main |
| Desktop context | `uca:capture-active-window-context`, dropped file submission, shortcut events | main + preload |
| File/shell utilities | `openPath`, `openExternal`, `openUrl`, `showItemInFolder`, `readTextFile`, `readFileAsDataUrl` | preload/main/Electron shell |
| Popup/preview | `uca:popup-card-*`, `uca:preview-window-*` | main + popup manager |
| Runtime mutations proxied through main | approvals, schedules, templates, providers, code CLI adapters, skills, MCP, routing, output, features, email, notes, project files, connectors, task cancel/retry/delete/restore | main forwards to service HTTP |
| Audio | echo keyword detection/enroll, note transcription, note streaming | main forwards binary to service HTTP |
| Diagnostics/update | renderer errors, auto-updater channels, diagnostic bundle | main/service |

Risk: IPC surface is broad and hand-maintained across `manifest.mjs`,
`preload.cjs`, `electron-main.mjs`, and renderer call sites. There is no
obvious generated contract tying method names, payloads, actor requirements, and
HTTP route mappings together.

## HTTP/SSE Map

HTTP server:

- `src/service/core/http-server.mjs`

Route group modules:

- `src/service/core/http-routes/task-routes.mjs`
- `src/service/core/http-routes/config-provider-routes.mjs`
- `src/service/core/http-routes/runtime-admin-routes.mjs`
- `src/service/core/http-routes/note-project-conversation-routes.mjs`
- `src/service/core/http-routes/scheduler-template-routes.mjs`
- `src/service/core/http-routes/connector-routes.mjs`
- `src/service/core/http-routes/browser-context-routes.mjs`
- `src/service/core/http-routes/audio-routes.mjs`
- `src/service/core/http-routes/preview-file-routes.mjs`
- `src/service/core/http-routes/office-routes.mjs`
- `src/service/core/http-routes/mcp-install-routes.mjs`
- `src/service/core/http-routes/ai-status-routes.mjs`
- `src/service/core/http-routes/search-routes.mjs`
- `src/service/core/http-routes/translation-routes.mjs`

Important route groups:

| Area | Routes |
| --- | --- |
| Task submission/events | `POST /context`, `POST /task`, `POST /task/clarify`, `GET /tasks`, `GET /task/:id`, `GET /task/:id/events`, `POST /task/:id/cancel`, `POST /task/:id/retry`, `DELETE /task/:id`, `POST /task/:id/restore`, `POST /task/:id/file-recovery/:checkpointId` |
| SSE | `GET /task/:id/events` with `Accept: text/event-stream` |
| Conversations | `GET/POST /conversations`, `GET /conversation/:id/messages`, `GET /conversation/:id/artifacts`, fork/rewind/edit/model routes |
| Artifacts/preview | `GET /file/render-preview-html`, `GET /file/pdf`, `GET /file/extract-text`, `GET /preview/status`, `POST /preview/cache/clear` |
| Config/providers | `/config`, `/config/providers`, `/config/routing`, `/config/output`, `/config/features`, `/ai/providers`, `/ai/active-provider-for-task` |
| Approvals/security/admin | `/approvals`, `/approvals/:id/approve`, `/approvals/:id/reject`, `/security/state`, `/audit-log`, `/metrics`, `/export/bundle`, `/diagnostics/bundle` |
| Scheduler/templates/DAG | `/schedules`, `/schedules/:id/runs`, `/templates`, `/templates/import`, `/templates/validate`, `/dag/preview`, `/dag/executions`, `/dag/executions/:id/resume` |
| Connectors | `/connectors/catalog`, `/connectors/accounts`, `/connectors/connected-accounts`, auth/reauth/workflow routes |
| Audio | `/echo/kws`, `/echo/enroll-keyword`, `/note/transcribe`, `/echo/speak`, TTS preference/status routes |

## Runtime/Task Flow Map

Normal context task flow:

```text
renderer overlay/console
  -> POST /context or POST /task
  -> src/service/core/http-routes/task-routes.mjs
  -> submitContextTask() in src/service/core/context-submission.mjs
  -> ensureRuntimeServices()
  -> triage / routeIntent / semantic router preflight
  -> submitTaskWithConversation()
  -> createTaskRecord()
       -> resolveFollowUp()
       -> attach parent summary / prior messages / recent artifacts
       -> compileContextForTask()
       -> createTaskSpec()
       -> evaluateSubmissionBoundary()
  -> store insert task/conversation/message/session items
  -> queue.enqueue()
  -> emitTaskEvent(task_created)
  -> executeExistingContextTask()
       -> provider resolution and optional code-CLI path
       -> pick executor
       -> runExecutor()
       -> executor emits events
       -> tool loops call actionToolRegistry / provider adapter
       -> applyExecutorEvent()
       -> markTaskSucceeded() or markTaskFailed()
       -> append task outcome message, index history, clear redaction map
```

Runtime service construction:

```text
createPersistentRuntime()
  -> ensureRuntimePaths()
  -> createRuntimeConfigStore()
  -> createSqliteStore()
  -> createServiceBootstrap()
       -> eventBus, queue, executors, actionToolRegistry
       -> securityBroker, scheduler, connectorCatalog/pluginRegistry
       -> previewRegistry, metrics, embeddingStore, emailMonitor
  -> createServiceHttpServer()
  -> createExplorerSelectionPipeServer()
  -> recoverInterruptedTasks()
  -> scheduler interval and reminderWatcher
```

SSE/event flow:

```text
executor/tool/provider code
  -> emitTaskEvent()
       -> append non-ephemeral event to store
       -> conversationSessions.recordTaskEvent()
       -> eventBus.publish()
       -> phase timing side-events
       -> persistTaskEvent() JSONL
  -> task-routes SSE stream
  -> renderer task-event-stream.js / console runtime-client / overlay
```

Ephemeral events not persisted to store:

- `text_delta`
- `tool_input_delta`
- `reasoning_delta`
- `tool_planner_decision`

## Tool-Call Locations

Tool registry and built-in tool definitions:

- `src/service/action_tools/registry.mjs`
- `src/service/capabilities/schemas/index.mjs`
- `src/service/action_tools/tools/index.mjs`
- `src/service/capabilities/tools/memory-tools.mjs`
- `src/service/capabilities/tools/skill-install-tools.mjs`
- `src/service/capabilities/tools/vision-analyze.mjs`
- `src/service/connectors/tools/*.mjs`

Major built-in tool ids found:

- Browser/system: `open_url`, `fetch_url_content`, `web_search`,
  `web_search_fetch`, `launch_app`, `open_file`, `reveal_in_explorer`
- Clipboard/notifications: `copy_to_clipboard`, `read_clipboard`, `notify`
- Scheduler: `create_scheduled_task`, `list_scheduled_tasks`,
  `delete_scheduled_task`, `pause_scheduled_task`
- Files/artifacts: `write_file`, `edit_file`, `list_files`, `glob_files`,
  `find_recent_files`, `get_latest_artifact`, `stat_file`,
  `read_file_text`, `read_folder_text`, `search_file_content`,
  `index_file_content`, `verify_file_exists`, `register_artifact`,
  `resolve_output_path`
- Documents/diagrams: `generate_document`, `render_diagram`, `render_svg`
- System/script/GUI: `take_screenshot`, `run_script`, `gui_find_element`,
  `gui_click`, `gui_type_text`
- Memory/session: `recall_memory`, `list_recent_tasks`, `get_task_detail`,
  `list_conversation_artifacts`
- Skills/capabilities: `preview_skill_from_github`,
  `install_skill_from_github`, `draft_capability`,
  `save_capability_draft`
- Vision: `vision_analyze`

Tool execution paths:

- Tool-using executor: `src/service/executors/tool_using/agent-loop.mjs`
  calls `registry.call(...)`, emits `tool_call_proposed` and
  `tool_call_completed`, handles approval, finalization, fallback artifacts,
  phase gates, and policy gates.
- Agentic executor: `src/service/executors/agentic/planner.mjs` and
  `src/service/executors/agentic/tool-execution.mjs` execute tool calls and
  emit tool events.
- Connector tools aggregate from:
  `src/service/connectors/tools/action-tool-aggregator.mjs`.

Risk: tool policy/filtering is split across `action_tools/policy-guard.mjs`,
`action_tools/risk_matrix.mjs`,
`executors/tool_using/tool-surface.mjs`,
`executors/agentic/tool-surface.mjs`, side-effect gates, scheduler gates,
phase gates, connector planners, and route/admin approval handling.

## Artifact Creation Locations

Service/storage:

- `src/service/store/artifact-store.mjs`
- `src/service/core/store/sqlite-store.mjs`
- `src/service/core/store/artifact-metadata.mjs`
- `src/service/core/artifact-action-contract.mjs`
- `src/service/core/artifact-fallback-policy.mjs`
- `src/service/core/artifact-quality.mjs`
- `src/service/core/artifact-extracts/artifact-extract-service.mjs`
- `src/service/core/artifact-lineage/artifact-lineage-service.mjs`
- `src/service/core/artifact-transforms/artifact-transform-service.mjs`

Tool-level artifact generation:

- `src/service/action_tools/tools/index.mjs`
  - `write_file`
  - `edit_file`
  - `generate_document`
  - `render_diagram`
  - `render_svg`
  - `take_screenshot`
  - `run_script`
  - `register_artifact`
- `src/service/capabilities/tools/document-renderer.mjs`

Executor-level artifact logic:

- `src/service/executors/tool_using/agent-loop.mjs`
- `src/service/executors/agentic/planner.mjs`
- `src/service/executors/kimi/output-format.mjs`
- `src/service/executors/shared/artifact-tool-preflight.mjs`
- `src/service/executors/shared/previewable-artifact-tools.mjs`

Renderer artifact display/opening:

- `src/desktop/renderer/overlay.js`
- `src/desktop/renderer/console.js`
- `src/desktop/renderer/live-preview.js`
- `src/desktop/renderer/preview-window.js`
- `src/desktop/renderer/preview/handlers/*.js`
- `src/desktop/renderer/console-task-detail.mjs`
- `src/desktop/renderer/console-projects-view.mjs`

Risk: artifact semantics are split between creation, store registration,
metadata inference, fallback policy, extract/lineage services, live preview,
conversation/project indexes, and renderer open/reveal behavior. The newer
extract/lineage/transform services are the right direction, but old artifact
surfaces remain reachable.

## Provider/Model-Call Locations

Provider catalog/config:

- `src/shared/provider-catalog.mjs`
- `src/shared/provider-configuration.mjs`
- `src/service/ai/providers/*.mjs`
- `src/service/core/http-routes/config-provider-routes.mjs`

Provider resolution:

- `src/service/executors/shared/provider-resolver.mjs`

Provider calls:

- `src/service/executors/agentic/provider-adapter.mjs`
  - Anthropic `/v1/messages`
  - OpenAI-compatible `/chat/completions`
  - Ollama `/api/chat`
  - code CLI subprocess bridge
- `src/service/executors/fast/fast-executor.mjs`
- `src/service/executors/multi_modal/multi-modal-executor.mjs`
- `src/service/executors/agentic/code-cli-bridge.mjs`
- `src/service/executors/kimi/kimi-cli-executor.mjs`
- `src/service/executors/kimi/output-format.mjs`
- `src/service/core/intent/semantic-router.mjs`
- `src/service/capabilities/tools/vision-analyze.mjs`
- Audio/translation paths where configured.

Provider health/model discovery:

- `src/service/ai/providers/runtime.mjs`
- `src/service/ai/providers/model-discovery.mjs`
- `src/service/core/http-routes/ai-status-routes.mjs`
- `src/service/core/http-routes/config-provider-routes.mjs`

Risk: the adapter centralizes most chat-generation calls, but provider
resolution still reads config synchronously and per-task provider behavior is
spread across executors, route preflight, semantic router, Kimi/code-CLI paths,
vision tools, and health/model-discovery routes.

## State/Store Locations

Persistent local runtime data:

- `%APPDATA%\UCA\config\runtime.json`
- `%APPDATA%\UCA\data\secrets.json`
- `%APPDATA%\UCA\data\uca.db`
- `%APPDATA%\UCA\logs`
- `%APPDATA%\UCA\outputs`

Store modules:

- `src/service/core/config-store.mjs`
- `src/service/security/secret-store.mjs`
- `src/service/core/store/sqlite-schema.mjs`
- `src/service/core/store/sqlite-store.mjs`
- `src/service/core/store/memory-store.mjs`
- `src/service/core/store/search-index.mjs`
- `src/service/store/artifact-store.mjs`
- `src/service/store/notes-store.mjs`
- `src/service/scheduler/store.mjs`
- `src/service/embeddings/store.mjs`
- `src/service/dag/scheduler.mjs`

Important SQLite tables:

- `tasks`
- `task_events`
- `artifacts`
- `artifact_extracts`
- `artifact_lineage`
- `artifact_lineage_sources`
- `schedules`
- `schedule_runs`
- `pending_approvals`
- `audit_logs`
- `connected_accounts`
- `oauth_tokens`
- `reauth_requests`
- `conversations`
- `conversation_messages`
- `conversation_message_tasks`
- `conversation_sessions`
- `session_items`
- `unified_search_index`

Renderer-local state:

- Large in-memory state objects in `console.js`, `overlay.js`, `dock.js`,
  `preview-window.js`, and specialized renderer modules.
- Renderer fetches and caches conversation/task/artifact data directly through
  HTTP and `window.ucaShell`.

## Files With Mixed Responsibilities

| File | Mixed responsibilities | Refactor risk |
| --- | --- | --- |
| `src/desktop/tray/electron-main.mjs` | Electron lifecycle, tray/windows, IPC registration, payload normalization, HTTP proxying, settings, update, active-window capture, preview/popup, GUI smoke, diagnostics. | High |
| `src/desktop/renderer/console.js` | Console UI, routing between panes, direct HTTP calls, settings mutations, providers/connectors/skills/MCP/schedules/notes/tasks, artifact open/preview, SSE handling. | High |
| `src/desktop/renderer/overlay.js` | Overlay UI, voice/note handling, active-window/context capture, task submission, SSE rendering, approval handling, artifact preview/open, popup interactions. | High |
| `src/service/action_tools/tools/index.mjs` | Many unrelated action tools, document generation, file ops, GUI automation, scheduler tools, web fetch/search, capability tools, output path logic. | High |
| `src/service/core/context-submission.mjs` | Context normalization, triage, routing, semantic router, task creation, memory/file/artifact recall, Kimi fallback, executor dispatch. | High |
| `src/service/core/task-spec.mjs` | Task intent/spec construction, artifact requirements, policy contracts, routing metadata. | Medium/High |
| `src/service/executors/tool_using/agent-loop.mjs` | Prompt/tool planning, provider calls, tool policy, tool execution, approval, preview, finalization, fallback artifact recovery. | High |
| `src/service/executors/agentic/planner.mjs` | Provider loop, tool calls, search shortcut paths, artifact events, validation/finalization. | High |
| `src/service/core/http-routes/config-provider-routes.mjs` | Config CRUD, provider model options, email config, skills/MCP/code-CLI mutation routes. | Medium |
| `src/service/core/http-routes/audio-routes.mjs` | Audio status, KWS, enrollment, transcription, TTS, Python subprocess management, SSE streaming. | Medium/High |
| `src/desktop/renderer/preload.cjs` | Safe bridge plus broad API facade for shell, files, runtime mutations, popup/preview, audio, tasks, connectors, skills, notes. | Medium/High |

## Duplicated or Scattered Logic

| Concern | Current scattered locations |
| --- | --- |
| Tool filtering/policy | `action_tools/policy-guard.mjs`, `risk_matrix.mjs`, `executors/tool_using/tool-surface.mjs`, `executors/agentic/tool-surface.mjs`, side-effect gates, scheduler gates, connector planners. |
| Artifact path/kind inference | `action_tools/tools/index.mjs`, `core/artifact-action-contract.mjs`, `core/artifact-quality.mjs`, `core/artifact-transforms/*`, renderer preview/open logic, Kimi output format. |
| Artifact display/preview/open | `overlay.js`, `console.js`, `live-preview.js`, `preview-window.js`, preview providers, preview route handlers, `preload.cjs`. |
| Provider resolution/calls | `provider-resolver.mjs`, `provider-adapter.mjs`, fast/multimodal/agentic/Kimi executors, semantic router, provider health/model discovery routes. |
| Conversation/task context | `context-submission.mjs`, `task-record.mjs`, `conversation-lifecycle.mjs`, `context/context-compiler.mjs`, renderer conversation cache, memory tools. |
| HTTP client calls from UI | `src/desktop/console/runtime-client.mjs`, many direct `fetch` calls in `console.js`, `overlay.js`, `dock.js`, `task-event-stream.js`, and some panel modules. |
| IPC channel mapping | `manifest.mjs`, `preload.cjs`, `electron-main.mjs`, `popup-card-manager.mjs`, renderer call sites. |
| Runtime state summaries | SQLite store, memory store scaffold, task trace summary, renderer state, history/search index, embedding store. |

## Misplaced Files or Logic

These are structural observations only; no moves should happen in this audit
phase.

| Current location | Why it is misplaced or borderline | Target layer |
| --- | --- | --- |
| `src/desktop/tray/electron-main.mjs` HTTP proxy handlers | Main process owns many runtime mutation proxies and normalization helpers. Main should ideally route IPC to a small typed bridge/proxy module. | main boundary module plus service client helper |
| `src/desktop/renderer/console.js` direct runtime mutation calls | Renderer is not UI-only; it reaches many service routes and owns broad workflow state. | renderer UI + generated service client |
| `src/desktop/renderer/overlay.js` context/task submission logic | Overlay owns active-window/context prep and task submission details. | renderer UI + service-owned context/task client |
| `src/desktop/renderer/preload.cjs` file read helpers | Bridge exposes direct file reads for preview. This may be acceptable short term, but it bypasses service artifact/preview policy. | preload typed bridge; file preview through service where policy matters |
| `src/service/action_tools/tools/index.mjs` document rendering and GUI automation | Too many tool families in one module. | service action tool submodules |
| `src/service/core/context-submission.mjs` executor dispatch and background recall patching | Submission path owns orchestration and several recall/fallback behaviors. | service orchestrator/task runtime modules |
| `src/service/extractors/*` heavy extraction in service process | Extraction exists outside main/renderer, which is good, but not in a worker lane. | workers/service background lane |
| `src/service/executors/shared/provider-resolver.mjs` sync config/secret read | Hot provider resolution uses sync filesystem access for hot reload. | service config cache or async resolver, guarded by metrics |
| `src/desktop/console/runtime-client.mjs` imports `src/service/cost/pricing.mjs` | Desktop UI helper imports service pricing data directly. | shared pricing contract or HTTP-provided view model |

## Recommended Target Structure

Suggested target, preserving current product behavior while improving layer
boundaries:

```text
src/
  desktop/
    main/
      electron-main.mjs              # lifecycle only
      windows/
      ipc/
        register-shell-ipc.mjs
        register-runtime-proxy-ipc.mjs
        channels.generated.mjs
      shell/
        active-window-context.mjs
        popup-card-manager.mjs
        preview-window-manager.mjs
    preload/
      preload.cjs
      uca-shell-api.generated.d.ts
    renderer/
      overlay/
      console/
      dock/
      popup-card/
      preview-window/
      shared/
  service/
    core/
      http/
      task-runtime/
      session/
      context/
      artifact/
      provider/
      policy/
      queue/
      storage/
    executors/
    tools/
      files/
      documents/
      web/
      system/
      scheduler/
      memory/
      connectors/
      gui/
    workers/
      artifact-extract-worker.mjs
      file-index-worker.mjs
      audio-transcribe-worker.mjs
    connectors/
    scheduler/
  shared/
    contracts/
      ipc.ts
      http.ts
      task.ts
      artifact.ts
      provider.ts
      tool.ts
    schemas/
    constants/
    errors/
```

## Proposed Moves and Risk Levels

| Proposed move | Risk | Rationale |
| --- | --- | --- |
| Extract `electron-main.mjs` IPC route groups into `src/desktop/main/ipc/*.mjs` without changing channels | Medium | Large but mostly mechanical; risk is missing a handler or actor header. Add verifier before moving. |
| Generate or centralize preload API contract from `manifest.mjs` + typed method map | Medium/High | Broad surface; existing renderer calls are numerous. Needs compatibility facade. |
| Move renderer direct `fetch` calls behind console/overlay runtime clients | Medium | Behavior should not change, but UI has many call sites and loading states. |
| Split `action_tools/tools/index.mjs` into per-family modules | High | Tool ids, schemas, policy, tests, and prompt visibility depend on stable exports. Needs registry snapshot verifier. |
| Move artifact generation helpers from `tools/index.mjs` into document/file artifact services | High | Artifact success contracts and preview behavior are sensitive. |
| Introduce `src/service/workers/artifact-extract-worker.mjs` for extractors | Medium/High | Requires cancellation/timeouts/progress and careful packaging. |
| Move provider resolution sync config reads behind service-owned cached config resolver | Medium | Hot reload behavior must remain; tests should prove provider switch takes effect on next task. |
| Consolidate artifact kind/path inference into one shared service module | Medium | Many callers; can start additive and migrate gradually. |
| Consolidate tool policy/surface filtering between agentic and tool_using executors | High | Incorrect tool exposure can cause side effects or missing capabilities. |
| Move UI view-model data shaping out of large renderer files into small modules | Low/Medium | UI risk only if contracts are preserved; can be phased safely. |

## Proposed Phased Refactor Plan

Phase 0: Documentation and guardrails

- Keep current audit files as baseline.
- Add or update verifiers before broad moves.
- No source moves until no-touch boundaries and contracts are agreed.

Phase 1: Contract inventory and tests

- Create an IPC contract inventory from `manifest.mjs`, `preload.cjs`, and
  `electron-main.mjs`.
- Create an HTTP route inventory verifier for route group ownership.
- Add snapshot coverage for built-in tool ids and artifact-producing tool ids.
- Add renderer call-site inventory for direct `fetch` and `window.ucaShell`.

Phase 2: Electron main decomposition

- Extract IPC registration groups from `electron-main.mjs` into small modules:
  shell/window, preview, popup, runtime proxy, config/admin, audio, task.
- Keep existing channel names and payloads.
- Leave lifecycle/window creation in main.

Phase 3: Renderer service-client cleanup

- Route console/overlay direct HTTP calls through dedicated runtime client
  modules.
- Keep renderer as UI/event rendering; move request payload normalization into
  shared client helpers or service route schemas.

Phase 4: Tool registry decomposition

- Split `action_tools/tools/index.mjs` by tool family while preserving one
  exported `BUILTIN_ACTION_TOOLS` aggregation.
- Add blocking verifier for tool id changes and artifact tool visibility.

Phase 5: Artifact boundary consolidation

- Make artifact kind/path inference, artifact registration options, fallback
  policy, extract records, lineage, and transform contracts service-owned and
  callable from executors/tools.
- Migrate old reachable artifact code only after verifier coverage proves the
  new path.

Phase 6: Worker/background lanes

- Add `src/service/workers/` for artifact extraction and possibly file indexing
  or audio jobs.
- Keep heavy parse/OCR/index work out of Electron main and renderer.
- Use additive feature flags and package verification.

Phase 7: Provider boundary cleanup

- Keep `provider-adapter.mjs` as the provider-call boundary.
- Move provider resolution/config hot reload behind an async/cached service
  resolver with metrics.
- Ensure semantic router, fast executor, agentic executor, vision, and code CLI
  all use the same provider contract.

## Files That Should Not Be Touched Yet

Do not modify these until the next scoped PR identifies module boundaries,
interface contracts, test gates, and rollback paths:

- `src/desktop/tray/electron-main.mjs`
- `src/desktop/renderer/preload.cjs`
- `src/desktop/renderer/console.js`
- `src/desktop/renderer/overlay.js`
- `src/service/action_tools/tools/index.mjs`
- `src/service/core/context-submission.mjs`
- `src/service/core/task-spec.mjs`
- `src/service/executors/tool_using/agent-loop.mjs`
- `src/service/executors/agentic/planner.mjs`
- `src/service/executors/agentic/provider-adapter.mjs`
- `src/service/executors/shared/provider-resolver.mjs`
- `src/service/core/store/sqlite-schema.mjs`
- `src/service/core/store/sqlite-store.mjs`
- `src/service/core/session/*`
- `src/service/core/context/context-compiler.mjs`
- `src/service/core/artifact-extracts/*`
- `src/service/core/artifact-lineage/*`
- `src/service/core/artifact-transforms/*`
- `scripts/verify-*.mjs`
- generated/build/runtime output directories such as `dist/`, `.tmp/`,
  `tmp/`, `node_modules/`, `src/helper/**/bin`, and `src/helper/**/obj`

## Layer Location Answer

main / preload / renderer / service / worker related code positions:

| Layer | Current code location |
| --- | --- |
| main | `index.cjs`; `src/desktop/tray/electron-main.mjs`; supporting shell files in `src/desktop/tray/*.mjs` |
| preload | `src/desktop/renderer/preload.cjs` |
| renderer | `src/desktop/renderer/*.js`, `*.mjs`, `*.html`, `*.css`; view models under `src/desktop/console/` and `src/desktop/overlay/` |
| service | `src/service/**`; key runtime entrypoints are `src/service/core/persistent-runtime.mjs`, `src/service/core/service-bootstrap.mjs`, `src/service/core/http-server.mjs`, and `src/service/core/context-submission.mjs` |
| worker | No dedicated worker layer exists. Worker-like/heavy jobs currently live in `src/service/extractors/`, `src/service/audio/`, `src/service/action_tools/tools/index.mjs`, `src/service/core/external-call.mjs`, subprocess-backed code CLI modules, PowerShell/Python scripts, and helper/native projects |
