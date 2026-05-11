# Skill Surface Boundary

Date: 2026-05-11

This inventory locks the current skill runtime surface before CAP-4 physical
reorganization work. It is intentionally a preflight document: no product source
files are moved in this phase.

## Current Owner

Current skill runtime owner:

`src/service/ai/skills/`

Files:

| Path | Responsibility | Target layer |
|---|---|---|
| `src/service/ai/skills/builtin.mjs` | Built-in skill registry adapter for `%CODEX_HOME%/skills` | service/capabilities/skills |
| `src/service/ai/skills/discovery.mjs` | Skill root expansion, descriptor parsing, validation, directory discovery | service/capabilities/skills |
| `src/service/ai/skills/github-install.mjs` | GitHub skill staging, validation, preview, finalize, discard | service/capabilities/skills/install |
| `src/service/ai/skills/install-state.mjs` | In-memory token to staged skill install state registry | service/capabilities/skills/install |
| `src/service/ai/skills/lifecycle.mjs` | Local editable skill create/duplicate/delete/history/write/rollback/test | service/capabilities/skills/lifecycle |
| `src/service/ai/skills/registry-validation.mjs` | Skill registry descriptor validation | service/capabilities/skills/registry |
| `src/service/ai/skills/registry.mjs` | Skill registry aggregation, disabled-state filtering, status listing | service/capabilities/skills/registry |
| `src/service/ai/skills/README.md` | Runtime skill discovery notes | service/capabilities/skills |

## Active Callers

Product callers that currently depend on this surface:

| Caller | Dependency |
|---|---|
| `src/service/action_tools/tools/index.mjs` | local editable skill creation helpers |
| `src/service/capabilities/tools/skill-install-tools.mjs` | GitHub skill install stage/finalize/discard helpers |
| `src/service/ai/integrations/runtime.mjs` | registry and discovery helpers |
| `src/service/core/capability-creator/index.mjs` | skill markdown creation and descriptor validation |
| `src/service/core/http-routes/config-provider-routes.mjs` | skill registry config, lifecycle, and GitHub install endpoints |
| `src/service/core/http-routes/ai-status-routes.mjs` | `/ai/skills` status and listing route |
| `src/service/core/service-bootstrap.mjs` | install-state registry boot wiring |

Renderer and desktop code must reach skills through IPC/HTTP contracts only.
They must not import `src/service/ai/skills/**` directly.

## Stable Contracts

The preflight verifier locks these contracts:

- Skill owner files exist at the current path until the physical move phase.
- Public exports needed by existing callers remain available.
- Skill owner files do not import Electron, desktop, renderer, provider, MCP, or
  connector implementation modules.
- User-installed skill data remains outside `src/`.
- Skill install action tools continue to delegate to
  `stageSkillFromGitHub`, `finalizeStagedInstall`, and
  `discardStagedInstall`.
- Editable-skill action helpers continue to delegate to lifecycle helpers.
- `/ai/skills` remains a service HTTP contract, not a renderer-owned runtime
  shortcut.

## Target Shape

The intended CAP-4A physical move should be:

```text
src/service/capabilities/skills/
  builtin.mjs
  discovery.mjs
  github-install.mjs
  install-state.mjs
  lifecycle.mjs
  registry-validation.mjs
  registry.mjs
  README.md
```

After the physical move:

- Update every active import in product code, tests, scripts, and docs.
- Update `verify-skill-surface-contract.mjs`,
  `verify-capability-roots.mjs`, `verify-structure.mjs`, and
  `verify-stale-owner-paths.mjs`.
- Delete the old `src/service/ai/skills/` implementation path if empty.
- Do not keep compatibility barrels once all callers are migrated.

## Risk

Risk level: medium.

Reasons:

- Skill install touches local filesystem, GitHub clone staging, confirmation
  preview binding, and user-managed skill directories.
- The move is mostly import-path mechanical, but broken imports can affect
  `/ai/skills`, skill editing IPC, skill install action tools, and startup
  install-state wiring.

No IPC channel names, HTTP route names, tool ids, artifact kinds, provider ids,
or storage schema may change during the move.
