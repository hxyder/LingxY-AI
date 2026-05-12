# Permission Mode Model

RT-004 defines one shared contract for task execution modes, approval behavior,
privacy sandbox state, and the user-visible tool surface.

## Decision

`src/shared/permission-mode-model.mjs` is the canonical mode contract. The
service writes the contract into `task.context_packet.selection_metadata` when a
task record is created, and the `task_created` trace event carries the same
contract for auditability. Console and Overlay render this shared contract
instead of inferring mode behavior from local UI state.

## Current Modes

| Mode | User-visible meaning | Approval behavior |
| --- | --- | --- |
| `interactive` | User-present task | Confirmation-required tools pause for approval. |
| `approval_required` | Task expected to pause before side effects | Confirmation-required tools pause for approval. |
| `unattended_safe` | Background-safe task | No interactive prompt; high-risk tools are blocked. |
| `background` | Async desktop task | Confirmation-required tools pause for approval. |
| `auto` | Runtime-selected path | Confirmation-required tools pause for approval. |
| `single` | Legacy single-step path | Confirmation-required tools pause for approval. |

The contract also exposes privacy-sandbox flags such as `local_only` and blocked
capabilities. There is no current dry-run execution mode, so `dry_run_like`
remains explicitly false until a real runtime path exists.

## Invariants

- Renderer code must display the shared contract; it must not decide runtime
  approval behavior.
- Tool approval gates use `shouldPromptForToolApproval`.
- Unattended high-risk blocking uses `shouldBlockToolForExecutionMode`.
- Privacy sandbox policy remains owned by `src/shared/privacy-sandbox-policy.mjs`
  and enforced through the security broker.
- Mode visibility must stay present in Console task detail and Overlay active
  task surfaces.

## Verification

- `node scripts/verify-permission-mode-model.mjs`
- `node scripts/verify-privacy-sandbox-policy.mjs`
- `node scripts/verify-approval-task-bridge.mjs`
- `npm run check:fast`
