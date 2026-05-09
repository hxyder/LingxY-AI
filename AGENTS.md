# LingxY Runtime Upgrade Working Agreements

Before editing runtime code for the agent, conversation, memory, task, artifact,
Electron, or desktop execution stack, read:

- `docs/architecture/agent-runtime-spine.md`
- `docs/architecture/electron-js-runtime-performance-plan.md`
- `lingxy_codex_ready_agent_runtime_upgrade_plan.md`
- `lingxy_electron_js_codex_execution_plan.md`

Core rules:

- Do not fix runtime bugs with prompt-only patches.
- Do not special-case specific user phrases, task ids, conversation ids, or sample
  inputs as product logic.
- Do not put heavy work in Electron main process or renderer.
- Prefer additive migrations, feature flags, and reversible wiring.
- Add targeted tests or verifiers before broad behavior changes.
- Keep existing conversations, tasks, artifacts, approvals, connectors, GUI flows,
  and file workflows working unless a migration explicitly replaces them.
- Treat context, memory, task state, artifacts, tool calls, and observations as
  typed runtime data, not loose prompt text.

Verification expectations:

- Run `npm run check:fast` after JavaScript runtime changes.
- Run or update `npm run verify:desktop-gui-smoke` for Electron shell or GUI
  behavior changes.
- Add targeted behavior tests for artifact, session, memory, task, or context
  compiler changes.
- Run `node scripts/verify-runtime-upgrade-guardrails.mjs` after changing these
  architecture guardrails.

Legacy code policy:

- Do not delete or archive old code only because it looks stale.
- First prove the code is unused or superseded with references, import/call-site
  checks, tests, and runtime wiring analysis.
- Prefer a small archive or deletion PR with explicit rollback notes after the
  replacement path is verified.
- If old code is still reachable, either migrate callers to the new framework
  first or keep the compatibility path behind a named feature flag.

