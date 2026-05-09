# LingxY Runtime Upgrade Working Agreements

Before editing runtime code for the agent, conversation, memory, task, artifact,
Electron, or desktop execution stack, read:

- `docs/architecture/agent-runtime-spine.md`
- `docs/architecture/electron-js-runtime-performance-plan.md`
- `docs/architecture/post-runtime-upgrade-roadmap.md`
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

Mandatory upgrade PR intake protocol:

Before upgrading runtime, memory, conversation, artifact, Electron, desktop, or
execution-stack code, the implementer must identify and obey these gates. This
protocol governs code upgrade work only; it is not a rule that LingxY's runtime
must apply to every user task it executes.

1. Module boundaries: name the owning layer or module, the caller boundary, and
   which adjacent modules must remain untouched.
2. Architecture rules file: read and follow this file plus the canonical
   architecture files listed above.
3. Task scope: state the current PR/task step, explicit in-scope work, and
   explicit out-of-scope work.
4. Forbidden modification areas: list no-touch files, generated outputs,
   unrelated feature areas, or legacy paths that may not be changed in this PR.
5. Interface contracts: identify public APIs, schemas, IPC routes, HTTP routes,
   task events, storage records, or verifier contracts affected by the change.
6. Test gate: add or update targeted tests/verifiers before broad wiring and run
   the relevant verification commands before completion.
7. Design-before-generation: inspect the existing design and record the intended
   migration shape before generating or editing broad code.
8. Patch check: explicitly check whether the change is only a local patch; if it
   is not enforcing a framework invariant, redesign it before implementation.
9. Replacement discipline: when a new framework path is verified and wired,
   migrate callers to it and retire old reachable code in the same PR or in a
   named follow-up cleanup PR with a blocking verifier. Do not leave parallel
   old/new implementations reachable without an explicit feature flag.
10. Legacy removal discipline: once replacement is proven, delete the old code
    or move it to an explicit archive area, then check imports, route
    registrations, package scripts, public exports, duplicate entry points, and
    variable/name collisions so the old path cannot be referenced accidentally.

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
- When the new framework path exists and passes its verifier, replace old call
  sites and remove the old implementation surface instead of keeping both paths.
- After replacement, delete obsolete code or move it to a clear archive area and
  verify there are no stale imports, duplicated public APIs, duplicate package
  scripts, repeated route registrations, or variable/name collisions.
- If removal cannot be completed safely in the same PR, create a named cleanup
  PR step and add a verifier that prevents new old-path references.
- If old code is still reachable during migration, either migrate callers to the
  new framework first or keep the compatibility path behind a named feature flag.
