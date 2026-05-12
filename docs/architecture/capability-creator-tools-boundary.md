# Capability Creator Tools Boundary

CAP-5H high-risk capability-management tool migration. Status: 2026-05-11,
moved to `src/service/capabilities/tools/capability-creator-tools.mjs` after
contract and runtime verification.

## Current State

- File: `src/service/capabilities/tools/capability-creator-tools.mjs`
- Aggregator: `src/service/action_tools/tools/index.mjs`
- Tool ids: `draft_capability`, `save_capability_draft`
- Service owners used by this boundary:
  - `src/service/core/capability-creator/index.mjs`
  - `src/service/capabilities/skills/lifecycle.mjs`
  - `src/service/capabilities/mcp/drafts.mjs`

## Public Contract

- `draft_capability` remains low risk, confirmation-free, read-only, and must
  never write files, mutate runtime config, or persist secrets.
- `save_capability_draft` remains high risk, confirmation-required, and
  `file_write` gated.
- Skill drafts must write `SKILL.md` through the skill lifecycle owner under
  `runtime.paths.skillsDir`.
- MCP drafts must write disabled JSON draft files through the MCP draft owner
  and must not mutate live runtime MCP config.
- Literal secret values must not be preserved in draft state, observations,
  metadata, saved descriptors, or runtime config.

## No-Touch Areas

- Do not change tool ids, schemas, risk levels, required capabilities,
  confirmation behavior, IPC channels, HTTP routes, provider ids, MCP config
  schema, storage schema, or desktop UI behavior in this phase.
- Do not add compatibility barrels or parallel old/new capability creator tool
  implementations.
- User-installed skills, MCP servers, tools, connectors, and drafts must remain
  in runtime data paths, not under `src/`.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Draft tool starts mutating runtime state | High | Contract verifier executes draft path without runtime services |
| Save tool enables MCP server accidentally | High | Runtime verifier checks persisted descriptor `enabled=false` |
| Literal secret leaks into draft or saved JSON | High | Runtime verifier checks serialization and saved descriptor refs |
| Skill save bypasses lifecycle path safety | High | Contract verifier locks lifecycle owner delegation |
| Old implementation remains in aggregator | Medium | Registry and capability-creator verifiers reject old owner text in `index.mjs` |

## Decision

Moved from inline ownership in `src/service/action_tools/tools/index.mjs` to
`src/service/capabilities/tools/capability-creator-tools.mjs`. The aggregator
keeps named re-exports for current import compatibility, but all implementation
owner text now lives in the capability module.
