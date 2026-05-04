import { validateStepGate } from "../../core/policy/success-contract-validator.mjs";
import { groupsOfTool } from "../../core/policy/policy-groups.mjs";
import { suggestRunbookForStepGate } from "../../core/runtime/runbook-engine.mjs";
import { chargeBudget, snapshotBudget } from "../../core/runtime/error-budget.mjs";
import {
  agenticToolResultHasSubstance,
  transcriptForValidator
} from "./validator-transcript.mjs";
import { planLocalFileTextReadGuidance } from "../shared/local-file-read-guidance.mjs";

/**
 * Per-tool control helper used by both the agentic preflight call and the
 * main loop's tool calls. The planner owns control flow; this module owns the
 * local policy result for "we just got a tool result, should the loop continue?"
 */
export function processAgenticToolResultForControls(ctx) {
  const { call, result, transcript, iteration, maxIterations, taskSpec, onEvent, preflight } = ctx;
  let errorBudget = ctx.errorBudget;

  let budgetEvent = null;
  if (result.success === false) {
    budgetEvent = "tool_failure";
  } else if (groupsOfTool(call.name).includes("external_web_read")
      && !agenticToolResultHasSubstance(result)) {
    budgetEvent = "empty_search_result";
  }
  if (budgetEvent) {
    const charge = chargeBudget(errorBudget, budgetEvent);
    errorBudget = charge.state;
    onEvent?.({
      event_type: "log",
      payload: {
        message: `error_budget_charge ${budgetEvent} (exhausted=${charge.exhausted}${preflight ? ", preflight" : ""})`
      }
    });
    if (charge.exhausted) {
      onEvent?.({
        event_type: "error_budget_signal",
        payload: {
          iteration,
          preflight: Boolean(preflight),
          event: budgetEvent,
          reason: charge.reason,
          snapshot: snapshotBudget(errorBudget)
        }
      });
      return {
        errorBudget,
        earlyExit: {
          kind: "error_budget_exhausted",
          error_budget: {
            event: budgetEvent,
            reason: charge.reason,
            iteration,
            preflight: Boolean(preflight),
            snapshot: snapshotBudget(errorBudget)
          }
        }
      };
    }
  }

  const validatorTx = transcriptForValidator(transcript);
  const stepGate = validateStepGate(taskSpec, validatorTx, {
    iteration,
    maxIterations
  });
  const runbook = suggestRunbookForStepGate(stepGate);
  const localFileReadGuidance = planLocalFileTextReadGuidance({
    stepGate,
    transcript: validatorTx,
    taskSpec,
    iteration,
    maxIterations,
    guidanceCount: ctx.localFileReadGuidanceCount ?? 0
  });
  onEvent?.({
    event_type: "phase_gate_signal",
    payload: {
      iteration,
      preflight: Boolean(preflight),
      next_action: stepGate.next_action,
      satisfied: stepGate.satisfied,
      violation_kinds: (stepGate.violations ?? []).map((v) => v.kind),
      runbook_suggested: runbook?.id ?? null
    }
  });
  if (stepGate.next_action === "abort" || stepGate.next_action === "escalate") {
    return {
      errorBudget,
      earlyExit: {
        kind: `phase_gate_${stepGate.next_action}`,
        phase_gate: {
          next_action: stepGate.next_action,
          iteration,
          preflight: Boolean(preflight),
          violations: stepGate.violations ?? [],
          runbook_suggested: runbook?.id ?? null
        }
      }
    };
  }

  return { errorBudget, earlyExit: null, localFileReadGuidance };
}
