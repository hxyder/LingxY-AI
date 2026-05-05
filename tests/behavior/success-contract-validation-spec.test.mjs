import assert from "node:assert/strict";
import test from "node:test";

import {
  selectSuccessContractValidationSpec
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
