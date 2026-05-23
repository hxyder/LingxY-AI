import assert from "node:assert/strict";
import test from "node:test";

import {
  selectSuccessContractValidationSpec,
  validateAnswerSynthesis,
  validateFinalAnswerQuality,
  validateSuccessContract
} from "../../src/service/core/policy/success-contract-validator.mjs";

const multiSource = {
  profile: "multi_source_research",
  min_sources: 3,
  min_distinct_domains: 2,
  single_source_digest_satisfies: false
};

const singleLookup = {
  profile: "single_lookup",
  min_sources: 1,
  min_distinct_domains: 1,
  single_source_digest_satisfies: true
};

const deepResearch = {
  profile: "deep_research",
  min_sources: 5,
  min_distinct_domains: 3,
  single_source_digest_satisfies: false
};

test("success-contract validation accepts SR research-quality loosening without loosening tool requirements", () => {
  const selected = selectSuccessContractValidationSpec({
    task_spec_initial: {
      success_contract: {
        required_policy_groups: ["external_web_read"],
        required_tool_names: ["web_search_fetch"]
      },
      research_quality: multiSource
    },
    task_spec: {
      success_contract: {
        required_policy_groups: [],
        required_tool_names: []
      },
      research_quality: singleLookup
    }
  });

  assert.equal(selected.research_quality.profile, "single_lookup");
  assert.deepEqual(selected.success_contract.required_policy_groups, ["external_web_read"]);
  assert.deepEqual(selected.success_contract.required_tool_names, ["web_search_fetch"]);
});

test("success-contract validation rejects SR research-quality tightening", () => {
  const selected = selectSuccessContractValidationSpec({
    task_spec_initial: {
      success_contract: {
        required_policy_groups: ["external_web_read"]
      },
      research_quality: multiSource
    },
    task_spec: {
      success_contract: {
        required_policy_groups: ["external_web_read"]
      },
      research_quality: deepResearch
    }
  });

  assert.equal(selected.research_quality.profile, "multi_source_research");
});

test("success-contract validation preserves late SR research-quality when initial spec had none", () => {
  const selected = selectSuccessContractValidationSpec({
    task_spec_initial: {
      user_goal_text: "收集美股市场最新汇总信息，整理后发送邮件",
      success_contract: {
        required_policy_groups: ["external_web_read", "email_send"]
      },
      research_quality: null
    },
    task_spec: {
      user_goal_text: "收集美股市场最新汇总信息，整理后发送邮件",
      success_contract: {
        required_policy_groups: ["external_web_read", "email_send"]
      },
      research_quality: multiSource
    }
  });

  assert.equal(selected.research_quality.profile, "multi_source_research");

  const out = validateSuccessContract(selected, [{
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
  }]);

  assert.equal(out.satisfied, false);
  assert.ok(out.violations.some((violation) => violation.kind === "external_web_read_insufficient_sources"));
});

test("success-contract validation preserves current edit-file requirements from patched task spec", () => {
  const selected = selectSuccessContractValidationSpec({
    task_spec_initial: {
      goal: "qa",
      artifact: { required: true, kind: "docx" },
      success_contract: {
        artifact_created: true,
        required_tool_names: [],
        required_policy_groups: []
      }
    },
    task_spec: {
      goal: "transform_existing_file",
      artifact: { required: true, kind: "docx" },
      success_contract: {
        artifact_created: true,
        required_tool_names: ["edit_file"],
        required_policy_groups: []
      }
    }
  });

  assert.equal(selected.goal, "transform_existing_file");
  assert.equal(selected.artifact.required, true);
  assert.equal(selected.artifact.kind, "docx");
  assert.ok(selected.success_contract.required_tool_names.includes("edit_file"));

  const out = validateSuccessContract(selected, [
    { type: "tool_result", tool: "generate_document", success: true, artifact_paths: ["E:/out/result.docx"] }
  ]);
  assert.equal(out.satisfied, false);
  assert.ok(out.violations.some((violation) => violation.kind === "edit_file_required_not_called"));
});

test("synthesis validation rejects two-record connector lists for summary output", () => {
  const violations = validateAnswerSynthesis(
    { synthesis: { expected_output: "summary" } },
    [{
      type: "tool_result",
      tool: "account_list_emails",
      success: true,
      observation: [
        "account_list_emails returned 2 emails from google account me@example.com:",
        "1. 2026-05-05 | Ada <ada@example.com> | Budget review and follow-up plan for the Q2 forecast",
        "2. 2026-05-05 | Ben <ben@example.com> | Lunch logistics and meeting room update"
      ].join("\n"),
      metadata: {
        result_kind: "record_list",
        record_type: "email",
        record_count: 2,
        emails: [
          { subject: "Budget review and follow-up plan for the Q2 forecast", from: "ada@example.com" },
          { subject: "Lunch logistics and meeting room update", from: "ben@example.com" }
        ]
      }
    }],
    [
      "1. 2026-05-05 | Ada <ada@example.com> | Budget review and follow-up plan for the Q2 forecast",
      "2. 2026-05-05 | Ben <ben@example.com> | Lunch logistics and meeting room update"
    ].join("\n")
  );

  assert.equal(violations[0]?.kind, "answer_not_synthesized");
  assert.match(violations[0]?.checkerReason ?? "", /record_list_not_synthesized=2/);
});

test("final answer quality rejects recent local event answers without concrete dated events", () => {
  const violations = validateFinalAnswerQuality({
    task: {
      user_command: "我的城市最近有什么有意思的活动吗？",
      task_spec: {
        synthesis: { expected_output: "summary" },
        research_quality: multiSource
      }
    },
    transcript: [{
      type: "tool_result",
      tool: "web_search_fetch",
      success: true,
      observation: "搜索结果：Raleigh events this weekend...",
      metadata: {
        results: [{ url: "https://www.visitraleigh.com/events/" }]
      }
    }],
    finalText: "没有直接列出具体的活动名称和日期。建议直接访问活动日历。"
  });

  assert.equal(violations[0]?.kind, "local_event_answer_lacks_concrete_events");
});

test("final answer quality does not treat recent movie release questions as local events", () => {
  const violations = validateFinalAnswerQuality({
    task: {
      user_command: "最近有什么要上映的新电影吗",
      task_spec: {
        synthesis: { expected_output: "summary" },
        research_quality: multiSource
      }
    },
    transcript: [{
      type: "tool_result",
      tool: "web_search_fetch",
      success: true,
      observation: "搜索结果：2026年5月 新电影上映片单。",
      metadata: {
        results: [{ url: "https://example.com/movies" }]
      }
    }],
    finalText: "5月15日有一部新电影上映。"
  });

  assert.deepEqual(violations, []);
});

test("final answer quality rejects structurally incomplete markdown endings", () => {
  const violations = validateFinalAnswerQuality({
    task: { task_spec: { synthesis: { expected_output: "summary" } } },
    transcript: [],
    finalText: "这里是分析内容。\n\n##"
  });

  assert.equal(violations[0]?.kind, "final_answer_dangling_markdown_heading");
});

test("final answer quality accepts recent local event answers with dated venue details", () => {
  const violations = validateFinalAnswerQuality({
    task: {
      user_command: "my city upcoming events this weekend",
      task_spec: {
        synthesis: { expected_output: "summary" },
        research_quality: multiSource
      }
    },
    transcript: [{
      type: "tool_result",
      tool: "fetch_url_content",
      success: true,
      observation: "Event calendar with listings.",
      metadata: {
        url: "https://example.com/events",
        content_quality: { usable: true }
      }
    }],
    finalText: [
      "- May 16, 7:30 pm — Jazz Night at Downtown Theater.",
      "- May 17, 10:00 am — Spring Market at Moore Square Park."
    ].join("\n")
  });

  assert.deepEqual(violations, []);
});

test("external web read contract rejects fetch pages marked as boilerplate-dominant", () => {
  const out = validateSuccessContract({
    success_contract: { required_policy_groups: ["external_web_read"] }
  }, [{
    type: "tool_result",
    tool: "fetch_url_content",
    success: true,
    observation: "Cookies in use Search Search Places to Stay Events This Weekend Submit an Event",
    metadata: {
      url: "https://example.com/events",
      content_quality: {
        usable: false,
        boilerplate_dominant: true
      }
    }
  }]);

  assert.equal(out.satisfied, false);
  assert.equal(out.violations[0]?.kind, "external_web_read_required_returned_empty");
});
