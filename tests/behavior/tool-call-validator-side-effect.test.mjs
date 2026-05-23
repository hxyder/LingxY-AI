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

const connectorWorkflowTool = {
  id: "connector_workflow_run",
  parameters: {
    type: "object",
    required: ["workflowId"],
    properties: {
      workflowId: { type: "string" },
      input: { type: "object" },
      state: { type: "object" }
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

function artifactEmailTask() {
  return {
    task_spec: {
      artifact: { required: true, kind: "docx" },
      synthesis: { expected_output: "execution" },
      success_contract: {
        artifact_created: true,
        artifact_registered: true,
        required_policy_groups: ["email_send"]
      }
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

test("rejects research email bodies that include envelope headers", () => {
  const result = validateToolCall(emailTool, {
    to: ["reviewer@example.com"],
    subject: "Market digest",
    body: [
      "**Subject:** Market digest",
      "",
      "**To:** reviewer@example.com",
      "",
      "Summary",
      "",
      "- Major indexes were mixed to higher according to the gathered market source.",
      "",
      "Sources: Market evidence"
    ].join("\n")
  }, {
    task: researchEmailTask(),
    transcript: transcript()
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "email_body_must_not_include_envelope_headers");
});

test("rejects research email bodies that include composer scaffold text", () => {
  const result = validateToolCall(emailTool, {
    to: ["reviewer@example.com"],
    subject: "Market digest",
    body: [
      "以下是邮件正文内容，可直接发送：",
      "",
      "Summary",
      "",
      "- Major indexes were mixed to higher according to the gathered market source.",
      "",
      "Sources: Market evidence"
    ].join("\n")
  }, {
    task: researchEmailTask(),
    transcript: transcript()
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "email_body_must_not_include_composer_scaffold");
});

test("accepts a synthesized research email body that uses markdown section dividers", () => {
  const result = validateToolCall(emailTool, {
    to: ["reviewer@example.com"],
    subject: "Market digest",
    body: [
      "Market digest",
      "",
      "---",
      "",
      "Major indexes were mixed to higher according to the gathered market source.",
      "The brief keeps the source evidence summarized in user-facing prose instead of dumping the tool transcript.",
      "",
      "Sources: Market evidence"
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

test("blocks scheduled research email when late SR research contract was absent from initial spec", () => {
  const task = researchEmailTask();
  task.task_spec_initial = {
    synthesis: { expected_output: "execution" },
    research_quality: null,
    success_contract: { required_policy_groups: ["external_web_read", "email_send"] }
  };
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
      "The gathered search did not include enough market-specific sources, so this must not be sent."
    ].join("\n")
  }, {
    task,
    transcript: [{
      type: "tool_result",
      tool: "web_search_fetch",
      success: true,
      observation: "Search results for US stock market today.",
      metadata: {
        query: "US stock market today S&P 500 Dow Jones Nasdaq",
        results: [{
          title: "Latest U.S. News | Reuters",
          url: "https://www.reuters.com/world/us/",
          snippet: "Latest U.S. headlines."
        }]
      }
    }]
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /email_send_blocked_until_non_action_contract_satisfied/);
  assert.match(result.error, /external_web_read_insufficient_sources/);
});

test("blocks connector email workflow until required document artifact is generated", () => {
  const result = validateToolCall(connectorWorkflowTool, {
    workflowId: "google.gmail.draft_confirm_send",
    input: {
      to: ["reviewer@example.com"],
      subject: "Report",
      body: "请查收附件。"
    }
  }, {
    task: artifactEmailTask(),
    transcript: []
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /email_send_blocked_until_non_action_contract_satisfied/);
  assert.match(result.error, /artifact_required_not_created/);
});

test("blocks generated document email when attachmentPaths omits the artifact path", () => {
  const transcriptWithArtifact = [{
    type: "tool_result",
    tool: "generate_document",
    success: true,
    observation: "Generated document.",
    artifact_paths: ["E:\\out\\report.docx"],
    metadata: { path: "E:\\out\\report.docx", kind: "docx" }
  }];
  const result = validateToolCall(connectorWorkflowTool, {
    workflowId: "google.gmail.draft_confirm_send",
    input: {
      to: ["reviewer@example.com"],
      subject: "Report",
      body: "请查收附件。"
    }
  }, {
    task: artifactEmailTask(),
    transcript: transcriptWithArtifact
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "email_send_requires_generated_artifact_attachment_paths");
});

test("accepts connector email workflow when it attaches the generated artifact", () => {
  const transcriptWithArtifact = [{
    type: "tool_result",
    tool: "generate_document",
    success: true,
    observation: "Generated document.",
    artifact_paths: ["E:\\out\\report.docx"],
    metadata: { path: "E:\\out\\report.docx", kind: "docx" }
  }];
  const result = validateToolCall(connectorWorkflowTool, {
    workflowId: "google.gmail.draft_confirm_send",
    input: {
      to: ["reviewer@example.com"],
      subject: "Report",
      body: "请查收附件。",
      attachmentPaths: ["E:\\out\\report.docx"]
    }
  }, {
    task: artifactEmailTask(),
    transcript: transcriptWithArtifact
  });
  assert.equal(result.ok, true);
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

test("rejects joined raw web observations separated by markdown dividers", () => {
  const observations = [
    "First market observation says index futures fell while oil prices rose. ".repeat(3).trim(),
    "Second market observation says investors watched geopolitical risk and technology earnings. ".repeat(3).trim()
  ];
  const result = validateToolCall(emailTool, {
    to: ["reviewer@example.com"],
    subject: "Market digest",
    body: observations.join("\n\n---\n\n")
  }, {
    task: researchEmailTask(),
    transcript: observations.map((observation, index) => ({
      type: "tool_result",
      tool: "web_search_fetch",
      success: true,
      observation,
      metadata: {
        results: [{
          title: `Market evidence ${index + 1}`,
          url: `https://example.com/market-${index + 1}`,
          snippet: observation
        }]
      }
    }))
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
      "Market digest",
      "",
      "Summary",
      "",
      "- The gathered market source indicates the following relevant point:",
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

test("rejects source inventory only research email bodies", () => {
  const rawObservation = "Market summary evidence from the search tool. ".repeat(8).trim();
  const result = validateToolCall(emailTool, {
    to: ["reviewer@example.com"],
    subject: "Market digest",
    body: [
      "LingxY prepared the result below from the evidence gathered during this run:",
      "",
      "1. Market evidence",
      `   ${rawObservation}`,
      "   https://example.com/market",
      "",
      "Note: this automatically sent content is based on structured tool evidence and excludes account, connector, and debug logs."
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
  assert.equal(result.ok, false);
  assert.equal(result.error, "email_body_source_inventory_only");
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
