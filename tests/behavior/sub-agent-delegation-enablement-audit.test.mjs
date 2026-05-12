import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSubAgentDelegationEnablementAudit,
  SUB_AGENT_DELEGATION_ENABLEMENT_CLASSES,
  SUB_AGENT_DELEGATION_REQUIRED_GATES
} from "../../src/service/core/evals/sub-agent-delegation-enablement-audit.mjs";

test("sub-agent delegation enablement audit keeps automatic delegation disabled by default", () => {
  const audit = buildSubAgentDelegationEnablementAudit();
  assert.equal(audit.runtimeDefault, "disabled");
  assert.equal(audit.plannerSelectedOnly, true);
  assert.equal(audit.automaticDelegationEnabled, false);
  assert.ok(audit.requiredGates.includes("feature_flag_enabled"));
  assert.ok(audit.classes.every((entry) => entry.missing.includes("feature_flag_enabled")));
});

test("sub-agent delegation enablement audit names only eval-proven positive classes", () => {
  const audit = buildSubAgentDelegationEnablementAudit({ featureFlagEnabled: true });
  assert.deepEqual(
    audit.classes.map((entry) => entry.category).sort(),
    Object.keys(SUB_AGENT_DELEGATION_ENABLEMENT_CLASSES).sort()
  );
  assert.ok(audit.forbiddenCategories.includes("do_not_delegate_high_risk_mutation"));
  assert.ok(audit.forbiddenCategories.includes("do_not_delegate_private_context"));
  assert.ok(audit.classes.every((entry) => entry.enablement === "eligible_with_flag"));
});

test("sub-agent delegation enablement audit blocks classes when trace visibility is absent", () => {
  const audit = buildSubAgentDelegationEnablementAudit({
    featureFlagEnabled: true,
    traceVisible: false
  });
  assert.ok(SUB_AGENT_DELEGATION_REQUIRED_GATES.includes("trace_report_visible"));
  assert.ok(audit.classes.every((entry) => entry.missing.includes("trace_report_visible")));
  assert.equal(audit.automaticDelegationEnabled, false);
});
