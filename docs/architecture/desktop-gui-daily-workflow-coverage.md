# Desktop GUI Daily Workflow Coverage

DXR-002 groups the existing real Electron GUI smoke checks into daily product
workflow coverage. It does not replace `docs/release/desktop_product_acceptance_matrix.md`;
it makes the current real smoke output fail fast if conversation continuity,
task operations, or artifact workflow coverage regresses.

Source of truth:

- `src/shared/desktop-gui-smoke-workflow-coverage.mjs`
- `scripts/verify-desktop-gui-daily-workflow-coverage.mjs`
- `tests/behavior/desktop-gui-smoke-workflow-coverage.test.mjs`
- `src/desktop/smoke/desktop-gui-smoke-runner.mjs`

## Covered Workflows

| Workflow | Required real GUI smoke checks |
| --- | --- |
| `conversation_continuity` | `console_conversation_isolation`, `console_chat_branch_fork`, `console_chat_branch_rewind`, `console_chat_branch_edit` |
| `task_operations` | `task_cancel_ipc_bridge`, `overlay_stop_button_cancel`, `console_stop_button_cancel`, `console_task_detail_cancel`, `overlay_inline_error_retry`, `console_inline_error_retry` |
| `artifact_workflow` | `preview_generate_document_initial_draft`, `preview_generate_document_draft_family_matrix`, `preview_generate_document_screenshot_diff`, `preview_task_binding_isolation` |

## Rules

- The smoke runner must keep these check names stable unless the shared
  coverage contract, behavior tests, and verifier are updated in the same
  change.
- Visible desktop workflow changes in these rows still need
  `npm run verify:desktop-gui-smoke`; `check:fast` alone is not enough.
- The desktop product evidence pack should record the real smoke result when a
  release candidate exercises these workflows.

## Verification

Run:

```powershell
node scripts/verify-desktop-gui-daily-workflow-coverage.mjs
node --test tests/behavior/desktop-gui-smoke-workflow-coverage.test.mjs
npm run verify:desktop-gui-smoke
```
