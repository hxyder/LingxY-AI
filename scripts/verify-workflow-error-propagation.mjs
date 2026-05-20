// UCA-181 follow-up: workflow-dispatcher must surface the action tool's
// real error text instead of swallowing it into a generic "Connector
// workflow tool failed." string. Repro: user approved a Google Calendar
// create_event workflow; the API returned 401, but the user saw "Task
// failed: Unknown error." because:
//
//   - executeConnectorTool returned `{status:"failed"}` with no `error`
//     field.
//   - workflow-runner's fallback `result.error ?? "Connector workflow
//     tool failed."` therefore lost the real message.
//   - the failure classifier's `internal_error` path then prefixed
//     "发生未分类内部错误" but the overlay still defaulted to "Unknown
//     error." for tasks where the classifier didn't run.
//
// This verifier locks in the fix by replaying executeConnectorTool's
// shape: a failing tool result must populate `error` with the
// observation / metadata.message / metadata.errorCode, in that order.

import assert from "node:assert/strict";

import { runConnectorWorkflow } from "../src/service/capabilities/connectors/core/workflow-dispatcher.mjs";

let pass = 0;
let fail = 0;
function check(label, condition) {
  if (condition) { pass += 1; console.log(`PASS  ${label}`); }
  else { fail += 1; console.log(`FAIL  ${label}`); }
}

function makeRuntime({ toolResult, validation = { ok: true, failures: [] } }) {
  return {
    actionToolRegistry: {
      get: () => ({
        id: "account_create_event",
        risk_level: "high",
        requires_confirmation: false,
        execute: async () => toolResult
      }),
      call: async () => toolResult
    },
    connectorCatalog: {
      getWorkflow(id) {
        return {
          id,
          provider: "google",
          service: "google.calendar",
          name: "Test Calendar Workflow",
          steps: [
            {
              id: "create_event",
              tool: "google.calendar.create_event"
            }
          ]
        };
      },
      getTool(id) {
        return {
          id,
          execution: {
            actionTool: "account_create_event",
            provider: "google"
          },
          name: id,
          risk: "high",
          requiresConfirmation: false
        };
      },
      validateOutput(toolId, output, context) {
        if (typeof validation === "function") {
          return validation(toolId, output, context);
        }
        return validation;
      }
    },
    pendingApprovals: {
      create: () => ({ approval_id: "appr_test" })
    }
  };
}

// ---------------------------------------------------------------------
// 0. Recurring calendar creation must not silently degrade to a single
//    one-off event. If workflow input includes recurrence, the connector
//    output validation receives that input and can reject outputs that
//    did not preserve recurring-event evidence.
// ---------------------------------------------------------------------
{
  let sawRecurringInput = false;
  const runtime = makeRuntime({
    toolResult: {
      success: true,
      observation: "Event created.",
      metadata: {
        tool_id: "account_create_event",
        connector_status: "success",
        event: { id: "event-single" }
      }
    },
    validation: (_toolId, output, context = {}) => {
      sawRecurringInput = Array.isArray(context.input?.recurrence);
      return sawRecurringInput && !output?.event?.recurrence
        ? {
            ok: false,
            failures: [{
              path: "event.recurrence",
              message: "recurrence must be preserved when requested"
            }]
          }
        : { ok: true, failures: [] };
    }
  });

  const result = await runConnectorWorkflow({
    runtime,
    workflowId: "google.calendar.create_confirm",
    input: {
      title: "Lunch",
      startTime: "2026-05-18T09:00:00-04:00",
      endTime: "2026-05-18T09:30:00-04:00",
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;UNTIL=20260630T235959Z"]
    },
    state: { confirmation: { approved: true } }
  });

  check("recurrence-fidelity: validation receives recurring workflow input", sawRecurringInput === true);
  check("recurrence-fidelity: missing recurrence evidence fails the workflow", result.status === "failed");
  check("recurrence-fidelity: error names recurrence preservation",
    typeof result.error === "string" && /recurrence/.test(result.error));
}

// ---------------------------------------------------------------------
// 1. Tool returns success:false with observation → workflow result
//    surfaces the observation as `error` (not the generic fallback).
// ---------------------------------------------------------------------
{
  const runtime = makeRuntime({
    toolResult: {
      success: false,
      observation: "Google Calendar API 返回 401：invalid_grant",
      metadata: { tool_id: "account_create_event" }
    }
  });

  const result = await runConnectorWorkflow({
    runtime,
    workflowId: "google.calendar.create_confirm",
    input: { title: "Lunch", startTime: "2026-04-30T15:00:00", endTime: "2026-04-30T15:30:00" },
    state: { confirmation: { approved: true } }
  });

  check("api-error: workflow status is failed", result.status === "failed");
  check("api-error: workflow.error contains the actual API message",
    typeof result.error === "string" && /invalid_grant/.test(result.error));
  check("api-error: error is NOT the generic fallback",
    result.error !== "Connector workflow tool failed.");
}

// ---------------------------------------------------------------------
// 1b. Tool returns success:false and the connector output contract also
//     fails validation → workflow still surfaces the tool-layer follow-up
//     reason. This matches reauth_required / account_selection_required:
//     those are user-action failures, not schema bugs.
// ---------------------------------------------------------------------
{
  const runtime = makeRuntime({
    toolResult: {
      success: false,
      observation: "account_send_email requires follow-up: reauth_required",
      metadata: { tool_id: "account_send_email", connector_status: "reauth_required" }
    },
    validation: {
      ok: false,
      failures: [{ path: "sent", message: "sent must be true" }]
    }
  });

  const result = await runConnectorWorkflow({
    runtime,
    workflowId: "google.calendar.create_confirm",
    input: { title: "Test", startTime: "2026-04-30T15:00:00", endTime: "2026-04-30T15:30:00" },
    state: { confirmation: { approved: true } }
  });

  check("tool-failure-validation: surfaces reauth_required",
    typeof result.error === "string" && /reauth_required/.test(result.error));
  check("tool-failure-validation: does NOT replace follow-up with output validation",
    !/输出校验失败|validation/i.test(result.error));
}

// ---------------------------------------------------------------------
// 2. Tool returns success:false with no observation but metadata.message
//    → workflow uses metadata.message as fallback.
// ---------------------------------------------------------------------
{
  const runtime = makeRuntime({
    toolResult: {
      success: false,
      observation: "",
      metadata: { tool_id: "account_create_event", message: "ACCOUNT_NOT_FOUND" }
    }
  });

  const result = await runConnectorWorkflow({
    runtime,
    workflowId: "google.calendar.create_confirm",
    input: { title: "Test", startTime: "2026-04-30T15:00:00", endTime: "2026-04-30T15:30:00" },
    state: { confirmation: { approved: true } }
  });

  check("metadata-message: error falls back to metadata.message",
    typeof result.error === "string" && /ACCOUNT_NOT_FOUND/.test(result.error));
}

// ---------------------------------------------------------------------
// 3. Validation failure (output schema mismatch) → workflow surfaces a
//    structured validation message instead of an empty error.
// ---------------------------------------------------------------------
{
  const runtime = makeRuntime({
    toolResult: {
      success: true,
      observation: "API returned 200 but body shape is unexpected.",
      metadata: { tool_id: "account_create_event" }
    },
    validation: {
      ok: false,
      failures: [{ path: "event.id", message: "missing required field" }]
    }
  });

  const result = await runConnectorWorkflow({
    runtime,
    workflowId: "google.calendar.create_confirm",
    input: { title: "Test", startTime: "2026-04-30T15:00:00", endTime: "2026-04-30T15:30:00" },
    state: { confirmation: { approved: true } }
  });

  check("validation: workflow status is failed when output validation fails",
    result.status === "failed");
  check("validation: error names the failed field",
    typeof result.error === "string" && /event\.id/.test(result.error));
  check("validation: error mentions output validation",
    /输出校验失败|validation/i.test(result.error));
}

// ---------------------------------------------------------------------
// 4. Successful tool + validation → workflow returns success, no error.
// ---------------------------------------------------------------------
{
  const runtime = makeRuntime({
    toolResult: {
      success: true,
      observation: "Event created.",
      metadata: { tool_id: "account_create_event", connector_status: "success" }
    },
    validation: { ok: true, failures: [] }
  });

  const result = await runConnectorWorkflow({
    runtime,
    workflowId: "google.calendar.create_confirm",
    input: { title: "Test", startTime: "2026-04-30T15:00:00", endTime: "2026-04-30T15:30:00" },
    state: { confirmation: { approved: true } }
  });

  check("success: workflow returns success", result.status === "success");
}

console.log(`\n${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
