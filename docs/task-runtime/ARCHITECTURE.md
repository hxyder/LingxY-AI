# LingxY Connector Architecture

**Status**: FRAMEWORK BASELINE + Microsoft parity + plugin CRUD + internal MCP server landed in 2026-04-19 follow-up.
**Audience**: implementers adding a new connector, MCP server, or plugin.

This is the design reference. For the concrete file list and implementation log see [MCP_CONNECTOR_OPTIMIZATION_PLAN.md](MCP_CONNECTOR_OPTIMIZATION_PLAN.md). For plugin install/uninstall see [PLUGIN_LIFECYCLE.md](PLUGIN_LIFECYCLE.md). For external MCP integration see [MCP_INTEGRATION.md](MCP_INTEGRATION.md).

---

## 1. Why this shape

The prior "universal Task Runtime" path routed every text request through normalize → classify → plan → execute → verify LLM calls. It hurt fast paths, and even on the slow path produced empty-but-valid outputs (draft tasks that reported "success" with an empty body).

The replacement is a layered dispatch that keeps the fast paths fast and makes service semantics the authority for provider work:

| Layer | Responsibility | Performance Rule |
|---|---|---|
| Fast path | deterministic local actions, URL open, translate, launch app | no planner |
| Existing executors | context / agentic / tool_using paths | preserve behavior |
| Connector contracts | Gmail, Calendar, Drive, Outlook, OneDrive service semantics | schema-first |
| MCP adapter | external MCP servers and internal MCP-compatible surface | only for connected services |
| Workflow templates | draft-confirm-send, create-confirm, search-and-report | explicit, not re-inferred per request |

## 2. Ownership rules

| Concept | Owns | Directory | Must not own |
|---|---|---|---|
| Skills | reusable reasoning/work instructions rendered into prompts | [src/service/capabilities/skills/](../../src/service/capabilities/skills/) | OAuth, account state, provider APIs, service execution |
| MCP adapters | external MCP server transport, discovery, bridge | [src/service/ai/mcp/](../../src/service/ai/mcp/) | provider-specific business rules, confirmation bypass |
| Action tools | local execution primitives, schema validation, risk matrix | [src/service/action_tools/](../../src/service/action_tools/) | Gmail/Calendar/Drive semantics |
| Connectors | provider accounts, scopes, service contracts, workflows | [src/service/connectors/\<provider\>/](../../src/service/connectors/) | generic planner behavior |
| Connector core | shared account routing, token status, validators, dispatcher | [src/service/connectors/core/](../../src/service/connectors/core/) | provider-specific payload shaping |
| Workflows | deterministic multi-step service flows | [src/service/connectors/\<provider\>/workflows/](../../src/service/connectors/) | broad open-ended planning |

Rules:

1. **Provider-specific behavior** lives under the provider connector (`connectors/google/`, `connectors/microsoft/`). Shared core keeps only reusable primitives.
2. **Skills cannot be service integration contracts.** A skill may teach the model how to write a good email; it must not define Gmail send semantics, OAuth scopes, or confirmation rules.
3. **MCP is an adapter boundary**, not the source of truth. Internal connectors expose MCP-compatible concepts; external MCP servers flow through [MCP_INTEGRATION.md](MCP_INTEGRATION.md#external-catalog-bridge) so local account, confirmation, and risk policy still apply.
4. **Action tools stay generic and controlled.** Local actions (notify, document render, browser ops) remain action tools. Service actions surface through connector contracts.
5. **Workflows beat planning for known service flows.** `draft_then_confirm_send`, `calendar_create_with_confirmation`, etc., are workflow templates. The planner handles unknown composition only.

## 3. Directory layout

```text
src/service/
  ai/
    skills/                    # prompt-time behavioral instructions only
    mcp/                       # MCP transports, external client bridge, internal server
      internal-server/         # stdio MCP server that re-exports the catalog
  action_tools/                # local execution primitives
  connectors/
    core/                      # catalog, contract-loader, validators, dispatcher,
                               # plugin-registry, mcp-catalog-bridge
    tools/                     # action tools that touch the catalog / accounts
      action-tool-aggregator.mjs
    google/
      google-connector.mjs
      contracts/               # google.connector.json, gmail.tools.json, ...
      workflows/               # gmail.draft-confirm-send.json, ...
    microsoft/
      microsoft-connector.mjs
      contracts/
      workflows/
  core/
    http-server.mjs
    http-routes/
      connector-routes.mjs     # /connectors/*, /plugins/*, /auth/callback
    http-helpers.mjs
```

## 4. Catalog pipeline

One discovery pipeline, multiple sources:

1. Load internal connector manifests from `src/service/connectors/<provider>/contracts/*.json`.
2. Load workflow templates from `src/service/connectors/<provider>/workflows/*.json`.
3. Load installed external plugin manifests from `<userdata>/plugins/<pluginId>/plugin.json`.
4. Map enabled external MCP servers into catalog entries via `mcp-catalog-bridge`.
5. Register callable operations in the catalog with risk + confirmation metadata attached.

```text
createServiceBootstrap()
  -> runtime.connectorCatalog
  -> loads provider contracts/workflows from src/service/connectors/<provider>/
  -> merges enabled plugins from <userdata>/plugins/
  -> exposes summaries via GET /connectors/catalog
  -> exposes full contracts via GET /connectors/catalog/tools/:id and /workflows/:id
  -> exposes lightweight discovery via connector_catalog_search and connector_catalog_get
  -> executes workflows via connector_workflow_run or POST /connectors/catalog/workflows/:id/run
```

## 5. Dispatch order

For every user request:

1. Fast deterministic route.
2. **Catalog-driven workflow match** (agent-loop calls `matchWorkflowByTrigger`; on hit, dispatches `connector_workflow_run`).
3. Existing executor route.
4. Selective planner only when no known route matches.
5. External MCP fallback only when explicitly configured and policy allows.

Gmail draft requests hit step 2 via `google.gmail.draft_confirm_send`. "Tool is a heavy skill" means the model sees one tool call that handles preview → confirmation → send internally.

## 6. Timeline contract

Timeline shows every meaningful action without dumping payloads.

Event shape:

```json
{
  "type": "tool_call",
  "label": "Gmail draft preview",
  "provider": "google",
  "tool": "gmail.create_draft_preview",
  "status": "completed",
  "durationMs": 420,
  "summary": "Draft prepared for sophie@example.com",
  "payloadRef": "redacted-or-artifact-id"
}
```

Rules:

- Show action label, provider, status, duration, short summary.
- Never show email body, tokens, raw API responses, or search dumps in the timeline.
- Large content becomes an artifact or preview panel.
- Sensitive write actions must show pending confirmation state.
- A successful workflow must produce `user_visible_output` or an artifact reference.

Dispatcher emits `step_started`, `tool_call_proposed`, `tool_call_completed`, `pending_approval_created`, and `step_finished`. Confirmation pauses create pending approvals with `proposedAction: connector_workflow`; approval resumes the same workflow id.

## 7. Output validation

Workflows must validate meaningful output, not field presence.

Validators (`src/service/connectors/core/validators.mjs`):

- `nonempty_string`
- `email[]`
- `boolean_true`
- `file_exists`
- `array_min_items`
- `artifact_exists`
- `pending_confirmation`

Empty Gmail subject/body fails the workflow. Verifier success alone is not enough.

## 8. Performance guardrails

- No more than one LLM call for a simple connector workflow.
- Zero LLM calls for account listing, connection status, or deterministic tool calls.
- Any workflow over 5 seconds must surface its current stage.
- Replan loops disabled for connector workflows; use deterministic error handling.

## 9. Ownership-status of legacy callers

| File | Role | Alignment |
|---|---|---|
| `connectors/tools/read-tools.mjs` / `write-tools.mjs` | generic account execution primitives | kept behind `execution.actionTool` |
| `connectors/account-connectors.mjs` | OAuth config | kept; HTTP reads route through canonical action tools |
| `executors/tool_using/agent-loop.mjs` | planner heuristics | workflow-first catalog dispatch (no more Gmail regex) |
| `action_tools/tools/index.mjs` | action tool registry | registers `CONNECTOR_ACTION_TOOLS` as single group |
| `ai/mcp/client-bridge.mjs` | external MCP client | funnels through `mcp-catalog-bridge` instead of direct prompt injection |
