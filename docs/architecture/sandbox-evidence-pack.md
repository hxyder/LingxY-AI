# Sandbox Evidence Pack

`SBOX-001` records measured evidence for high-risk surfaces before any sandbox
boundary changes.

Owned files:

- Contract: `src/shared/sandbox-evidence-pack.mjs`
- Runner: `scripts/run-sandbox-evidence-pack.mjs`
- Verifier: `scripts/verify-sandbox-evidence-pack.mjs`
- Template: `docs/release/evidence/sandbox-evidence-pack.template.json`

The runner executes deterministic verifiers for:

- File mutation
- Command execution
- MCP install
- OCR
- Browser automation
- Audio daemon

It writes a redacted report under `.tmp/sandbox-evidence-pack`. The contract
requires `boundaryChange: false`; this phase is evidence-only. Any future
sandbox boundary change must reference a passing evidence pack and add a new
migration plan.
