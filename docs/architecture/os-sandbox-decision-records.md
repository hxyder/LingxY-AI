# OS Sandbox Decision Records

This file is the current isolation decision inventory for high-risk runtime
surfaces. It does not introduce a new OS sandbox by itself. It records the
boundary that exists today, the evidence required before changing it, and the
rollback/user-recovery contract for each surface.

Source of truth:

- `src/service/security/isolation-decision-records.mjs`
- `scripts/verify-sandbox-decision-records.mjs`
- `tests/behavior/isolation-decision-records.test.mjs`

## Current decisions

| ID | Owner | Boundary | Decision |
| --- | --- | --- | --- |
| `file_operations` | `src/service/capabilities/tools` | `service_in_process` | Keep service path policy, approvals, artifact lineage, and reversibility checkpoints; no OS sandbox yet. |
| `external_commands` | `src/service/capabilities/tools` | `child_process` | Keep explicit child-process lanes with approval, timeout, working-directory, and output capture controls. |
| `browser_automation` | `src/desktop` and `src/service/browser` | `child_process` | Use browser/extension process boundaries and typed IPC/service routes; do not move browser state into Electron main. |
| `ocr_extractors` | `src/service/extractors` | `deferred` | Treat OCR as worker/child-process candidate; require measured latency and memory evidence before OS sandbox or native sidecar. |
| `audio_daemons` | `src/service/audio` | `external_daemon` | Existing daemon helpers require lifecycle owner, circuit breaker, cancellation, and fallback contracts. |
| `mcp_install_sandbox` | `src/service/capabilities/mcp` | `child_process` | Keep package installs scoped to the configured MCP install sandbox directory. |

## Invariants

- High-risk actions must have an explicit isolation decision before boundary
  changes.
- Native helpers, OS sandboxes, and persistent sidecars require a sidecar
  decision record before implementation.
- A sidecar is not an acceptable general business-logic rewrite. It must solve
  a measured isolation, packaging, hardware, or performance problem that cannot
  be handled by service code, workers, or child processes.
- Every decision must name rollback and user recovery behavior before code is
  wired.

## Verification

Run:

```powershell
node scripts/verify-sandbox-decision-records.mjs
node --test tests/behavior/isolation-decision-records.test.mjs
node scripts/verify-privacy-sandbox-policy.mjs
```
