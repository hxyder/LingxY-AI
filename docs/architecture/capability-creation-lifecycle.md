# Capability Creation Lifecycle

Status: CAPM-002 complete as of 2026-05-12.

CAPM-002 turns user-added skills, MCP servers, and connector plugins into a
managed lifecycle instead of independent install shortcuts. The lifecycle is
service-owned, preview-first, and activation-explicit.

## Stages

| Stage | Meaning |
| --- | --- |
| `template` | Produce or select a starter descriptor without activating it. |
| `dry_run_validation` | Validate descriptor shape, paths, and policy impact without mutating live runtime state. |
| `install_preview` | Classify source, trust, local writes, code execution, and activation impact before install. |
| `user_approval` | Require a trusted desktop actor and explicit acceptance before install or activation. |
| `activation` | Enable the installed capability through its owning route. |
| `archive_recovery` | Disable, archive, rollback, or recover without losing user work. |

## Families

| Family | Owner | Preview | Install | Activation | Recovery |
| --- | --- | --- | --- | --- | --- |
| `skill` | `src/service/capabilities/skills` | `POST /skills/install/github/preview` | `POST /skills/install/github` with `previewAccepted: true` | `/config/skills/state` | `/skills/delete`, `/skills/rollback` |
| `mcp_server` | `src/service/capabilities/mcp` | `POST /config/mcp/install/preview` | `POST /config/mcp/install/run` or draft import | `PATCH /ai/mcp/:id/toggle` | draft import, server delete |
| `connector_plugin` | `src/service/capabilities/connectors/core/plugin-registry.mjs` | `POST /plugins/install/preview` | `POST /plugins/install` | `PATCH /plugins/:id/enabled` | `DELETE /plugins/:id` archive |

## Product Rules

- GitHub skill install must be previewed and accepted before cloning.
- Skill preview validates URL and branch shape, classifies trust as third
  party, and records that install writes files but does not execute code.
- Connector plugin preview must be available before install.
- Installed connector plugins start disabled. A separate enable action activates
  their connector catalog tools and workflows.
- MCP install keeps its existing plan, preview, run, disabled draft import, and
  enable toggle split.
- Renderer code may call lifecycle routes through typed clients. It must not
  import service internals.
- Untrusted installed code or declared MCP servers must not auto-run during
  install.

## Verification

Run:

```powershell
node scripts/verify-capability-creation-lifecycle.mjs
node --test tests/behavior/capability-creation-lifecycle.test.mjs
node scripts/verify-plugin-registry.mjs
npm run check:fast
```
