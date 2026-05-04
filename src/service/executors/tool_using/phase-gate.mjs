import { validateStepGate } from "../../core/policy/success-contract-validator.mjs";
import { suggestRunbookForStepGate } from "../../core/runtime/runbook-engine.mjs";
import {
  buildRequiredActionGuidance,
  shouldInjectRequiredActionGuidance
} from "./action-guidance.mjs";
import {
  DEFAULT_LOCAL_FILE_READ_GUIDANCE_LIMITS,
  planLocalFileTextReadGuidance as planSharedLocalFileTextReadGuidance
} from "../shared/local-file-read-guidance.mjs";

export const DEFAULT_PHASE_GATE_GUIDANCE_LIMITS = Object.freeze({
  maxContractActionGuidance: 2,
  maxTerminalContractActionGuidance: 1
});

export function evaluatePhaseGate({ task, transcript, iteration, maxIterations }) {
  const stepGateSpec = task.task_spec ?? task.task_spec_initial;
  return validateStepGate(stepGateSpec, transcript, {
    iteration,
    maxIterations
  });
}

export function phaseGateSignalPayload({ iteration, stepGate }) {
  return {
    iteration,
    next_action: stepGate.next_action,
    violation_kinds: (stepGate.violations ?? []).map((v) => v.kind),
    satisfied: stepGate.satisfied
  };
}

export function phaseGateAuditPayload({ iteration, stepGate }) {
  return {
    iteration,
    next_action: stepGate.next_action,
    satisfied: stepGate.satisfied,
    violation_count: (stepGate.violations ?? []).length
  };
}

export function planContractActionHandoff({
  stepGate,
  transcript,
  iteration,
  maxIterations,
  contractActionGuidanceCount,
  terminalContractActionGuidanceCount,
  limits = DEFAULT_PHASE_GATE_GUIDANCE_LIMITS
}) {
  const actionGroups = shouldInjectRequiredActionGuidance(stepGate, transcript, { allowTerminal: true });
  const terminalActionOnly = ["escalate", "abort"].includes(stepGate.next_action);
  const canInjectNormalActionGuidance = contractActionGuidanceCount < limits.maxContractActionGuidance;
  const actionOnlyHandoff = terminalActionOnly || !canInjectNormalActionGuidance;
  const canInjectTerminalActionGuidance = actionOnlyHandoff
    && terminalContractActionGuidanceCount < limits.maxTerminalContractActionGuidance;
  const canInject = (canInjectNormalActionGuidance || canInjectTerminalActionGuidance)
    && actionGroups.length > 0
    && iteration < maxIterations - 1;

  if (!canInject) return null;

  return {
    actionGroups,
    actionOnlyHandoff,
    incrementNormal: !actionOnlyHandoff,
    incrementTerminal: actionOnlyHandoff,
    transcriptEntry: {
      type: "contract_guidance",
      groups: actionGroups,
      instruction: buildRequiredActionGuidance(actionGroups, { actionOnly: actionOnlyHandoff }),
      action_only: actionOnlyHandoff
    },
    eventPayload: {
      iteration,
      required_policy_groups: actionGroups,
      action_only: actionOnlyHandoff
    }
  };
}

export function planLocalFileTextReadGuidance({
  stepGate,
  transcript,
  taskSpec,
  iteration,
  maxIterations,
  localFileReadGuidanceCount,
  limits = DEFAULT_LOCAL_FILE_READ_GUIDANCE_LIMITS
}) {
  return planSharedLocalFileTextReadGuidance({
    stepGate,
    transcript,
    taskSpec,
    iteration,
    maxIterations,
    guidanceCount: localFileReadGuidanceCount,
    limits
  });
}

export function planRunbookGuidance({ stepGate, firedRunbooks, iteration, maxIterations }) {
  const runbook = suggestRunbookForStepGate(stepGate);
  if (!runbook || firedRunbooks?.has(runbook.id) || iteration >= maxIterations - 1) {
    return { runbook, transcriptEntry: null, eventPayload: null };
  }

  const instruction = runbook.steps
    .map((step, index) => `${index + 1}. ${step.description}`)
    .join("\n");

  return {
    runbook,
    transcriptEntry: {
      type: "runbook_guidance",
      runbook_id: runbook.id,
      instruction: `${instruction}\n\nExecute the recovery with a different tool call or different arguments now. Do not repeat a failed identical tool+args pair.`
    },
    eventPayload: {
      iteration,
      runbook_id: runbook.id,
      terminal_action: runbook.terminal_action
    }
  };
}

export function buildPhaseGateStop({ stepGate, iteration, runbook }) {
  if (stepGate.next_action !== "abort" && stepGate.next_action !== "escalate") return null;

  const violationSummary = (stepGate.violations ?? [])
    .map((v) => v.kind)
    .filter(Boolean)
    .join(", ");
  const reasonText = stepGate.next_action === "abort"
    ? `Phase gate aborted at iteration ${iteration}: ${violationSummary || "iteration ceiling reached without satisfying contract"}`
    : `Phase gate escalated at iteration ${iteration}: ${violationSummary || "no specific violation"}`;

  return {
    reasonText,
    phaseGate: {
      next_action: stepGate.next_action,
      iteration,
      violations: stepGate.violations ?? [],
      runbook_suggested: runbook?.id ?? null
    }
  };
}
