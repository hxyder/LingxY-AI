# Tool Registry Inventory

Phase 2A boundary inventory for built-in action tools.

Status: verified against the current repository on 2026-05-09.

## Contract Source

| Surface | Path | Owner |
| --- | --- | --- |
| Registry implementation | `src/service/action_tools/registry.mjs` | Service runtime |
| Built-in tool definitions | `src/service/action_tools/tools/index.mjs` | Service runtime |
| Schemas | `src/service/action_tools/schemas/index.mjs` | Service runtime |
| Tool result shape | `src/service/action_tools/types.mjs` | Service runtime |
| Tool execution submission | `src/service/core/action-tool-submission.mjs` | Service runtime |

## Snapshot

- Built-in tool count: 61
- Tool ids are registry contracts. Do not rename existing ids during reorganization.
- Confirmation-gated tool ids: `send_email_smtp`, `create_scheduled_task`, `delete_scheduled_task`, `index_file_content`, `gui_click`, `gui_type_text`, `save_capability_draft`, `install_skill_from_github`, `account_send_email`.

## Tool Ids

`open_url`, `web_search`, `compose_email`, `send_email_smtp`, `open_file`, `reveal_in_explorer`, `launch_app`, `copy_to_clipboard`, `notify`, `file_op`, `take_screenshot`, `read_clipboard`, `create_scheduled_task`, `list_scheduled_tasks`, `delete_scheduled_task`, `pause_scheduled_task`, `translate_text`, `web_search_fetch`, `fetch_url_content`, `write_file`, `edit_file`, `run_script`, `generate_document`, `render_diagram`, `render_svg`, `list_files`, `glob_files`, `find_recent_files`, `get_latest_artifact`, `stat_file`, `read_file_text`, `read_folder_text`, `search_file_content`, `index_file_content`, `verify_file_exists`, `register_artifact`, `resolve_output_path`, `gui_find_element`, `gui_click`, `gui_type_text`, `vision_analyze`, `recall_memory`, `list_recent_tasks`, `get_task_detail`, `list_conversation_artifacts`, `draft_capability`, `save_capability_draft`, `preview_skill_from_github`, `install_skill_from_github`, `connector_catalog_search`, `connector_catalog_get`, `connector_workflow_run`, `connector_plugin_manage`, `account_list_connected_accounts`, `account_list_emails`, `account_list_events`, `account_list_files`, `account_download_file`, `account_send_email`, `account_upload_file`, `account_create_event`.

## Tool Family Ownership

Phase 2D.0 inventory of current tool family ownership within `src/service/action_tools/tools/index.mjs` (4105 lines).

### Inline families (owned by `tools/index.mjs`)

| Family | Tool IDs | Lines (approx) |
|--------|----------|----------------|
| Browser / Web / Search / Translation | `open_url`, `web_search`, `web_search_fetch`, `fetch_url_content`, `translate_text` | ~450 |
| OS / App / Clipboard / Notification | `open_file`, `reveal_in_explorer`, `launch_app`, `copy_to_clipboard`, `notify`, `read_clipboard`, `file_op`, `take_screenshot` | ~620 |
| Scheduler | `create_scheduled_task`, `list_scheduled_tasks`, `delete_scheduled_task`, `pause_scheduled_task` | ~160 |
| File Write / Script Execution | `write_file`, `edit_file`, `run_script` | ~740 |
| Document / Artifact / Diagram / SVG Generation | `generate_document`, `render_diagram`, `render_svg` | ~680 |
| File Discovery / Read / Index | `list_files`, `glob_files`, `find_recent_files`, `get_latest_artifact`, `stat_file`, `read_file_text`, `read_folder_text`, `search_file_content`, `index_file_content`, `verify_file_exists`, `register_artifact`, `resolve_output_path` | ~1120 |
| GUI Automation | `gui_find_element`, `gui_click`, `gui_type_text` | ~240 |
| Capability Creator | `draft_capability`, `save_capability_draft` | ~350 |
| Email | `compose_email`, `send_email_smtp` | ~100 |

### External families (aggregated into `BUILTIN_ACTION_TOOLS`)

| Family | Source module |
|--------|---------------|
| Vision | vision tools (external) |
| Memory | memory tools (external) |
| Task History | `list_recent_tasks`, `get_task_detail`, `list_conversation_artifacts` (external) |
| Skill Install | `preview_skill_from_github`, `install_skill_from_github` (external) |
| Connector | `connector_catalog_search`, `connector_catalog_get`, `connector_workflow_run`, `connector_plugin_manage` (external) |
| Account | `account_list_connected_accounts`, `account_list_emails`, `account_list_events`, `account_list_files`, `account_download_file`, `account_send_email`, `account_upload_file`, `account_create_event` (external) |

### Phase 2D extraction order (Codex, 2026-05-10)

1. Browser / Web / Search / Translation (lowest risk, self-contained)
2. OS / App / Clipboard / Notification
3. Scheduler
4. File Discovery / Read / Index
5. File Write / Script Execution (higher risk, side effects)
6. Document / Artifact / Diagram / SVG Generation (higher risk, artifact-producing)
7. GUI Automation (higher risk, OS integration)
8. Capability Creator (higher risk, confirmation-gated)
9. Email (keep inline or extract last)

Do not move first round: `write_file`, `edit_file`, `run_script`, `generate_document`, `register_artifact`, `gui_*`.

## Boundary Rules

- Registry id uniqueness is mandatory.
- `BUILTIN_ACTION_TOOLS` order must remain stable (64 ids, frozen order).
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

The verifier imports the built-in registry, checks duplicate ids, confirms the 64-id snapshot, and checks confirmation-gated ids.
