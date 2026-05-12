# Model Fallback Cascade Evidence

Status: MMX-002 contract complete as of 2026-05-12.

This file defines the framework gate for future model fallback, cascade, or
ensemble/voting work.

No runtime fallback or cascade behavior changes are introduced by this phase.
Current planner, executor, reviewer, and fast model calls keep their existing
single-route behavior unless a later phase explicitly wires a guarded policy.

## Contract

- Default state is disabled and single-model.
- Enabling fallback/cascade requires explicit opt-in.
- Enabled fallback/cascade requires a maximum attempt count and an estimated
  cost budget.
- Every fallback decision must carry trace events and `llm_usage` measurement
  keys.
- User-visible model-role surfaces must expose the fallback/cascade policy
  state before any behavior is wired.
- Ensemble/voting is separate from fallback/cascade and remains blocked unless
  an eval evidence id and passed quality gate are present.

## Owner

- Shared evidence contract:
  `src/shared/model-fallback-cascade-evidence.mjs`
- Service-visible policy surface:
  `src/service/ai/model-role-routing.mjs`
- Verification:
  `scripts/verify-model-fallback-cascade-evidence.mjs`
  `tests/behavior/model-fallback-cascade-evidence.test.mjs`

## Invariants

- Do not add automatic second-model calls without this evidence contract.
- Do not enable ensemble/voting from provider config alone.
- Do not hide fallback use from users; the selected model and reason must be
  visible in trace and usage evidence.
- Do not bypass budget limits by treating retries as ordinary planner loops.

## Verification

- `node --test tests/behavior/model-fallback-cascade-evidence.test.mjs`
- `node scripts/verify-model-fallback-cascade-evidence.mjs`
- `npm run check:fast`
