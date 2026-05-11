# Action Tool Registry Boundary

CAP-3 registry/type/risk/policy ownership preflight. Status: 2026-05-11,
preflight only.

## Current State

- Current registry owner: `src/service/action_tools/registry.mjs`
- Current result/type owner: `src/service/action_tools/types.mjs`
- Current risk owner: `src/service/action_tools/risk_matrix.mjs`
- Current policy owner: `src/service/action_tools/policy-guard.mjs`
- Current file reversibility owner: `src/service/action_tools/file-reversibility.mjs`
- Target owner for CAP-3: `src/service/capabilities/registry/`

## Public Contract

- `createActionToolRegistry` must keep the same register/get/list/evaluate/call
  behavior.
- Built-in action tool id order must remain 61 tools.
- Confirmation-gated tool ids must remain unchanged.
- `createActionResult` must keep the result shape:
  `success`, `observation`, `artifact_paths`, `error`, `metadata`.
- `ACTION_TOOL_RISK_LEVELS` must remain `low`, `medium`, `high`.
- `evaluateToolRisk` must preserve current risk/confirmation decisions.
- `applyPolicyGuard`, `resetRateLimits`, `getRateLimitUsage`, and
  `DEFAULT_RATE_LIMITS` must preserve policy-block and rate-limit behavior.
- File reversibility exports must remain stable while registry/policy ownership
  moves around them.

## No-Touch Areas

- Do not change tool ids, tool order, risk levels, confirmation gates, schema
  keys, artifact kinds, IPC channels, HTTP routes, provider ids, storage schema,
  or action result shape.
- Do not move remaining inline tool implementations from
  `src/service/action_tools/tools/index.mjs` as part of CAP-3 registry
  preflight.
- Do not introduce Electron main, preload, renderer, desktop, provider, network,
  or heavy filesystem work into registry/type/risk/policy modules.
- Do not add compatibility barrels as a completion state. A future CAP-3
  physical move must update callers and remove old reachable owner files in the
  same migration checkpoint.

## Migration Shape

CAP-3 must happen in two commits:

1. Preflight: add this boundary and `scripts/verify-action-tool-registry-contract.mjs`.
2. Physical move: move registry/type/risk/policy owners to
   `src/service/capabilities/registry/`, update active imports, update
   inventories/verifiers, and prove old owner files are absent.

`file-reversibility.mjs` is locked by this preflight because it is part of the
tool execution safety surface, but it should only be physically moved in a
separate file/artifact safety phase unless CAP-3 explicitly expands its scope
with updated verifier coverage.

## Verification

- `scripts/verify-action-tool-registry-contract.mjs` locks the current owner
  paths, future target, public APIs, built-in registry snapshot, confirmation
  gates, policy/risk behavior, file reversibility export stability, boundary
  documentation, and desktop/runtime dependency exclusions.
