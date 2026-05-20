# Action Tool Schemas Boundary

CAP-2 schema-owner migration. Status: 2026-05-11, moved to
`src/service/capabilities/schemas/index.mjs` after static preflight
verification.

## Current State

- Current owner: `src/service/capabilities/schemas/index.mjs`
- Public API: `ACTION_TOOL_SCHEMAS`
- Current schema count: 62
- Runtime consumers:
  - `src/service/action_tools/tools/index.mjs`
  - `src/service/capabilities/tools/*.mjs`
  - action-tool and capability behavior tests
  - specialty verifiers that inspect file-content and capability schemas

## Contract

- This surface is schema-only. It must not import tools, registry, policy,
  providers, Electron, desktop, renderer, filesystem, or network code.
- Tool ids and schema keys must remain stable and aligned with
  `BUILTIN_ACTION_TOOLS`.
- CAP-2 must not change descriptions, risk levels, confirmation gates,
  artifact kinds, provider ids, IPC channels, HTTP routes, storage schema, or
  action result shape.
- CAP-2 moved the owner from `action_tools/schemas/` to
  `capabilities/schemas/` and updated imports/verifiers/docs.

## No-Touch Areas

- Do not move `registry.mjs`, `types.mjs`, `risk_matrix.mjs`,
  `policy-guard.mjs`, or `file-reversibility.mjs` in CAP-2.
- Do not physically extract any remaining inline tools from
  `src/service/action_tools/tools/index.mjs` in CAP-2.
- Do not add compatibility barrels or duplicate schema implementations.
- Do not alter tool schema content as part of this migration.

## Verification

- `scripts/verify-action-tool-schemas-contract.mjs` locks the moved owner,
  old-path removal, public export, 62-key schema surface, key alignment with
  built-in tool ids, schema-only import-free shape, and this boundary document.

## Decision

moved from `src/service/action_tools/schemas/index.mjs` to
`src/service/capabilities/schemas/index.mjs`. The old owner path must not
return as a compatibility barrel or duplicate schema implementation.
