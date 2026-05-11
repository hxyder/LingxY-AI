# Capability Directory Architecture

Phase CAP-0 inventory of current capability roots and target `src/service/capabilities/**` layout.
Status: inventory verified against the current repository on 2026-05-11 after CAP-1 low-risk/helper tool-family moves.

## Current Capability Roots

| Capability type | Current path(s) | Tools / modules |
| --- | --- | --- |
| Action tools (built-in, remaining old owner) | `src/service/action_tools/tools/` | `index.mjs` (aggregator) |
| Capability-owned tools | `src/service/capabilities/tools/` | `browser-web-tools.mjs`, `document-renderer.mjs`, `email-tools.mjs`, `file-read-tools.mjs`, `memory-tools.mjs`, `mermaid-assets.mjs`, `os-app-tools.mjs`, `scheduler-tools.mjs`, `skill-install-tools.mjs`, `svg-sanitize.mjs`, `vision-analyze.mjs` |
| Action tool schemas | `src/service/action_tools/schemas/index.mjs` | All tool parameter schemas |
| Action tool registry | `src/service/action_tools/registry.mjs` | `createActionToolRegistry` |
| Action tool types | `src/service/action_tools/types.mjs` | `createActionResult` |
| Risk/policy | `src/service/action_tools/risk_matrix.mjs`, `policy-guard.mjs`, `file-reversibility.mjs` | Tool risk evaluation, policy guard, file reversibility |
| Skills | `src/service/ai/skills/` | Skill lifecycle (`lifecycle.mjs`), skill installer, skill markdown editor |
| MCP | `src/service/ai/mcp/` | MCP server config, install, drafts, test runner |
| Connectors | `src/service/connectors/` | Connector tool aggregator, connector plugins, account tools |
| Providers | `src/service/ai/providers/` | Provider catalog, config, model discovery |
| Shared capability helpers | `src/service/capabilities/tools/` | `open-with-default-handler.mjs`, `file-manifest-helpers.mjs` |
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
- Legacy paths (`src/service/action_tools/**`, `src/service/ai/skills/**`, `src/service/ai/mcp/**`, `src/service/connectors/**`) must be deleted once all active callers move, unless a phase explicitly names a temporary migration window and guards it with a verifier.
- Compatibility barrels may re-export only during a named migration window; they must not remain in a completion claim.
- Do not start broad source moves until each family has owner documentation and migration verifiers.

## Migration Sequence

1. CAP-0 ✅ — inventory current capability roots, create this doc, add verifier
2. CAP-1 — migrate low-risk/helper built-in tool families into `capabilities/tools/` one family at a time (complete for browser/web/search/translation, email compose, file discovery/stat/artifact lookup, OS app/file/clipboard/notify, scheduler, and the two shared helpers)
3. CAP-2 — move `action_tools/schemas/` to `capabilities/schemas/` (schema-only, no logic change)
4. CAP-3 — move `action_tools/registry.mjs` + `types.mjs` + `risk_matrix.mjs` + `policy-guard.mjs` to `capabilities/registry/`
5. CAP-4 — consolidate `ai/skills/`, `ai/mcp/`, `connectors/`, `ai/providers/` under `capabilities/`
6. CAP-5 — final stale-path cleanup and verifier hardening after capability families move

Each CAP-N phase is a separate PR. No phase moves code without verifier coverage.

CAP-1 completion is scoped to the seven moved low-risk/helper modules listed above. It is not a claim that every tool-related module has left `src/service/action_tools/tools/`: memory, vision, skill install, artifact/render helpers, schema, registry, policy, and type surfaces remain explicit later-phase or high-risk work.

## Verification

Run:

```powershell
node scripts/verify-capability-roots.mjs
```
