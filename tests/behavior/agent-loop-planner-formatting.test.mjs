import test from "node:test";
import assert from "node:assert/strict";

import {
  buildHistoryString,
  formatWorkflowsForPlanner,
  formatToolForPlanner,
  plannerToolDescriptorForAdapter
} from "../../src/service/executors/tool_using/planner-formatting.mjs";

test("agent planner formatting renders tool capability and policy metadata", () => {
  const rendered = formatToolForPlanner({
    id: "account_send_email",
    description: "Send an email",
    parameters: {
      properties: {
        to: { type: "string" },
        subject: { type: "string" },
        priority: { enum: ["low", "normal", "high"] }
      }
    },
    policy_group: "external_write",
    risk_level: "high",
    requires_confirmation: true,
    required_capabilities: ["email_send"]
  });

  assert.match(rendered, /^- account_send_email: Send an email/);
  assert.match(rendered, /args=\{ to:string, subject:string, priority:enum:low\|normal\|high \}/);
  assert.match(rendered, /group=external_write/);
  assert.match(rendered, /risk=high/);
  assert.match(rendered, /confirmation=required/);
  assert.match(rendered, /capabilities=email_send/);
});

test("agent planner formatting keeps transcript history readable for planner turns", () => {
  const history = buildHistoryString([
    {
      type: "tool_result",
      tool: "web_search_fetch",
      observation: "found sources"
    },
    {
      type: "tool_denied",
      tool: "open_file",
      reason: "not allowed"
    },
    {
      type: "validation_error",
      tool: "send_email",
      error: "missing to"
    }
  ]);

  assert.match(history, /\[step 1\] called web_search_fetch/);
  assert.match(history, /\[step 2\] denied open_file: not allowed/);
  assert.match(history, /\[step 3\] validation error on send_email: missing to/);
});

test("agent planner formatting renders connector workflow hints", () => {
  const catalog = {
    listWorkflows() {
      return [{ id: "google.gmail.draft_confirm_send" }];
    },
    getWorkflow(id) {
      return {
        id,
        description: "Draft and confirm a Gmail message",
        triggerPatterns: [/gmail/i, /send mail/i],
        steps: [{ tool: "google.gmail.draft" }]
      };
    },
    getTool(id) {
      assert.equal(id, "google.gmail.draft");
      return {
        inputSchema: {
          required: ["to", "subject", "body"]
        }
      };
    }
  };

  const rendered = formatWorkflowsForPlanner(catalog);

  assert.match(rendered, /Connector workflows/);
  assert.match(rendered, /google\.gmail\.draft_confirm_send/);
  assert.match(rendered, /required input: \{ to, subject, body \}/);
  assert.match(rendered, /Never call connector_workflow_run with empty subject\/body/);
});

test("agent planner tool descriptor exposes the single call_tool adapter schema", () => {
  const descriptor = plannerToolDescriptorForAdapter();

  assert.equal(descriptor.name, "call_tool");
  assert.deepEqual(descriptor.input_schema.required, ["tool", "args"]);
  assert.equal(descriptor.input_schema.properties.tool.type, "string");
  assert.equal(descriptor.input_schema.properties.args.type, "object");
});
