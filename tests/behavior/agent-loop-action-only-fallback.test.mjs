import assert from "node:assert/strict";
import test from "node:test";

import { synthesiseDeterministicActionFallback } from "../../src/service/executors/tool_using/agent-loop.mjs";

// Audit-driven regression (2026-05-07, task_f62f95d0): a stubborn LLM
// planner kept proposing fetch_url_content past 3 retries even though the
// action_only filter limited the visible tools to email_send. The
// schedule had pre-authorized email_send with explicit recipients in
// side_effect_contract.email_send.to.values; the framework should honour
// that pre-authorization and execute the action deterministically rather
// than ending in partial_success with no email sent.
//
// The agent-loop deny path calls synthesiseDeterministicActionFallback
// after MAX_SYNTHESIS_RETRIES is exhausted. These tests pin its
// decision logic in isolation so we can iterate without driving the full
// loop.

function makePreauthorizedTask({
  recipients = ["reviewer@example.com"],
  authorizedGroups = ["email_send"],
  decision = "preauthorized",
  requiredPolicyGroups = []
} = {}) {
  return {
    user_command: "整理今天美股新闻发送邮件到 reviewer@example.com",
    task_spec: {
      success_contract: {
        required_policy_groups: requiredPolicyGroups,
        required_tool_names: []
      }
    },
    context_packet: {
      selection_metadata: {
        side_effect_authorization: {
          kind: "scheduled_fire",
          decision,
          source: "schedule_definition",
          execution_mode: "unattended_safe",
          groups: authorizedGroups
        },
        side_effect_contract: {
          version: 1,
          kind: "side_effect_contract",
          groups: {
            email_send: {
              slots: {
                to: { entity: "email_address", values: recipients, mode: "preserve" }
              }
            }
          }
        }
      }
    }
  };
}

function makeTranscript({ observation = "Dow Jones up 0.6%, Nasdaq up 0.4%." } = {}) {
  return [
    {
      type: "tool_result",
      tool: "web_search_fetch",
      success: true,
      observation,
      metadata: {
        results: [{ title: "Market evidence", url: "https://example.com/market" }]
      }
    }
  ];
}

test("returns a tool_call when preauthorized + recipients + allowed email tool", () => {
  const decision = synthesiseDeterministicActionFallback({
    task: makePreauthorizedTask(),
    transcript: makeTranscript(),
    allowed: ["account_send_email", "send_email_smtp"]
  });
  assert.ok(decision, "expected a tool_call decision");
  assert.equal(decision.type, "tool_call");
  assert.equal(decision.tool, "account_send_email", "preferred tool wins");
  assert.deepEqual(decision.args.to, ["reviewer@example.com"]);
  assert.ok(decision.args.subject && decision.args.subject.length > 0, "subject is filled in");
  assert.ok(decision.args.body && decision.args.body.length > 0, "body is filled in");
  assert.match(decision.args.body, /Dow Jones up 0\.6%/, "body includes transcript observations");
  assert.equal(decision.__deterministic_fallback, true);
});

test("returns null when a required non-action policy group is still unsatisfied", () => {
  const decision = synthesiseDeterministicActionFallback({
    task: makePreauthorizedTask({ requiredPolicyGroups: ["external_web_read", "email_send"] }),
    transcript: [],
    allowed: ["account_send_email"]
  });
  assert.equal(decision, null);
});

test("allows deterministic email fallback after required web evidence is satisfied", () => {
  const decision = synthesiseDeterministicActionFallback({
    task: makePreauthorizedTask({ requiredPolicyGroups: ["external_web_read", "email_send"] }),
    transcript: makeTranscript(),
    allowed: ["account_send_email"]
  });
  assert.equal(decision?.tool, "account_send_email");
  assert.match(decision?.args?.body ?? "", /Dow Jones up 0\.6%/);
});

test("returns null when authorization is missing (interactive task)", () => {
  const task = makePreauthorizedTask();
  delete task.context_packet.selection_metadata.side_effect_authorization;
  const decision = synthesiseDeterministicActionFallback({
    task,
    transcript: makeTranscript(),
    allowed: ["account_send_email"]
  });
  assert.equal(decision, null, "no preauthorization => no fallback");
});

test("returns null when authorization decision is not 'preauthorized'", () => {
  const task = makePreauthorizedTask({ decision: "deferred" });
  const decision = synthesiseDeterministicActionFallback({
    task,
    transcript: makeTranscript(),
    allowed: ["account_send_email"]
  });
  assert.equal(decision, null);
});

test("returns null when email_send is not in the authorized group list", () => {
  const task = makePreauthorizedTask({ authorizedGroups: ["calendar_create"] });
  const decision = synthesiseDeterministicActionFallback({
    task,
    transcript: makeTranscript(),
    allowed: ["account_send_email"]
  });
  assert.equal(decision, null);
});

test("returns null when contract has no recipient values", () => {
  const task = makePreauthorizedTask({ recipients: [] });
  const decision = synthesiseDeterministicActionFallback({
    task,
    transcript: makeTranscript(),
    allowed: ["account_send_email"]
  });
  assert.equal(decision, null);
});

test("returns null when no allowed tool matches the email send preference list", () => {
  const decision = synthesiseDeterministicActionFallback({
    task: makePreauthorizedTask(),
    transcript: makeTranscript(),
    allowed: ["fetch_url_content", "web_search_fetch"]
  });
  assert.equal(decision, null);
});

test("respects the preference order — prefers account_send_email over send_email_smtp", () => {
  const decision = synthesiseDeterministicActionFallback({
    task: makePreauthorizedTask(),
    transcript: makeTranscript(),
    allowed: ["send_email_smtp", "account_send_email"]
  });
  assert.equal(decision?.tool, "account_send_email");
});

test("falls back to send_email_smtp when account_send_email is not allowed", () => {
  const decision = synthesiseDeterministicActionFallback({
    task: makePreauthorizedTask(),
    transcript: makeTranscript(),
    allowed: ["send_email_smtp"]
  });
  assert.equal(decision?.tool, "send_email_smtp");
});

test("body falls back to a placeholder when the transcript has no observations", () => {
  const decision = synthesiseDeterministicActionFallback({
    task: makePreauthorizedTask(),
    transcript: [],
    allowed: ["account_send_email"]
  });
  assert.ok(decision?.args.body);
  assert.match(decision.args.body, /未能整理出文本内容|LingxY/);
});

test("degraded routing does not send deterministic email fallback without evidence", () => {
  const task = makePreauthorizedTask();
  task.task_spec.routing_degraded = true;
  const decision = synthesiseDeterministicActionFallback({
    task,
    transcript: [],
    allowed: ["account_send_email"]
  });
  assert.equal(decision, null);
});

test("subject derives from the first line of user_command, capped to 80 chars", () => {
  const longCommand = "请把今天的美股摘要".repeat(20);
  const task = makePreauthorizedTask();
  task.user_command = longCommand;
  const decision = synthesiseDeterministicActionFallback({
    task,
    transcript: makeTranscript(),
    allowed: ["account_send_email"]
  });
  assert.ok(decision.args.subject.length <= 80);
});

test("body is capped at 8000 chars to keep the email tractable", () => {
  const big = "x".repeat(20000);
  const decision = synthesiseDeterministicActionFallback({
    task: makePreauthorizedTask(),
    transcript: [{ type: "tool_call_completed", observation: big }],
    allowed: ["account_send_email"]
  });
  assert.ok(decision.args.body.length <= 8000);
});

test("forwards multiple recipients verbatim", () => {
  const recipients = ["a@example.com", "b@example.com", "c@example.com"];
  const decision = synthesiseDeterministicActionFallback({
    task: makePreauthorizedTask({ recipients }),
    transcript: makeTranscript(),
    allowed: ["account_send_email"]
  });
  assert.deepEqual(decision.args.to, recipients);
});
