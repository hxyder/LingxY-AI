import test from "node:test";
import assert from "node:assert/strict";

import {
  createSemanticRouter,
  SEMANTIC_DECISION_TOOL,
  TOOL_CAPABILITIES
} from "../../src/service/core/intent/semantic-router.mjs";

const baseDecision = Object.freeze({
  source_scope: "none",
  web_policy: "forbidden",
  output_kind: "conversation",
  artifact_required: false,
  executor: "tool_using",
  research_depth: "single_lookup",
  file_read_depth: "shallow",
  primary_intent: "automation",
  domain: "general",
  user_goal: "Create a new skill capability for the user.",
  expected_output: "execution",
  needs_external_info: false,
  needs_current_information: false,
  needs_user_files: false,
  needs_tool_use: true,
  needed_capabilities: ["capability_management"],
  required_policy_groups: [],
  source_mode: "no_external",
  complexity: "low",
  risk_level: "low",
  confidence: 0.9,
  rationale_summary: "User wants to draft and save a capability.",
  reason: "Capability creation request."
});

test("semantic router enum lists capability_management as a tool capability", () => {
  assert.ok(TOOL_CAPABILITIES.includes("capability_management"));
});

test("semantic decision tool schema accepts capability_management", () => {
  const enumValues = SEMANTIC_DECISION_TOOL.input_schema.properties.needed_capabilities.items.enum;
  assert.ok(enumValues.includes("capability_management"));
});

function decisionAdapter(decision) {
  return {
    async generate() {
      return { tool_calls: [{ name: "route_task", arguments: decision }] };
    }
  };
}

test("semantic router accepts capability_management in needed_capabilities", async () => {
  const router = createSemanticRouter({ adapter: decisionAdapter({ ...baseDecision }) });
  const result = await router.resolveSemanticDecision({ text: "Create a new capability." });
  assert.equal(result.kind, "decision", result.reason);
  assert.deepEqual(result.decision.needed_capabilities, ["capability_management"]);
});

test("semantic router still rejects unknown capability values", async () => {
  const router = createSemanticRouter({
    adapter: decisionAdapter({
      ...baseDecision,
      needed_capabilities: ["capability_management", "make_up_capability"]
    })
  });
  const result = await router.resolveSemanticDecision({ text: "Create a new capability." });
  assert.equal(result.kind, "rejection");
  assert.equal(result.code, "schema_invalid");
  assert.match(result.reason, /needed_capabilities includes invalid capability/);
});
