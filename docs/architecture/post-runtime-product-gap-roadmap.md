# Post Runtime Product Gap Roadmap

This board starts after `docs/architecture/post-runtime-upgrade-roadmap.md`
and `docs/architecture/post-runtime-maturity-roadmap.md` completed their
tracked runtime, ownership, desktop-boundary, marketplace-trust, sandbox
decision, and observability phases.

The purpose is to close remaining product gaps against strong desktop agent
workbenches and open-source harnesses without reopening completed runtime
spine work. Historical root files such as `FRAMEWORK_GAP_ANALYSIS.md` and
`FUNCTION_AUDIT_AND_UPGRADE_PLAN.md` are background evidence only. The
authority for execution is the current program, this board, verifiers, behavior
tests, GUI smoke, and real-environment evidence when the touched feature needs
credentials, hardware, Office, browser, packaging, or live provider behavior.

## Current Gate

- Current green gate: `npm run check:fast` passed 135/135 with 1092/1092
  behavior tests after the final live-provider acceptance fix.
- `npm run verify:desktop-gui-smoke` passed 49/49 after the final
  live-provider acceptance fix. The earlier
  MMX-001 smoke attempt hit the known task-list keyboard focus timing failure
  and the immediate rerun passed.
- `node scripts/real-llm-test/run-live-provider-acceptance.mjs --live --port
  4350` passed with provider setup, short task, model-role routing, and
  token/cache trace scenarios green.
- The next work must improve product capability, manageability, or real
  acceptance evidence; it must not repackage already-complete runtime phases as
  new work.

## Execution Standards

- Keep runtime contracts stable unless a phase explicitly owns a migration:
  IPC channels, HTTP routes, tool ids, artifact kinds, provider ids, storage
  schema, approval semantics, and marketplace trust states.
- Use framework invariants, typed contracts, and verifiers instead of local
  patches or prompt-only behavior fixes.
- Run real API, OAuth, hardware, Office, browser, packaged-build, or Electron
  GUI tests only when the changed surface depends on those realities.
- For deterministic service or governance changes, use focused behavior tests,
  verifiers, and `npm run check:fast`.
- Any new plugin, MCP, skill, provider, model role, sandbox, or desktop workflow
  surface must have an owner, a rollback/recovery story, and acceptance evidence.
- After the roadmap is functionally complete, run a real API/common-agent
  acceptance pass across provider calls, tool use, artifact creation, context,
  connector read/write guards, memory, fallback, and recovery. Problems found
  there must be fixed in framework contracts, tests, or verifiers rather than
  prompt-only or one-scenario patches.
- Live provider acceptance evidence shows token/cache usage, not estimated
  pricing. Price display stays off unless a future phase adds provider-owned
  cache-hit/cache-miss billing evidence and an explicit freshness policy.

## Source Map

| Area | Current program evidence | Remaining product gap |
| --- | --- | --- |
| Desktop daily workflows | `docs/release/desktop_product_acceptance_matrix.md`, GUI smoke, desktop renderer/main verifiers | Turn release acceptance rows into repeatable evidence packs with clear pass/partial/fail records and broader real desktop scenarios. |
| Conversation/task/artifact UX | Conversation branch/search/follow-up verifiers, task trace timeline, preview screenshot-diff | Exercise complete daily flows end-to-end: attach, follow up, generate/edit/open artifacts, inspect trace, recover from failure. |
| Provider and model setup | Provider routing/health/onboarding verifiers, role routing, reviewer loop | Add opt-in live provider acceptance that records model role, token, cost, fallback, and recovery behavior without leaking secrets. |
| Connectors and OAuth | Connector catalog/workflow dispatch verifiers, Google/Microsoft contracts | Add disposable-account real acceptance for OAuth, list, guarded side effect, token refresh, and recovery copy. |
| Skills, MCP, plugins, capabilities | Capability roots, marketplace trust model, MCP governance, plugin lifecycle | Make user-added skills/MCP/plugins manageable as separate inventory groups with templates, archive/recover, trust, and policy state surfaced consistently. |
| Long-term sandboxing | Privacy policy, security broker, OS sandbox implementation decision, sidecar decision record | Add measured sandbox candidate evidence before changing boundaries; keep high-risk execution lanes recoverable and auditable. |
| Multi-model collaboration | Model role routing, reviewer loop, LLM usage emission, eval trend store | Add model-role management and opt-in fallback/cascade evidence before ensemble/voting work. |
| Context and project memory | Context compiler, memory review history/undo/scope filters, conversation context visibility | Improve user-visible context selection, project context packs, and “why this context was used” evidence. |
| Release management | Functional acceptance, desktop product acceptance, known issues, release readiness | Make release decisions reproducible with real evidence bundles instead of ad hoc notes. |

## Tracking Register

| Phase | Status | Tracking rule |
| --- | --- | --- |
| PG-001 Product gap roadmap and verifier | complete | This board is linked from architecture docs and guarded by `verify-post-runtime-product-gap-roadmap.mjs`. |
| DXR-001 Desktop evidence pack runner | complete | Release acceptance rows must produce reusable evidence records with commit, gate, real environment, pass/partial/fail, and known-issue links. |
| DXR-002 Daily conversation/task/artifact GUI matrix | complete | Real Electron smoke must cover attach, follow-up, generate/edit/open, timeline inspection, cancellation/retry, and recovery paths before declaring desktop workflows complete. |
| LAPI-001 Live provider acceptance harness | complete | Opt-in real API tests must verify provider setup, model role routing, token/cache trace, fallback, and user-visible recovery without storing secrets. |
| CONN-001 Real connector/OAuth acceptance | complete | Disposable-account tests must cover OAuth, list, refresh, guarded send/calendar action, and recovery copy for each connector family. |
| CAPM-001 Capability inventory manager | complete | Skills, MCP servers, plugins, connectors, providers/model roles, user-created drafts, and built-in tools are browsable as separate typed inventories with ownership, trust, policy, and archive state. |
| CAPM-002 Capability creation lifecycle | complete | User-created skills/MCP/plugins have templates, dry-run validation, install preview, rollback/archive, and policy gates before activation. |
| SBOX-001 High-risk sandbox evidence pack | complete | File mutation, command execution, MCP install, OCR, browser automation, and audio daemon surfaces must collect measured evidence before any sandbox boundary change. |
| MMX-001 Model role management surface | complete | Users can see planner/executor/reviewer/fast roles, health, cost, fallback, feature-flag state, and live-test action metadata without editing config files. |
| MMX-002 Budgeted fallback and cascade evidence | complete | Any future model fallback/cascade must be opt-in, traceable, budget-bounded, and eval-measured before ensemble/voting loops. |
| CTX-001 Context selection and project packs | complete | Users can see selected/omitted context, project memory scope, attachments, and conversation provenance in one coherent context surface. |
| REL-001 Release evidence bundle | complete | Release readiness bundles check results, GUI smoke, row evidence, known issues, policy traces, and environment notes. |

## Phase Details

### PG-001: Product Gap Roadmap And Verifier

Status: complete as of 2026-05-12.

Scope:

- Create this tracked board for post-runtime product gaps.
- Link it from architecture docs and status handoff.
- Add a verifier that checks the required phase ids, evidence rules, and
  references to real-environment testing.
- Do not change product runtime behavior.

Acceptance:

- Future sessions can identify the next product roadmap without reading root
  historical analysis files.
- The board includes desktop experience, live provider/API, connectors,
  capability management, sandbox evidence, multi-model management, context, and
  release evidence work.
- The verifier is included in full and fast check manifests.

Verification:

- `node scripts/verify-post-runtime-product-gap-roadmap.mjs`
- `node scripts/verify-check-runner.mjs`
- `npm run check:fast`

### DXR-001: Desktop Evidence Pack Runner

Status: complete as of 2026-05-12.

Goal:

- Turn `docs/release/desktop_product_acceptance_matrix.md` into a repeatable
  evidence workflow with a machine-checkable local evidence file format.

Implemented:

- `src/shared/desktop-product-evidence-pack.mjs`
- `docs/release/desktop_product_evidence_pack.md`
- `docs/release/evidence/desktop-product-evidence.template.json`
- `scripts/verify-desktop-product-evidence-pack.mjs`
- `tests/behavior/desktop-product-evidence-pack.test.mjs`

Required shape:

- Commit under test.
- `check:fast` or full check result.
- Electron GUI smoke result.
- Acceptance rows exercised with pass/partial/fail.
- Real environment used for provider, connector, browser, Office, packaging, or
  hardware rows.
- Known-issue link or release-blocking decision for every partial/fail row.

Verification:

- `node scripts/verify-desktop-product-evidence-pack.mjs`
- `node --test tests/behavior/desktop-product-evidence-pack.test.mjs`
- Run `npm run verify:desktop-gui-smoke` only when a phase touches Electron
  smoke or renderer automation.

### DXR-002: Daily Conversation/Task/Artifact GUI Matrix

Status: complete as of 2026-05-12.

Goal:

- Expand real Electron GUI smoke beyond foundational checks into the daily
  workflow path users care about.

Implemented:

- `src/shared/desktop-gui-smoke-workflow-coverage.mjs`
- `docs/architecture/desktop-gui-daily-workflow-coverage.md`
- `scripts/verify-desktop-gui-daily-workflow-coverage.mjs`
- `tests/behavior/desktop-gui-smoke-workflow-coverage.test.mjs`
- Existing real Electron smoke checks are now grouped and verifier-locked for
  conversation continuity, task operations, and artifact workflow coverage.

Required scenarios:

- New conversation, attachment, follow-up with previous context.
- Task cancellation, retry, timeline inspection, and restore/recovery view.
- Generate, edit, open, and reveal artifact families through the same desktop
  surfaces users see.
- Memory/marketplace governance visibility in the Console.

Verification:

- `node scripts/verify-desktop-gui-daily-workflow-coverage.mjs`
- `node --test tests/behavior/desktop-gui-smoke-workflow-coverage.test.mjs`
- `npm run verify:desktop-gui-smoke`
- Row-specific verifiers from `docs/release/desktop_product_acceptance_matrix.md`
- `npm run check:fast`

### LAPI-001: Live Provider Acceptance Harness

Status: complete as of 2026-05-12.

Goal:

- Provide opt-in live provider tests for configured local credentials without
  making CI depend on paid APIs.

Implemented:

- `src/shared/live-provider-acceptance-harness.mjs`
- `scripts/real-llm-test/run-live-provider-acceptance.mjs`
- `docs/architecture/live-provider-acceptance-harness.md`
- `docs/release/evidence/live-provider-acceptance.template.json`
- `scripts/verify-live-provider-acceptance-harness.mjs`
- `tests/behavior/live-provider-acceptance-harness.test.mjs`

Required scenarios:

- Provider setup and health.
- One short text task.
- Role-aware planner/executor/reviewer routing when enabled.
- Token and cache hit/miss trace visibility.
- Recovery copy for missing key, rate limit, invalid model, and provider
  failure classes where practical.

Verification:

- `node scripts/verify-live-provider-acceptance-harness.mjs`
- `node --test tests/behavior/live-provider-acceptance-harness.test.mjs`
- Dry-run evidence command:
  `node scripts/real-llm-test/run-live-provider-acceptance.mjs`
- Opt-in real API command only when credentials are present:
  `LINGXY_LIVE_PROVIDER_ACCEPTANCE=1 node scripts/real-llm-test/run-live-provider-acceptance.mjs --live`
- Redacted report with no prompt secrets or API keys.

### CONN-001: Real Connector/OAuth Acceptance

Status: complete as of 2026-05-12.

Goal:

- Make connector readiness proveable with disposable Google/Microsoft accounts
  or equivalent test tenants.

Implemented:

- `src/shared/connector-oauth-acceptance-harness.mjs`
- `scripts/real-connector-test/run-connector-oauth-acceptance.mjs`
- `docs/architecture/connector-oauth-acceptance-harness.md`
- `docs/release/evidence/connector-oauth-acceptance.template.json`
- `scripts/verify-connector-oauth-acceptance-harness.mjs`
- `tests/behavior/connector-oauth-acceptance-harness.test.mjs`

Required scenarios:

- OAuth connect/disconnect.
- Token refresh.
- List mail/files/events.
- Guarded side effects: send draft/test email or create/delete test calendar
  event only with explicit approval.
- User-visible recovery for auth and permission failures.

Verification:

- `node scripts/verify-connector-oauth-acceptance-harness.mjs`
- `node --test tests/behavior/connector-oauth-acceptance-harness.test.mjs`
- Dry-run evidence command:
  `node scripts/real-connector-test/run-connector-oauth-acceptance.mjs`
- Real connector tests are opt-in:
  `LINGXY_CONNECTOR_OAUTH_ACCEPTANCE=1 node scripts/real-connector-test/run-connector-oauth-acceptance.mjs --live`
- Reports redact tokens, OAuth codes, auth headers, message bodies, file
  contents, and personal data.

### CAPM-001: Capability Inventory Manager

Status: complete as of 2026-05-12.

Goal:

- Make capabilities manageable the way mature harnesses manage extensions:
  users can see what exists, who owns it, whether it is trusted, and whether it
  can run.

Implemented:

- `src/service/capabilities/inventory/capability-inventory.mjs`
- `GET /capabilities/inventory`
- Console marketplace management reads the service-owned inventory first.
- `docs/architecture/capability-inventory-manager.md`
- `scripts/verify-capability-inventory-manager.mjs`
- `tests/behavior/capability-inventory-manager.test.mjs`

Required groups:

- Built-in tools.
- Skills.
- MCP servers.
- Connector plugins.
- Providers/model roles.
- User-created drafts.

Acceptance:

- Each group has a typed inventory owner, trust/policy state, enabled/disabled
  state, archive/recovery state where applicable, and no renderer imports of
  service internals.

Verification:

- `node scripts/verify-capability-inventory-manager.mjs`
- `node --test tests/behavior/capability-inventory-manager.test.mjs`
- Extend existing marketplace/capability verifiers before adding UI behavior.
- Run Electron GUI smoke for visible Console changes.

### CAPM-002: Capability Creation Lifecycle

Status: complete as of 2026-05-12.

Goal:

- Let users add new skills, MCP servers, and plugins safely without turning the
  filesystem into an unmanaged extension pile.

Implemented:

- `src/service/capabilities/lifecycle/capability-creation-lifecycle.mjs`
- `GET /capabilities/lifecycle`
- `POST /skills/install/github/preview`
- `POST /plugins/install/preview`
- GitHub skill install now requires `previewAccepted: true`.
- Installed connector plugins start disabled until `PATCH /plugins/:id/enabled`.
- `docs/architecture/capability-creation-lifecycle.md`
- `scripts/verify-capability-creation-lifecycle.mjs`
- `tests/behavior/capability-creation-lifecycle.test.mjs`

Required stages:

- Template or draft.
- Validation/dry-run.
- Install preview with source classification and policy impact.
- User approval.
- Activation.
- Archive/recover.

Verification:

- `node scripts/verify-capability-creation-lifecycle.mjs`
- `node --test tests/behavior/capability-creation-lifecycle.test.mjs`
- Existing skill/MCP/plugin install verifiers plus new lifecycle tests.
- No auto-run of untrusted installed code.

### SBOX-001: High-Risk Sandbox Evidence Pack

Status: complete as of 2026-05-12.

Goal:

- Decide future sandboxing from measurements, not vibes.

Implemented:

- `src/shared/sandbox-evidence-pack.mjs`
- `scripts/run-sandbox-evidence-pack.mjs`
- `docs/architecture/sandbox-evidence-pack.md`
- `docs/release/evidence/sandbox-evidence-pack.template.json`
- `scripts/verify-sandbox-evidence-pack.mjs`
- `tests/behavior/sandbox-evidence-pack.test.mjs`

Required surfaces:

- File mutation and recovery checkpoints.
- External command execution.
- MCP package install sandbox.
- OCR extractors.
- Browser automation.
- Audio daemon helpers.

Acceptance:

- Each surface records current boundary, measured risk/performance data,
  rollback, user recovery, and whether worker/child-process remains sufficient.
- No new OS sandbox, native helper, or sidecar without updating SH-004 decision
  records and passing targeted tests.

Verification:

- `node scripts/verify-sandbox-evidence-pack.mjs`
- `node --test tests/behavior/sandbox-evidence-pack.test.mjs`
- `node scripts/run-sandbox-evidence-pack.mjs`
- Evidence pack records command, measured result, and mitigation for each
  surface.
- No sandbox boundary change is allowed in this phase.

### MMX-001: Model Role Management Surface

Status: complete as of 2026-05-12.

Goal:

- Make multi-model support understandable and testable from the desktop app.

Implemented:

- `src/service/ai/model-role-routing.mjs` now treats
  planner/executor/reviewer/fast as first-class roles.
- The `/config/integrations` `modelRoles` payload now includes
  `featureFlag`, `managementSurface`, per-role health, fallback, cost/usage
  evidence, and safe live-test action metadata.
- Console Settings > Routing renders a service-backed model-role management
  surface before the existing task-routing form.
- The live provider acceptance harness records the model-role management
  surface shape in its redacted evidence output.

Boundaries:

- Existing provider ids, task-routing schema, HTTP routes, IPC channels, and
  storage schema remain unchanged.
- The fast role maps to the current fast executor's `chat` provider route; no
  new runtime execution lane was introduced.
- Role call-site routing is still opt-in through the existing
  `ai.modelRoles.enabled` or `ai.modelRoleRouting.enabled` flags.

Verification:

- `node --test tests/behavior/model-role-routing.test.mjs`
- `node scripts/verify-model-role-routing.mjs`
- `node --test tests/behavior/live-provider-acceptance-harness.test.mjs`
- `node scripts/verify-live-provider-acceptance-harness.mjs`
- `npm run check:fast`
- `npm run verify:desktop-gui-smoke`
- `node scripts/real-llm-test/run-live-provider-acceptance.mjs` in dry-run
  mode
- Real API test only when credentials are present and the user explicitly runs
  the live harness.

### MMX-002: Budgeted Fallback And Cascade Evidence

Status: complete as of 2026-05-12.

Goal:

- Add fallback/cascade only after role management and trace evidence are stable.

Implemented:

- Added `src/shared/model-fallback-cascade-evidence.mjs` as the shared
  evidence contract.
- Added `docs/architecture/model-fallback-cascade-evidence.md`.
- Model-role management now exposes the current fallback/cascade policy state.
- Enabled fallback/cascade requires explicit opt-in, max attempts, cost budget,
  trace events, and usage measurement keys.
- Ensemble/voting remains blocked unless eval evidence id and passed quality
  gate are present.

Boundaries:

- No runtime fallback or cascade behavior changed in this phase.
- No additional model calls, provider ids, HTTP routes, IPC channels, storage
  schema, or approval semantics were introduced.

Verification:

- `node --test tests/behavior/model-fallback-cascade-evidence.test.mjs`
- `node scripts/verify-model-fallback-cascade-evidence.mjs`
- `npm run check:fast`

### CTX-001: Context Selection And Project Packs

Status: complete as of 2026-05-12.

Goal:

- Make context visible and controllable instead of implicit.

Implemented:

- Added `src/shared/context-selection-project-pack.mjs` as the shared
  context/project pack view-model.
- Added `docs/architecture/context-selection-project-pack.md`.
- Console task detail context panel now shows selected/omitted rows, project
  pack membership, project memory scope, attachments, parent/conversation
  provenance, and branch source when present.
- The renderer consumes the shared view-model instead of rebuilding pack logic
  from loose task fields.

Verification:

- Context compiler and visibility tests.
- `node --test tests/behavior/context-selection-project-pack.test.mjs`
- `node --test tests/behavior/context-debug-panel.test.mjs`
- `node scripts/verify-context-selection-project-pack.mjs`
- `npm run check:fast`
- GUI smoke for visible context panel changes.

### REL-001: Release Evidence Bundle

Status: complete as of 2026-05-12.

Goal:

- Replace scattered release notes with a reproducible local evidence bundle.

Implemented:

- Added `src/shared/release-evidence-bundle.mjs`.
- Added `docs/release/release_evidence_bundle.md`.
- Added `docs/release/evidence/release-evidence-bundle.template.json`.
- Added `scripts/verify-release-evidence-bundle.mjs` and
  `tests/behavior/release-evidence-bundle.test.mjs`.
- The bundle validates commit/branch, check results, GUI smoke, release
  readiness, desktop product evidence rows, real evidence refs, policy traces,
  known issues, environment notes, and release decision.
- Live evidence refs require redaction notes.
- Partial or failed release decisions require known issues.

Verification:

- `node --test tests/behavior/release-evidence-bundle.test.mjs`
- `node scripts/verify-release-evidence-bundle.mjs`
- `npm run check:fast`

## Recommended PR Order

1. PG-001: product gap roadmap and verifier.
2. DXR-001: desktop evidence pack runner.
3. DXR-002: daily conversation/task/artifact GUI matrix.
4. CAPM-001: capability inventory manager.
5. CAPM-002: capability creation lifecycle.
6. LAPI-001: live provider acceptance harness.
7. CONN-001: real connector/OAuth acceptance.
8. MMX-001: model role management surface.
9. MMX-002: budgeted fallback/cascade evidence.
10. CTX-001: context selection and project packs.
11. SBOX-001: high-risk sandbox evidence pack.
12. REL-001: release evidence bundle.

This order first makes the product evidence loop reliable, then improves
capability management, then adds live-provider/connector/multi-model confidence,
and only then considers stronger sandbox or release-bundle gates.
