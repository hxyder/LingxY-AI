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

- Built-in tool count: 64
- Tool ids are registry contracts. Do not rename existing ids during reorganization.
- Confirmation-gated tool ids: `send_email_smtp`, `create_scheduled_task`, `delete_scheduled_task`, `index_file_content`, `gui_click`, `gui_type_text`, `save_capability_draft`, `install_skill_from_github`, `account_send_email`.

## Tool Ids

`open_url`, `web_search`, `compose_email`, `send_email_smtp`, `open_file`, `reveal_in_explorer`, `launch_app`, `copy_to_clipboard`, `notify`, `file_op`, `take_screenshot`, `read_clipboard`, `create_scheduled_task`, `list_scheduled_tasks`, `delete_scheduled_task`, `pause_scheduled_task`, `translate_text`, `web_search_fetch`, `fetch_url_content`, `write_file`, `edit_file`, `run_script`, `generate_document`, `render_diagram`, `render_svg`, `list_files`, `glob_files`, `find_recent_files`, `get_latest_artifact`, `stat_file`, `read_file_text`, `read_folder_text`, `search_file_content`, `index_file_content`, `verify_file_exists`, `register_artifact`, `resolve_output_path`, `gui_find_element`, `gui_click`, `gui_type_text`, `vision_analyze`, `recall_memory`, `list_recent_tasks`, `get_task_detail`, `list_conversation_artifacts`, `draft_capability`, `save_capability_draft`, `preview_skill_from_github`, `install_skill_from_github`, `connector_catalog_search`, `connector_catalog_get`, `connector_workflow_run`, `connector_plugin_manage`, `account_list_connected_accounts`, `account_list_emails`, `account_list_events`, `account_list_files`, `account_download_file`, `account_send_email`, `account_upload_file`, `account_create_event`.

## Boundary Rules

- Registry id uniqueness is mandatory.
- Tool schemas must remain with the service runtime, not renderer UI.
- Side-effect and confirmation policies must be explicit tool metadata.
- Artifact-producing tools must remain aligned with `docs/architecture/artifact-surface-inventory.md`.

## Verification

Run:

```powershell
node scripts/verify-tool-registry-snapshot.mjs
```

The verifier imports the built-in registry, checks duplicate ids, confirms the 64-id snapshot, and checks confirmation-gated ids.
