# Action Tool Registry Boundary

CAP-3 registry/type/risk/policy ownership migration. Status: 2026-05-11,
moved to `src/service/capabilities/registry/` after static preflight
verification.

## Current State

- Current registry owner: `src/service/capabilities/registry/registry.mjs`
  (moved from `src/service/action_tools/registry.mjs`)
- Current result/type owner: `src/service/capabilities/registry/types.mjs`
  (moved from `src/service/action_tools/types.mjs`)
- Current risk owner: `src/service/capabilities/registry/risk_matrix.mjs`
  (moved from `src/service/action_tools/risk_matrix.mjs`)
- Current policy owner: `src/service/capabilities/registry/policy-guard.mjs`
  (moved from `src/service/action_tools/policy-guard.mjs`)
- Current file reversibility owner: `src/service/capabilities/tools/file-reversibility.mjs`

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

CAP-3 happened in two commits:

1. Preflight: add this boundary and `scripts/verify-action-tool-registry-contract.mjs`.
2. Physical move: move registry/type/risk/policy owners to
   `src/service/capabilities/registry/`, update active imports, update
   inventories/verifiers, and prove old owner files are absent.

`file-reversibility.mjs` is locked by this boundary because it is part of the
tool execution safety surface. It was physically moved in CAP-5A after its
dedicated verifier and behavior tests covered checkpoint creation, sidecar
collection, task-route restore, and renderer recovery controls.

## Verification

- `scripts/verify-action-tool-registry-contract.mjs` locks the moved owner
  paths, old-path removal, public APIs, built-in registry snapshot,
  confirmation gates, policy/risk behavior, file reversibility export
  stability, boundary documentation, and desktop/runtime dependency exclusions.
