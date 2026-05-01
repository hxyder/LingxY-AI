import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRequiredActionGuidance,
  filterToolsForActionOnlyGuidance,
  shouldInjectRequiredActionGuidance
} from "../../src/service/executors/tool_using/action-guidance.mjs";

test("agent action guidance extracts missing required policy groups from step gate violations", () => {
  const groups = shouldInjectRequiredActionGuidance({
    next_action: "continue",
    satisfied: false,
    violations: [
      { kind: "email_send_required_not_called" },
      { kind: "calendar_create_required_not_called" },
      { kind: "tool_repeated_failure" },
      { kind: "email_send_required_not_called" }
    ]
  });

  assert.deepEqual(groups.sort(), ["calendar_create", "email_send"]);
});

test("agent action guidance only injects terminal guidance when explicitly allowed", () => {
  const gate = {
    next_action: "abort",
    satisfied: false,
    violations: [
      { kind: "file_upload_required_not_called" }
    ]
  };

  assert.deepEqual(shouldInjectRequiredActionGuidance(gate), []);
  assert.deepEqual(
    shouldInjectRequiredActionGuidance(gate, [], { allowTerminal: true }),
    ["file_upload"]
  );
});

test("agent action-only guidance restricts visible tools to tools satisfying pending groups", () => {
  const tools = [
    { id: "web_search_fetch" },
    { id: "account_send_email" },
    { id: "connector_workflow_run" },
    { id: "launch_app" }
  ];
  const transcript = [
    {
      type: "contract_guidance",
      action_only: true,
      groups: ["email_send"]
    }
  ];

  assert.deepEqual(
    filterToolsForActionOnlyGuidance(tools, transcript).map((tool) => tool.id).sort(),
    ["account_send_email", "connector_workflow_run"].sort()
  );
});

test("agent action-only guidance includes the handoff instruction when requested", () => {
  const guidance = buildRequiredActionGuidance(["email_send"], { actionOnly: true });

  assert.match(guidance, /email_send/);
  assert.match(guidance, /Action-only handoff/);
  assert.match(guidance, /Do not call web_search/);
});
