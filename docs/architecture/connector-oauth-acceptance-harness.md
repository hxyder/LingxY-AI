# Connector OAuth Acceptance Harness

`CONN-001` adds an opt-in real connector/OAuth evidence lane for Google and
Microsoft accounts without making CI depend on external tenants.

Owned files:

- Contract: `src/shared/connector-oauth-acceptance-harness.mjs`
- Runner: `scripts/real-connector-test/run-connector-oauth-acceptance.mjs`
- Verifier: `scripts/verify-connector-oauth-acceptance-harness.mjs`
- Template: `docs/release/evidence/connector-oauth-acceptance.template.json`

Default command:

```powershell
node scripts/real-connector-test/run-connector-oauth-acceptance.mjs
```

The default is a dry run. It validates report shape and writes a redacted
evidence report without OAuth or connector network calls.

Live command:

```powershell
$env:LINGXY_CONNECTOR_OAUTH_ACCEPTANCE='1'
node scripts/real-connector-test/run-connector-oauth-acceptance.mjs --live
```

Live mode starts or attaches to the runtime, verifies `/connectors/catalog`,
checks Google/Microsoft connector config, starts OAuth when a client id exists,
reads connected-account status, and exercises read-list endpoints for connected
accounts. Reports store counts and statuses only; message bodies, file
contents, OAuth codes, tokens, and authorization headers are omitted or
redacted.

## Redacted Evidence

Guarded side effects and disconnects are disabled by default. They require
separate flags plus environment gates and should use disposable test accounts
only. The report contract still records these rows so release evidence can show
whether they were run, skipped, or blocked by policy.
