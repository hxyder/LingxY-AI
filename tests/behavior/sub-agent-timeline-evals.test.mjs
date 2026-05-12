import assert from "node:assert/strict";
import test from "node:test";

import { renderSubAgentTimelinePanel } from "../../src/desktop/renderer/console-task-detail.mjs";
import {
  SUB_AGENT_DELEGATION_EVAL_CASES,
  SUB_AGENT_DELEGATION_EVAL_MINIMUMS,
  evaluateSubAgentDelegationDecision
} from "../../src/service/core/evals/sub-agent-delegation-corpus.mjs";
import { buildSubAgentTimelineSummary } from "../../src/shared/sub-agent-timeline-summary.mjs";

test("sub-agent timeline summary combines child tasks and structured reports", () => {
  const summary = buildSubAgentTimelineSummary({
    parentTask: {
      task_id: "task_parent",
      child_task_ids: ["task_child_a", "task_child_b"]
    },
    childTasks: [
      {
        task_id: "task_child_a",
        parent_task_id: "task_parent",
        child_index: 0,
        status: "success",
        user_command: "read file A",
        result_summary: "A checked",
        usage_summary: { tokens_in: 10, tokens_out: 5 },
        elapsed_ms: 200
      }
    ],
    events: [
      {
        event_type: "sub_agent_report",
        ts: "2026-05-12T00:00:00.000Z",
        payload: {
          child_task_id: "task_child_b",
          parent_task_id: "task_parent",
          assigned_scope_id: "scope_b",
          status: "failed",
          summary: "B escaped",
          tool_calls: [{ tool_id: "write_file" }],
          violations: ["tool_surface_escape:write_file"],
          budget: { observed: { prompt_tokens: 20 } }
        }
      }
    ]
  });

  assert.equal(summary.has_sub_agents, true);
  assert.equal(summary.totals.total, 2);
  assert.equal(summary.totals.success, 1);
  assert.equal(summary.totals.failed, 1);
  assert.equal(summary.totals.violations, 1);
  assert.equal(summary.items.some((item) => item.child_task_id === "task_child_b" && item.violation_count === 1), true);
});

test("sub-agent timeline panel renders child runs without raw event JSON", () => {
  const html = renderSubAgentTimelinePanel({
    task: {
      task_id: "task_parent",
      child_task_ids: ["task_child_a"]
    },
    children: [{
      task_id: "task_child_a",
      parent_task_id: "task_parent",
      child_index: 0,
      status: "success",
      user_command: "read file A",
      result_summary: "A checked",
      elapsed_ms: 200
    }],
    events: [{
      event_type: "sub_agent_report",
      payload: {
        child_task_id: "task_child_a",
        assigned_scope_id: "scope_a",
        status: "success",
        summary: "A checked",
        tool_calls: [{ tool_id: "read_file_text" }],
        violations: []
      }
    }]
  });

  assert.match(html, /Sub-agents/);
  assert.match(html, /read file A/);
  assert.match(html, /scope scope_a/);
  assert.match(html, /1 tools/);
  assert.match(html, /data-sub-agent-child-task-id="task_child_a"/);
  assert.doesNotMatch(html, /"event_type"|tool_calls/u);
});

test("sub-agent delegation eval corpus meets category minimums", () => {
  const counts = new Map();
  for (const item of SUB_AGENT_DELEGATION_EVAL_CASES) {
    counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  }
  for (const [category, minimum] of Object.entries(SUB_AGENT_DELEGATION_EVAL_MINIMUMS)) {
    assert.equal((counts.get(category) ?? 0) >= minimum, true, `${category} has too few cases`);
  }
});

test("sub-agent delegation eval catches wrong delegation and scope escapes", () => {
  const doNotDelegateCase = SUB_AGENT_DELEGATION_EVAL_CASES.find((item) => item.category === "do_not_delegate_high_risk_mutation");
  const result = evaluateSubAgentDelegationDecision(doNotDelegateCase, {
    should_delegate: true,
    child_runs: [{
      allowed_tool_ids: ["write_file"],
      context_item_ids: ["ctx_file_a"]
    }]
  });

  assert.equal(result.ok, false);
  assert.ok(result.failures.includes("delegate_decision_mismatch"));
  assert.ok(result.failures.some((failure) => failure.startsWith("forbidden_tool:")));
});

test("sub-agent delegation eval accepts bounded planner-selected delegation", () => {
  const delegateCase = SUB_AGENT_DELEGATION_EVAL_CASES.find((item) => item.id === "file_review_01");
  const result = evaluateSubAgentDelegationDecision(delegateCase, {
    should_delegate: true,
    child_runs: [{
      allowed_tool_ids: ["read_file_text"],
      context_item_ids: ["ctx_log"]
    }]
  });

  assert.equal(result.ok, true);
});
