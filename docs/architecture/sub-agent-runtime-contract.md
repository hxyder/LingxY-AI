# Sub-Agent Runtime Contract

Status: SA-001 service contract complete as of 2026-05-12.

This document defines the first safe runtime boundary for future sub-agent
execution. It is a service-layer contract only. It does not add renderer UI,
IPC channels, HTTP routes, provider ids, tool ids, storage schema, or automatic
recursive delegation.

## Owner

- Contract owner:
  `src/service/core/subagents/sub-agent-runtime-contract.mjs`
- Wiring owner:
  `src/service/core/task-runtime/runtime-services.mjs`
- Verification:
  `scripts/verify-sub-agent-runtime-contract.mjs`
- Behavior coverage:
  `tests/behavior/sub-agent-runtime-contract.test.mjs`

## Invariants

- Sub-agent runtime is disabled by default.
- A child run contract can be created only with an explicit feature flag:
  `runtime.featureFlags.subAgentRuntime === true`,
  `runtime.features.subAgentRuntime === true`,
  `runtime.config.subAgentRuntime.enabled === true`,
  `runtime.subAgentRuntimeConfig.enabled === true`, or an explicit test/config
  opt-in.
- Delegation source must be `planner_selected`.
- Prompt-only delegation, unmanaged recursive agents, and implicit child runs
  are rejected.
- The assigned tool surface must be a subset of the parent allowed tool surface.
- The isolated compiled context contains only assigned context item ids.
- Budget is explicit and checked for tool calls, prompt tokens, runtime
  duration, and context item count.
- Cancellation is parent-to-child through an abort boundary and a typed
  cancellation token.
- Child results return a structured report for parent synthesis. Tool-surface
  escapes and budget exhaustion are violations.

## Contract Shape

The service creates a `SUB_AGENT_RUNTIME_SCHEMA_VERSION` contract containing:

- `parent_task_id`
- `child_task_id`
- `assigned_scope`
- `isolated_compiled_context`
- `allowed_tool_ids`
- `budget`
- `cancellation_token`
- `delegation`

The result report contains:

- `parent_task_id`
- `child_task_id`
- `assigned_scope_id`
- `status`
- `summary`
- `tool_calls`
- `budget`
- `violations`
- `ok`

## Not In SA-001

- No automatic planner delegation.
- No child executor loop.
- No child timeline UI.
- No new storage tables.
- No IPC or HTTP route changes.
- No provider or model routing changes.

SA-002 owns UI/timeline/eval coverage after this service contract is stable.
