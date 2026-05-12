# Planner-Selected Delegation Enablement Audit

This audit is the SA-003 gate for future automatic sub-agent enablement. It does
not enable planner-selected delegation by itself. It records which task classes
are eligible only after feature flags, evals, budget controls, context
isolation, cancellation, and trace visibility are all proven.

## Current Decision

Runtime default: disabled.

Automatic planner-selected delegation remains disabled until a later PR wires a
feature flag to runtime behavior and proves the selected task classes with real
eval results.

## Eligible Classes

| Class | Risk | Max child runs | Allowed tool families | Current state |
|---|---|---:|---|---|
| `delegate_parallel_research` | medium | 3 | `web_search_fetch`, `read_file_text` | eligible only behind feature flag |
| `delegate_isolated_file_review` | medium | 2 | `read_file_text`, `search_file_content` | eligible only behind feature flag |
| `delegate_bounded_qa` | low | 1 | `read_file_text`, `search_file_content`, `web_search_fetch` | eligible only behind feature flag |

## Forbidden Classes

- `do_not_delegate_simple_task`
- `do_not_delegate_high_risk_mutation`
- `do_not_delegate_private_context`

These categories must stay non-delegated even if the feature flag is enabled.

## Required Gates

- `feature_flag_enabled`
- `eval_category_minimum_met`
- `budget_gate_configured`
- `allowed_tool_subset_enforced`
- `context_isolation_enforced`
- `parent_cancellation_linked`
- `trace_report_visible`

## Implementation

- Audit owner: `src/service/core/evals/sub-agent-delegation-enablement-audit.mjs`
- Existing runtime contract owner:
  `src/service/core/subagents/sub-agent-runtime-contract.mjs`
- Existing eval corpus:
  `src/service/core/evals/sub-agent-delegation-corpus.mjs`
- Existing UI trace surface:
  `src/shared/sub-agent-timeline-summary.mjs`

No IPC route, HTTP route, storage schema, provider id, tool id, or renderer
runtime behavior changes are part of this phase.

## Verification

- `node scripts/verify-sub-agent-delegation-enablement-audit.mjs`
- `node scripts/verify-sub-agent-runtime-contract.mjs`
- `node scripts/verify-sub-agent-ui-evals.mjs`
- `node --test tests/behavior/sub-agent-delegation-enablement-audit.test.mjs`
