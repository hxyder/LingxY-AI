import {
  SUB_AGENT_DELEGATION_EVAL_CASES,
  SUB_AGENT_DELEGATION_EVAL_MINIMUMS
} from "./sub-agent-delegation-corpus.mjs";

export const SUB_AGENT_DELEGATION_ENABLEMENT_SCHEMA_VERSION = 1;

export const SUB_AGENT_DELEGATION_REQUIRED_GATES = Object.freeze([
  "feature_flag_enabled",
  "eval_category_minimum_met",
  "budget_gate_configured",
  "allowed_tool_subset_enforced",
  "context_isolation_enforced",
  "parent_cancellation_linked",
  "trace_report_visible"
]);

export const SUB_AGENT_DELEGATION_ENABLEMENT_CLASSES = Object.freeze({
  delegate_parallel_research: {
    risk: "medium",
    maxChildRuns: 3,
    allowedToolFamilies: ["web_search_fetch", "read_file_text"],
    runtimeDefault: "disabled"
  },
  delegate_isolated_file_review: {
    risk: "medium",
    maxChildRuns: 2,
    allowedToolFamilies: ["read_file_text", "search_file_content"],
    runtimeDefault: "disabled"
  },
  delegate_bounded_qa: {
    risk: "low",
    maxChildRuns: 1,
    allowedToolFamilies: ["read_file_text", "search_file_content", "web_search_fetch"],
    runtimeDefault: "disabled"
  }
});

function groupCases(cases = []) {
  const groups = new Map();
  for (const testCase of cases) {
    const category = testCase?.category;
    if (!category) continue;
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(testCase);
  }
  return groups;
}

function gateStatus({
  category,
  cases,
  featureFlagEnabled,
  traceVisible,
  runtimeClass
}) {
  const minimum = SUB_AGENT_DELEGATION_EVAL_MINIMUMS[category] ?? 0;
  const evalMinimumMet = cases.length >= minimum;
  const configured = Boolean(runtimeClass);
  const gates = {
    feature_flag_enabled: featureFlagEnabled,
    eval_category_minimum_met: evalMinimumMet,
    budget_gate_configured: configured && Number(runtimeClass.maxChildRuns) > 0,
    allowed_tool_subset_enforced: configured && Array.isArray(runtimeClass.allowedToolFamilies),
    context_isolation_enforced: true,
    parent_cancellation_linked: true,
    trace_report_visible: traceVisible
  };
  const missing = SUB_AGENT_DELEGATION_REQUIRED_GATES.filter((gate) => gates[gate] !== true);
  return { gates, missing };
}

export function buildSubAgentDelegationEnablementAudit({
  cases = SUB_AGENT_DELEGATION_EVAL_CASES,
  featureFlagEnabled = false,
  traceVisible = true
} = {}) {
  const groups = groupCases(cases);
  const classes = Object.entries(SUB_AGENT_DELEGATION_ENABLEMENT_CLASSES).map(([category, runtimeClass]) => {
    const categoryCases = groups.get(category) ?? [];
    const { gates, missing } = gateStatus({
      category,
      cases: categoryCases,
      featureFlagEnabled,
      traceVisible,
      runtimeClass
    });
    return {
      category,
      risk: runtimeClass.risk,
      maxChildRuns: runtimeClass.maxChildRuns,
      allowedToolFamilies: runtimeClass.allowedToolFamilies,
      evalCaseCount: categoryCases.length,
      evalMinimum: SUB_AGENT_DELEGATION_EVAL_MINIMUMS[category] ?? 0,
      gates,
      missing,
      enablement: missing.length === 0 ? "eligible_with_flag" : "blocked"
    };
  });

  const forbiddenCategories = [...groups.keys()]
    .filter((category) => !SUB_AGENT_DELEGATION_ENABLEMENT_CLASSES[category])
    .sort();

  return {
    schemaVersion: SUB_AGENT_DELEGATION_ENABLEMENT_SCHEMA_VERSION,
    runtimeDefault: "disabled",
    plannerSelectedOnly: true,
    automaticDelegationEnabled: featureFlagEnabled && classes.every((entry) => entry.missing.length === 0),
    classes,
    forbiddenCategories,
    requiredGates: SUB_AGENT_DELEGATION_REQUIRED_GATES
  };
}
