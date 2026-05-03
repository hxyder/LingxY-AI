import assert from "node:assert/strict";
import test from "node:test";

import { runConnectorWorkflow } from "../../src/service/connectors/core/workflow-dispatcher.mjs";
import { buildScheduledSideEffectAuthorization } from "../../src/service/scheduler/execute-action.mjs";

function makeScheduledTask({ authorized = true } = {}) {
  return {
    task_id: "task_scheduled_workflow_authorization",
    context_packet: {
      selection_metadata: {
        scheduled_task_fire: true,
        side_effect_contract: {
          version: 1,
          kind: "side_effect_contract",
          groups: {
            email_send: {
              slots: {
                to: {
                  entity: "email_address",
                  values: ["ops@example.com"],
                  mode: "preserve"
                }
              }
            }
          }
        },
        ...(authorized
          ? {
              side_effect_authorization: {
                kind: "scheduled_fire",
                decision: "preauthorized",
                source: "schedule_definition",
                schedule_id: "sched_email",
                groups: ["email_send"]
              }
            }
          : {})
      }
    }
  };
}

function makeRuntime({ toolResult = { success: true, observation: "sent", metadata: {} } } = {}) {
  const calls = [];
  const approvals = [];
  const events = [];
  return {
    calls,
    approvals,
    events,
    actionToolRegistry: {
      get: () => ({
        id: "account_send_email",
        risk_level: "high",
        requires_confirmation: true
      }),
      async call(_toolId, args) {
        calls.push(args);
        return toolResult;
      }
    },
    connectorCatalog: {
      getWorkflow(id) {
        return {
          id,
          provider: "google",
          service: "google.gmail",
          name: "Gmail Draft Confirm Send",
          steps: [
            { id: "prepare_draft", tool: "google.gmail.create_draft_preview", output: "draft" },
            { id: "request_confirmation", type: "user.confirm", requires: ["draft.subject", "draft.body"] },
            { id: "send_email", tool: "google.gmail.send_email", condition: "confirmation.approved" }
          ]
        };
      },
      getTool(id) {
        if (id === "google.gmail.create_draft_preview") {
          return {
            id,
            name: "Gmail draft preview",
            execution: { kind: "local_preview" },
            requiresConfirmation: false
          };
        }
        return {
          id,
          name: "Gmail send email",
          execution: {
            actionTool: "account_send_email",
            provider: "google"
          },
          risk: "high",
          requiresConfirmation: true
        };
      },
      validateOutput() {
        return { ok: true, failures: [] };
      }
    },
    pendingApprovals: {
      create(payload) {
        const approval = { approval_id: `appr_${approvals.length + 1}`, ...payload };
        approvals.push(approval);
        return approval;
      }
    }
  };
}

test("scheduled connector workflow authorization skips per-fire confirmation and sends", async () => {
  const runtime = makeRuntime();

  const result = await runConnectorWorkflow({
    runtime,
    workflowId: "google.gmail.draft_confirm_send",
    input: {
      to: ["ops@example.com"],
      subject: "Scheduled report",
      body: "Body"
    },
    state: {},
    task: makeScheduledTask(),
    emitTaskEvent(eventType, payload) {
      runtime.events.push({ eventType, payload });
    }
  });

  assert.equal(result.status, "success");
  assert.equal(runtime.calls.length, 1);
  assert.equal(runtime.approvals.length, 0);
  assert.ok(runtime.events.some((event) =>
    event.eventType === "side_effect_authorization_applied"
    && event.payload?.workflow_id === "google.gmail.draft_confirm_send"
    && event.payload?.group === "email_send"
  ));
});

test("connector workflow still asks for confirmation without scheduled authorization", async () => {
  const runtime = makeRuntime();

  const result = await runConnectorWorkflow({
    runtime,
    workflowId: "google.gmail.draft_confirm_send",
    input: {
      to: ["ops@example.com"],
      subject: "Scheduled report",
      body: "Body"
    },
    state: {},
    task: makeScheduledTask({ authorized: false })
  });

  assert.equal(result.status, "waiting_external_decision");
  assert.equal(runtime.calls.length, 0);
  assert.equal(runtime.approvals.length, 1);
});

test("schedule dispatch authorization is keyed to the saved schedule, not the trigger surface", () => {
  const auth = buildScheduledSideEffectAuthorization({
    scheduleContext: {
      schedule_id: "sched_manual_email",
      execution_mode: "unattended_safe"
    },
    sideEffectContract: {
      version: 1,
      kind: "side_effect_contract",
      groups: {
        email_send: {
          slots: {
            to: {
              entity: "email_address",
              values: ["ops@example.com"],
              mode: "preserve"
            }
          }
        }
      }
    }
  });

  assert.equal(auth?.decision, "preauthorized");
  assert.equal(auth?.source, "schedule_definition");
  assert.deepEqual(auth?.groups, ["email_send"]);

  const blocked = buildScheduledSideEffectAuthorization({
    scheduleContext: {
      schedule_id: "sched_manual_email",
      execution_mode: "approval_required"
    },
    sideEffectContract: {
      groups: { email_send: {} }
    }
  });
  assert.equal(blocked, null, "approval_required schedules still require approval");
});
