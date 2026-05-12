# Sidecar Decision Record

Use this template before adding any new native helper, long-running daemon,
Python/Rust/Go sidecar, OS-level sandbox, or process-isolated service. This is
required even when the sidecar looks small.

Sidecars are prohibited as a general business-logic rewrite. They are allowed
only when the decision record proves a measured bottleneck, isolation need,
hardware integration need, or packaging boundary that cannot be handled by
existing service code, workers, or child processes.

## Required fields

- `id`: stable decision id.
- `owner`: owning module and owning team/person.
- `scope`: exact runtime surface covered.
- `measuredBottleneck`: measurement or concrete risk that justifies a new
  process boundary.
- `workerInsufficientReason`: why a JS worker or ordinary child process is not
  enough.
- `serializationBoundary`: typed messages, schemas, payload size limits, and
  secret redaction rules across the process boundary.
- `cancellationBoundary`: how cancellation, timeout, and process cleanup work.
- `failureBehavior`: what happens on crash, timeout, bad output, or startup
  failure.
- `packagingImpact`: installer, auto-update, signing/codesign, antivirus, and
  platform impact.
- `rollbackPath`: how to disable or remove the sidecar without breaking existing
  tasks.
- `userRecovery`: user-visible diagnostics and recovery controls.
- `businessLogicRewriteProhibited`: must be `true`.

## Template

```json
{
  "id": "example_sidecar",
  "owner": "src/service/example",
  "scope": "Exact feature or capability surface.",
  "measuredBottleneck": "Measured latency/memory/isolation evidence.",
  "workerInsufficientReason": "Why worker/child_process is insufficient.",
  "serializationBoundary": "Typed request/response schema and redaction.",
  "cancellationBoundary": "Timeout/cancel/cleanup contract.",
  "failureBehavior": "Crash/timeout/startup failure behavior.",
  "packagingImpact": "Installer, update, signing, and platform impact.",
  "rollbackPath": "Feature flag, disable path, or removal path.",
  "userRecovery": "User-visible diagnostics and recovery.",
  "businessLogicRewriteProhibited": true
}
```

## Verification

Run:

```powershell
node scripts/verify-sandbox-decision-records.mjs
```
