# Security Policy Trace Export

SH-003 adds a user-readable, redacted policy trace to the existing runtime export
and diagnostic bundle surfaces.

Source of truth:

- `src/service/security/policy-trace-export.mjs`
- `tests/behavior/policy-trace-export.test.mjs`
- `scripts/verify-policy-trace-export.mjs`

## Included

- Security audit decisions such as `tool.blocked_by_policy`,
  `tool.rate_limited`, `llm.call`, `redaction.applied`, `kill_switch.toggle`,
  `presenter_mode.toggle`, and `redaction.state_lost`.
- Pending approval summaries with approval id, task id, tool id, risk level,
  status, and reason.
- Task policy events such as approval, blocked, policy, privacy, redaction, kill
  switch, and presenter-mode events.
- Summary counts for decisions, blocked decisions, approvals, and policy task
  events.

## Excluded

The policy trace is intentionally a summary. It does not include raw tool
arguments or raw context text. It also redacts API keys, OAuth tokens, secret
store values, authorization headers, cookies, passwords, and credentials.

## Export Surfaces

- `buildRuntimeExportBundle()` includes `policyTrace` and declares
  `policy_trace_redacted` in the manifest.
- `buildRuntimeDiagnosticBundle()` includes a bounded `policyTrace` and declares
  `policy_trace` in the manifest.

## Verification

Run:

```powershell
node scripts/verify-policy-trace-export.mjs
node --test tests/behavior/policy-trace-export.test.mjs
```
