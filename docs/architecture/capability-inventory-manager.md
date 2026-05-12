# Capability Inventory Manager

Status: CAPM-001 complete as of 2026-05-12.

This inventory is the service-owned capability ledger for user-visible
extension and runtime capability management. It does not replace the existing
tool registry, provider health routes, MCP management, skill lifecycle, or
plugin lifecycle. It aggregates those owners into one typed surface so the
Console can browse capability state without importing service internals.

## Owner

| Surface | Owner |
| --- | --- |
| Inventory builder | `src/service/capabilities/inventory/capability-inventory.mjs` |
| HTTP route | `src/service/core/http-routes/ai-status-routes.mjs` |
| Console consumer | `src/desktop/renderer/console.js` |
| Contract verifier | `scripts/verify-capability-inventory-manager.mjs` |
| Behavior tests | `tests/behavior/capability-inventory-manager.test.mjs` |

## Inventory Groups

| Group id | Current responsibility | Source owner |
| --- | --- | --- |
| `built_in_tools` | Built-in action tools, risk, required capabilities, approval requirement. | `src/service/action_tools/tools/index.mjs` |
| `skills` | Installed or editable skills and skill registry state. | `src/service/capabilities/skills` |
| `mcp_servers` | Built-in, configured, or external MCP server status and management routes. | `src/service/capabilities/mcp` |
| `connector_plugins` | Built-in and installed connector plugins, enabled state, trust, archive routes. | `src/service/capabilities/connectors/core/plugin-registry.mjs` |
| `connector_tools` | Provider-neutral connector catalog tools and guarded side-effect metadata. | `src/service/capabilities/connectors/tools` |
| `providers_model_roles` | AI provider health, Code CLI adapters, and planner/executor/reviewer model roles. | `src/service/capabilities/providers`, `src/service/capabilities/code_cli`, `src/service/ai/model-role-routing.mjs` |
| `user_created_drafts` | Draft capability records that are recoverable but not active. | `src/service/capabilities/tools/capability-creator-tools.mjs` |

## Entry Contract

Every inventory entry has:

- `schemaVersion`
- `id`
- `group`
- `kind`
- `title`
- `owner`
- `targetLayer`
- `source`
- `enabledState`
- `trustState`
- `policyState`
- `archiveState`
- `requiredReview`
- `warnings`
- `metadata`
- `management`

The route is `GET /capabilities/inventory` and returns:

```json
{
  "inventory": {
    "schemaVersion": "capability-inventory.v1",
    "groups": [],
    "entries": [],
    "summary": {}
  }
}
```

## Boundary Rules

- Renderer code must fetch `/capabilities/inventory`; it must not import from
  `src/service/**`.
- The inventory must use existing runtime registries instead of duplicating
  tool ids, provider ids, MCP ids, or plugin ids.
- Secrets, raw env values, API keys, OAuth tokens, and prompt contents must not
  appear in inventory entries.
- Management routes are explicit metadata only. Actual mutations stay with the
  existing MCP, plugin, skill, and config route owners.
- Adding a new capability family requires adding a group or documenting why it
  belongs to an existing group, then updating the verifier.

## Verification

Run:

```powershell
node scripts/verify-capability-inventory-manager.mjs
node --test tests/behavior/capability-inventory-manager.test.mjs
npm run verify:desktop-gui-smoke
npm run check:fast
```
