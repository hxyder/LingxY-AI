import { chargeBudget, snapshotBudget } from "../../core/runtime/error-budget.mjs";
import { groupsOfTool } from "../../core/policy/policy-groups.mjs";
import { toolResultHasSubstance } from "./tool-call-guards.mjs";

export function classifyToolLoopBudgetEvent({ tool, result, isDefaultPlanner = false }) {
  if (isDefaultPlanner) return null;
  if (result?.success === false) return "tool_failure";
  if (groupsOfTool(tool.id).includes("external_web_read") && !toolResultHasSubstance(result)) {
    return "empty_search_result";
  }
  return null;
}

export function chargeToolLoopErrorBudget({ errorBudget, tool, result, isDefaultPlanner = false }) {
  const event = classifyToolLoopBudgetEvent({ tool, result, isDefaultPlanner });
  if (!event) {
    return {
      event: null,
      charge: null,
      nextBudget: errorBudget
    };
  }

  const charge = chargeBudget(errorBudget, event);
  return {
    event,
    charge,
    nextBudget: charge.state
  };
}

export function errorBudgetChargeAuditPayload({ iteration, event, charge }) {
  return {
    iteration,
    event,
    exhausted: charge.exhausted,
    snapshot: snapshotBudget(charge.state)
  };
}

export function errorBudgetSignalPayload({ iteration, event, charge }) {
  return {
    iteration,
    event,
    reason: charge.reason,
    snapshot: snapshotBudget(charge.state)
  };
}

export function errorBudgetResultPayload({ iteration, event, charge }) {
  return {
    event,
    reason: charge.reason,
    iteration,
    snapshot: snapshotBudget(charge.state)
  };
}
