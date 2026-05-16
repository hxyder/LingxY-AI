import assert from "node:assert/strict";
import test from "node:test";

import { validateToolCall } from "../../src/service/executors/tool_using/tool-call-validator.mjs";

const emailTool = {
  id: "account_send_email",
  parameters: {
    type: "object",
    required: ["to", "subject", "body"],
    properties: {
      to: { type: "array", items: { type: "string" } },
      subject: { type: "string" },
      body: { type: "string" }
    }
  }
};

function researchEmailTask() {
  return {
    task_spec: {
      synthesis: { expected_output: "summary" },
      research_quality: { profile: "multi_source_research" },
      success_contract: { required_policy_groups: ["external_web_read", "email_send"] }
    }
  };
}

function transcript() {
  return [
    {
      type: "tool_result",
      tool: "connector_catalog_search",
      success: true,
      observation: "Connector catalog search returned 0 result(s)."
    },
    {
      type: "tool_result",
      tool: "account_list_connected_accounts",
      success: true,
      observation: "Connected accounts: google: reviewer@example.com"
    },
    {
      type: "tool_result",
      tool: "web_search_fetch",
      success: true,
      observation: "Market summary evidence from the search tool.",
      metadata: {
        results: [{
          title: "Market evidence",
          url: "https://example.com/market",
          snippet: "Dow Jones and Nasdaq moved higher in the latest session."
        }]
      }
    }
  ];
}

test("rejects scheduled research email bodies that dump raw connector/account transcript", () => {
  const body = transcript().map((entry) => entry.observation).join("\n\n---\n\n");
  const result = validateToolCall(emailTool, {
    to: ["reviewer@example.com"],
    subject: "Market digest",
    body
  }, {
    task: researchEmailTask(),
    transcript: transcript()
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "email_body_must_not_include_connector_or_account_logs");
});

test("accepts a synthesized research email body with structured source evidence", () => {
  const result = validateToolCall(emailTool, {
    to: ["reviewer@example.com"],
    subject: "Market digest",
    body: [
      "Market digest",
      "",
      "1. Major indexes were mixed to higher according to the gathered source.",
      "   Source: Market evidence — https://example.com/market",
      "2. The note keeps account and connector logs out of the user-facing email."
    ].join("\n")
  }, {
    task: researchEmailTask(),
    transcript: transcript()
  });
  assert.equal(result.ok, true);
});

test("blocks research email send until non-action evidence contract is satisfied", () => {
  const task = researchEmailTask();
  task.task_spec.research_quality = {
    profile: "multi_source_research",
    min_sources: 3,
    min_distinct_domains: 2,
    single_source_digest_satisfies: false
  };
  const result = validateToolCall(emailTool, {
    to: ["reviewer@example.com"],
    subject: "Market digest",
    body: [
      "Market digest",
      "",
      "Major indexes cannot be summarized from a single weak source, so this body must not be sent yet.",
      "The executor should gather more independent market evidence before the email side effect."
    ].join("\n")
  }, {
    task,
    transcript: transcript()
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /email_send_blocked_until_non_action_contract_satisfied/);
  assert.match(result.error, /external_web_read_insufficient_sources/);
});

test("rejects a single raw web observation used verbatim as the email body", () => {
  const rawObservation = "Market summary evidence from the search tool. ".repeat(8).trim();
  const result = validateToolCall(emailTool, {
    to: ["reviewer@example.com"],
    subject: "Market digest",
    body: rawObservation
  }, {
    task: researchEmailTask(),
    transcript: [{
      type: "tool_result",
      tool: "web_search_fetch",
      success: true,
      observation: rawObservation,
      metadata: {
        results: [{ title: "Market evidence", url: "https://example.com/market", snippet: rawObservation }]
      }
    }]
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "email_body_raw_tool_transcript_dump");
});

test("allows a structured source digest even when it quotes a web excerpt", () => {
  const rawObservation = "Market summary evidence from the search tool. ".repeat(8).trim();
  const result = validateToolCall(emailTool, {
    to: ["reviewer@example.com"],
    subject: "Market digest",
    body: [
      "LingxY prepared the result below from the evidence gathered during this run:",
      "",
      "1. Market evidence",
      `   ${rawObservation}`,
      "   https://example.com/market"
    ].join("\n")
  }, {
    task: researchEmailTask(),
    transcript: [{
      type: "tool_result",
      tool: "web_search_fetch",
      success: true,
      observation: rawObservation,
      metadata: {
        results: [{ title: "Market evidence", url: "https://example.com/market", snippet: rawObservation }]
      }
    }]
  });
  assert.equal(result.ok, true);
});

test("does not impose research body rules on a simple plain email", () => {
  const result = validateToolCall(emailTool, {
    to: ["reviewer@example.com"],
    subject: "Hello",
    body: "Thanks."
  }, {
    task: { task_spec: {} },
    transcript: transcript()
  });
  assert.equal(result.ok, true);
});
