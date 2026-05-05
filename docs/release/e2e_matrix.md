# E2E Validation Matrix

## Scope

Trial channel baseline: `0.1.0-trial.1`

For the broader user-visible feature contract, see
[`functional_acceptance_matrix.md`](functional_acceptance_matrix.md). This
file remains the trial-channel E2E subset.

## Matrix

| Area | Flow | Expected result | Status |
|---|---|---|---|
| Runtime bootstrap | Start local runtime with `node scripts/start-runtime.mjs` | Runtime exposes `/health` and `/ai/code-cli` | verified via release readiness smoke |
| Kimi Code CLI | Submit clipboard/file task to Kimi print-mode executor | Task reaches `success` and writes `report.md` artifact | verified via automated smoke |
| Explorer entry | Install helper and submit files from Explorer entry | File capture reaches runtime with dedupe-safe batch handling | verified via native integration smoke |
| Browser extension | Right-click selected text and dispatch to native host | Selection payload reaches runtime and task is created | verified via extension smoke |
| Browser floating chip | Selection chip placement and rule gating | Chip appears only on allowed surfaces and remains stable | verified via overlay smoke |
| Office sideload | Load Word/Excel/PPT add-in and submit selection | Office bridge forms valid runtime payload | verified via Office base smoke |
| Scheduler approvals | Trigger manual schedule run | Run is recorded as `success` or `pending_approval` | verified via scheduler smoke |
| Console operator actions | Retry, cancel, approve, reject, manual schedule dispatch | Console runtime client actions succeed over HTTP | verified via runtime client smoke |
| Template persistence | Save/export/import user template | Template survives runtime restart | verified via persistence smoke |
| DAG resume | Resume failed DAG from checkpoint | Resumed execution reaches `success` | verified via persistence smoke |
| History search persistence | Search after runtime restart | Prior records remain queryable | verified via persistence smoke |
| Release bundle | Build trial package | Versioned bundle and manifest are generated in `dist/trial/` | verified via release readiness smoke |

## Remaining Manual Pass

- Fresh Windows machine install
- Browser extension side-load in clean profile
- Office task pane manual sideload in tenant or desktop sideload mode
- Packaging smoke with Defender / SmartScreen notes captured
