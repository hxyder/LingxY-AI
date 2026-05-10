# Capability Directory Architecture

Phase CAP-0 inventory of current capability roots and target `src/service/capabilities/**` layout.
Status: inventory verified against the current repository on 2026-05-10.

## Current Capability Roots

| Capability type | Current path(s) | Tools / modules |
| --- | --- | --- |
| Action tools (built-in) | `src/service/action_tools/tools/` | `index.mjs` (aggregator), `browser-web-tools.mjs`, `os-app-tools.mjs`, `scheduler-tools.mjs`, `file-read-tools.mjs`, `email-tools.mjs`, `memory-tools.mjs`, `vision-analyze.mjs`, `skill-install-tools.mjs` |
| Action tool schemas | `src/service/action_tools/schemas/index.mjs` | All tool parameter schemas |
| Action tool registry | `src/service/action_tools/registry.mjs` | `createActionToolRegistry` |
| Action tool types | `src/service/action_tools/types.mjs` | `createActionResult` |
| Risk/policy | `src/service/action_tools/risk_matrix.mjs`, `policy-guard.mjs`, `file-reversibility.mjs` | Tool risk evaluation, policy guard, file reversibility |
| Skills | `src/service/ai/skills/` | Skill lifecycle (`lifecycle.mjs`), skill installer, skill markdown editor |
| MCP | `src/service/ai/mcp/` | MCP server config, install, drafts, test runner |
| Connectors | `src/service/connectors/` | Connector tool aggregator, connector plugins, account tools |
| Providers | `src/service/ai/providers/` | Provider catalog, config, model discovery |
| Shared helpers | `src/service/action_tools/tools/` | `open-with-default-handler.mjs`, `file-manifest-helpers.mjs` |
| Service core helpers | `src/service/core/` | `artifact-path-helper.mjs` (artifact boundary) |

## Target Architecture

Long-term, capabilities should live under a clean `src/service/capabilities/**` layout:

```text
src/service/capabilities/
  tools/           # built-in action tools (per-family modules)
  schemas/         # tool parameter schemas
  registry/        # tool registry + risk/policy
  skills/          # skill lifecycle, install, markdown
  mcp/             # MCP server config, install, drafts
  connectors/      # connector plugins, accounts
  providers/       # provider catalog, config, discovery
  shared/          # cross-capability shared helpers
```

## Migration Rules

- Built-in source capabilities belong in `src/service/capabilities/**`.
- User-installed skills/MCP/tools/connectors must live under runtime data paths, NOT under `src/`.
- Legacy paths (`src/service/action_tools/**`, `src/service/ai/skills/**`, `src/service/ai/mcp/**`, `src/service/connectors/**`) may become compatibility barrels during migration, but must not contain parallel implementations after the new owner is verified.
- Compatibility barrels may re-export only; they must not keep logic.
- Do not start broad source moves until each family has owner documentation and migration verifiers.

## Migration Sequence

1. CAP-0 ✅ — inventory current capability roots, create this doc, add verifier
2. CAP-1 — extract remaining `action_tools/tools/index.mjs` high-risk tools to per-family modules (deferred until artifact-boundary invariants locked)
3. CAP-2 — move `action_tools/schemas/` to `capabilities/schemas/` (schema-only, no logic change)
4. CAP-3 — move `action_tools/registry.mjs` + `types.mjs` + `risk_matrix.mjs` + `policy-guard.mjs` to `capabilities/registry/`
5. CAP-4 — consolidate `ai/skills/`, `ai/mcp/`, `connectors/`, `ai/providers/` under `capabilities/`
6. CAP-5 — add compatibility barrels at legacy paths, update all imports

Each CAP-N phase is a separate PR. No phase moves code without verifier coverage.

## Verification

Run:

```powershell
node scripts/verify-capability-roots.mjs
```
