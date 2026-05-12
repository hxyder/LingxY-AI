# Live Provider Acceptance Harness

`LAPI-001` adds an opt-in real-provider acceptance lane without making CI
depend on paid APIs.

The harness is owned by the service/runtime verification layer:

- Contract: `src/shared/live-provider-acceptance-harness.mjs`
- Runner: `scripts/real-llm-test/run-live-provider-acceptance.mjs`
- Verifier: `scripts/verify-live-provider-acceptance-harness.mjs`
- Template evidence: `docs/release/evidence/live-provider-acceptance.template.json`

Default command:

```powershell
node scripts/real-llm-test/run-live-provider-acceptance.mjs
```

The default command is a dry run. It validates the evidence shape and writes a
redacted report under `.tmp/live-provider-acceptance` without calling a live
provider.

Live command:

```powershell
$env:LINGXY_LIVE_PROVIDER_ACCEPTANCE='1'
node scripts/real-llm-test/run-live-provider-acceptance.mjs --live
```

Live mode starts or attaches to the runtime, reads `/health`, `/ai/providers`,
and `/config/integrations`, submits one short background `/task`, then polls
`/task/:id` for `llm_usage` events. It records provider setup, role routing,
token usage, and cache hit/miss visibility when the provider reports it. Cost
estimates are not displayed by default because published prices can drift.
Fault recovery rows are present in the
contract but skipped unless a run intentionally induces missing-key, rate-limit,
invalid-model, or provider-failure cases.

## Redacted Evidence

Reports must not store API keys, authorization headers, raw provider request
bodies, or prompt secrets. The shared validator rejects API-key-like strings in
the final report.
