# Skill Surface Boundary

Date: 2026-05-11

This inventory locks the CAP-4A skill runtime surface after the physical move
into `src/service/capabilities/skills/`.

## Current Owner

Current skill runtime owner:

`src/service/capabilities/skills/`

Files:

| Path | Responsibility | Target layer |
|---|---|---|
| `src/service/capabilities/skills/builtin.mjs` | Built-in skill registry adapter for `%CODEX_HOME%/skills` | service/capabilities/skills |
| `src/service/capabilities/skills/discovery.mjs` | Skill root expansion, descriptor parsing, validation, directory discovery | service/capabilities/skills |
| `src/service/capabilities/skills/github-install.mjs` | GitHub skill staging, validation, preview, finalize, discard | service/capabilities/skills/install |
| `src/service/capabilities/skills/install-state.mjs` | In-memory token to staged skill install state registry | service/capabilities/skills/install |
| `src/service/capabilities/skills/lifecycle.mjs` | Local editable skill create/duplicate/delete/history/write/rollback/test | service/capabilities/skills/lifecycle |
| `src/service/capabilities/skills/registry-validation.mjs` | Skill registry descriptor validation | service/capabilities/skills/registry |
| `src/service/capabilities/skills/registry.mjs` | Skill registry aggregation, disabled-state filtering, status listing | service/capabilities/skills/registry |
| `src/service/capabilities/skills/README.md` | Runtime skill discovery notes | service/capabilities/skills |

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
They must not import skill runtime internals directly.

## Stable Contracts

The verifier locks these contracts:

- Skill owner files exist at the capabilities path.
- The former service AI skill owner directory is absent.
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

## Current Shape

The CAP-4A physical move produced:

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

Completion rules:

- Every active import in product code, tests, scripts, and docs must point at
  `src/service/capabilities/skills/`.
- `verify-skill-surface-contract.mjs`, `verify-capability-roots.mjs`,
  `verify-structure.mjs`, and `verify-stale-owner-paths.mjs` must all agree on
  the owner.
- Compatibility barrels are not allowed after CAP-4A completion.

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
