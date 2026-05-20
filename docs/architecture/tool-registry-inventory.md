# Tool Registry Inventory

Phase 2A boundary inventory for built-in action tools.

Status: verified against the current repository on 2026-05-18.

## Contract Source

| Surface | Path | Owner |
| --- | --- | --- |
| Registry implementation | `src/service/capabilities/registry/registry.mjs` | Service runtime |
| Built-in tool aggregation | `src/service/action_tools/tools/index.mjs` | Service runtime |
| Schemas | `src/service/capabilities/schemas/index.mjs` | Service runtime |
| Tool result shape | `src/service/capabilities/registry/types.mjs` | Service runtime |
| Tool execution submission | `src/service/core/action-tool-submission.mjs` | Service runtime |

## Snapshot

- Built-in tool count: 62
- Tool ids are registry contracts. Do not rename existing ids during reorganization.
- Confirmation-gated tool ids: `send_email_smtp`, `create_scheduled_task`, `delete_scheduled_task`, `index_file_content`, `gui_click`, `gui_type_text`, `save_capability_draft`, `install_skill_from_github`, `account_send_email`.

## Tool Ids

`open_url`, `web_search`, `compose_email`, `send_email_smtp`, `open_file`, `reveal_in_explorer`, `launch_app`, `copy_to_clipboard`, `notify`, `file_op`, `take_screenshot`, `read_clipboard`, `create_scheduled_task`, `list_scheduled_tasks`, `delete_scheduled_task`, `pause_scheduled_task`, `translate_text`, `web_search_fetch`, `fetch_url_content`, `download_file`, `write_file`, `edit_file`, `run_script`, `generate_document`, `render_diagram`, `render_svg`, `list_files`, `glob_files`, `find_recent_files`, `get_latest_artifact`, `stat_file`, `read_file_text`, `read_folder_text`, `search_file_content`, `index_file_content`, `verify_file_exists`, `register_artifact`, `resolve_output_path`, `gui_find_element`, `gui_click`, `gui_type_text`, `vision_analyze`, `recall_memory`, `list_recent_tasks`, `get_task_detail`, `list_conversation_artifacts`, `draft_capability`, `save_capability_draft`, `preview_skill_from_github`, `install_skill_from_github`, `connector_catalog_search`, `connector_catalog_get`, `connector_workflow_run`, `connector_plugin_manage`, `account_list_connected_accounts`, `account_list_emails`, `account_list_events`, `account_list_files`, `account_download_file`, `account_send_email`, `account_upload_file`, `account_create_event`.

## Tool Family Ownership

Status after CAP-5H capability creator tool migration (2026-05-11). `tools/index.mjs`
is a live aggregator only.

### Extracted families (own source modules)

| Family | Source module | Tool IDs |
|--------|---------------|----------|
| Browser / Web / Search / Translation | `src/service/capabilities/tools/browser-web-tools.mjs` (~450 lines) | `open_url`, `web_search`, `web_search_fetch`, `fetch_url_content`, `download_file`, `translate_text` |
| OS / App / File / Clipboard / Notify | `src/service/capabilities/tools/os-app-tools.mjs` (~195 lines) | `open_file`, `reveal_in_explorer`, `file_op`, `copy_to_clipboard`, `read_clipboard`, `notify` |
| Email | `src/service/capabilities/tools/email-tools.mjs` (~70 lines) | `compose_email`, `send_email_smtp` |
| Scheduler | `src/service/capabilities/tools/scheduler-tools.mjs` (~140 lines) | `create_scheduled_task`, `list_scheduled_tasks`, `delete_scheduled_task`, `pause_scheduled_task` |
| File Discovery / Read / Stat / Artifact | `src/service/capabilities/tools/file-read-tools.mjs` (~330 lines) | `stat_file`, `verify_file_exists`, `list_files`, `glob_files`, `find_recent_files`, `get_latest_artifact` |
| File Content / Artifact Output | `src/service/capabilities/tools/file-content-tools.mjs` (~525 lines) | `read_file_text`, `read_folder_text`, `search_file_content`, `index_file_content`, `register_artifact`, `resolve_output_path` |
| File Write / Script Execution | `src/service/capabilities/tools/file-mutation-execution-tools.mjs` (~320 lines) | `write_file`, `edit_file`, `run_script` |
| Document / Artifact / Diagram / SVG Generation | `src/service/capabilities/tools/document-render-tools.mjs` (~280 lines) | `generate_document`, `render_diagram`, `render_svg` |
| Capability Creator | `src/service/capabilities/tools/capability-creator-tools.mjs` (~390 lines) | `draft_capability`, `save_capability_draft` |
| Desktop Launch | `src/service/capabilities/tools/desktop-launch-tools.mjs` (~365 lines) | `launch_app` |
| Desktop Capture / GUI Automation | `src/service/capabilities/tools/desktop-capture-gui-tools.mjs` (~260 lines) | `take_screenshot`, `gui_find_element`, `gui_click`, `gui_type_text` |
| Shared document artifact helpers | `src/service/capabilities/tools/document-artifact-helpers.mjs` | document kind inference, PDF/HTML preview helpers, document renderer fallback |
| Shared OS helper | `src/service/capabilities/tools/open-with-default-handler.mjs` | `openWithDefaultHandler` (used by browser-web, os-app, and email tools) |
| Shared file manifest helpers | `src/service/capabilities/tools/file-manifest-helpers.mjs` | `resolveDefaultOutputDir`, `readManifest`, `writeManifest`, `globToRegex` |

### Inline families (still in `tools/index.mjs`)

None. `tools/index.mjs` is the built-in action tool aggregator and re-export
surface only.

### External families (aggregated into `BUILTIN_ACTION_TOOLS`)

| Family | Source module |
|--------|---------------|
| Vision | vision tools (external) |
| Memory | memory tools (external) |
| Task History | `list_recent_tasks`, `get_task_detail`, `list_conversation_artifacts` (external) |
| Skill Install | `preview_skill_from_github`, `install_skill_from_github` (external) |
| Connector | `connector_catalog_search`, `connector_catalog_get`, `connector_workflow_run`, `connector_plugin_manage` (external) |
| Account | `account_list_connected_accounts`, `account_list_emails`, `account_list_events`, `account_list_files`, `account_download_file`, `account_send_email`, `account_upload_file`, `account_create_event` (external) |

### Phase 2D extraction order and completed low-risk history

1. Browser / Web / Search / Translation: extracted in Phase 2D.1, moved to `capabilities/tools/` in CAP-1.
2. OS / App / Clipboard / Notification: extracted in Phase 2D.2a + 2D.2b, moved to `capabilities/tools/` in CAP-1.
3. Scheduler: extracted in Phase 2D.3, moved to `capabilities/tools/` in CAP-1.
4. File Discovery / Read / Index: read/stat/artifact-lookup slice extracted in Phase 2D.4/2D.6, moved to `capabilities/tools/` in CAP-1; file-content/artifact-output slice moved in CAP-5D.
5. Email: `compose_email` extracted in Phase 2D.5 and moved to `capabilities/tools/` in CAP-1; `send_email_smtp` moved to `email-tools.mjs` in CAP-5E to remove stale NOOP coupling.

Do not move without a dedicated high-risk phase and targeted tests: memory tools, vision tools, skill install tools, schemas, registry, policy, or type surfaces.

### Deferred high-risk families

None in `tools/index.mjs`.

## Boundary Rules

- Registry id uniqueness is mandatory.
- `BUILTIN_ACTION_TOOLS` order must remain stable (62 ids, frozen order).
- Tool ids are registry contracts. Do not rename existing ids during reorganization.
- Confirmation-gated tool id list must remain unchanged.
- Tool schemas must remain with the service runtime, not renderer UI.
- Side-effect and confirmation policies must be explicit tool metadata.
- Artifact-producing tools must remain aligned with `docs/architecture/artifact-surface-inventory.md`.
- External module aggregation (connector, memory, vision, skill install) must remain unchanged.

## Verification

Run:

```powershell
node scripts/verify-tool-registry-snapshot.mjs
```

The verifier imports the built-in registry, checks duplicate ids, confirms the 62-id snapshot, and checks confirmation-gated ids.
