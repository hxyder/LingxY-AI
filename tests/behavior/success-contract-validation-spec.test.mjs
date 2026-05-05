import assert from "node:assert/strict";
import test from "node:test";

import {
  selectSuccessContractValidationSpec,
  validateAnswerSynthesis
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
