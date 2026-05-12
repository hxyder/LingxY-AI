# OS Sandbox Implementation Decision

SH-004 records the implementation decision for the current high-risk runtime
surfaces. It does not introduce a new OS sandbox. The current decision is to
keep existing service, child-process, browser-process, and daemon boundaries
until measured evidence proves that an OS sandbox, native helper, or sidecar is
needed.

Source of truth:

- `src/service/security/isolation-decision-records.mjs`
- `src/service/security/os-sandbox-implementation-decision.mjs`
- `scripts/verify-sandbox-decision-records.mjs`
- `scripts/verify-os-sandbox-implementation-decision.mjs`
- `tests/behavior/os-sandbox-implementation-decision.test.mjs`

## Current decision

| ID | Current boundary | Implementation decision | Evidence required before change |
| --- | --- | --- | --- |
| `file_operations` | `service_in_process` | `do_not_os_sandbox_now` | Measured path-policy escape, unbounded write latency, or cross-process mutation requirement that cannot be enforced by service policy, approvals, artifact lineage, and reversibility checkpoints. |
| `external_commands` | `child_process` | `keep_child_process_lane` | Repeated event-loop blocking, uncontrolled process lifetime, or concrete need for OS-level syscall restrictions beyond approval, timeout, cwd, and output capture controls. |
| `browser_automation` | `child_process` | `keep_browser_process_boundary` | Need to execute untrusted page code outside browser sandbox or to operate a persistent automation daemon outside the browser/extension process boundary. |
| `ocr_extractors` | `deferred` | `measure_before_sidecar_or_os_sandbox` | Latency, memory, packaging, or binary-execution measurements proving that worker or child-process extraction is insufficient. |
| `audio_daemons` | `external_daemon` | `keep_external_daemon_with_breaker` | New native audio helper, GPU-bound model hosting, or persistent microphone capture that cannot fit the existing daemon lifecycle, circuit breaker, cancellation, and fallback contract. |
| `mcp_install_sandbox` | `child_process` | `keep_install_sandbox_child_process` | Remote package execution risk that requires stronger per-package isolation or signed marketplace distribution beyond the configured MCP install sandbox directory. |

## Invariants

- `noNewOsSandbox` is true for the current program.
- Every current isolation decision must have a matching implementation
  decision, rollback path, and user recovery contract.
- OS sandboxing cannot be used as a generic product refactor or business-logic
  rewrite.
- Future OS sandbox work must first update the isolation decision record,
  implementation decision, behavior tests, and verifier in the same change.
- A real API, GUI, hardware, or packaged-build test is required only when the
  candidate boundary depends on that surface; deterministic policy changes must
  remain covered by behavior tests and `check:fast`.

## Verification

Run:

```powershell
node scripts/verify-os-sandbox-implementation-decision.mjs
node --test tests/behavior/os-sandbox-implementation-decision.test.mjs
node scripts/verify-sandbox-decision-records.mjs
node scripts/verify-privacy-sandbox-policy.mjs
```
