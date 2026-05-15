import {
  selectSuccessContractValidationSpec,
  validateStepGate
} from "../../core/policy/success-contract-validator.mjs";
import { ACTION_OBLIGATION_GROUPS } from "../../core/policy/obligation-evaluator.mjs";
import { toolsInGroup } from "../../core/policy/policy-groups.mjs";
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
  maxTerminalContractActionGuidance: 1,
  maxRequiredPolicyGuidance: 2
});

const ACTION_GROUP_SET = new Set(ACTION_OBLIGATION_GROUPS);
const REQUIRED_POLICY_GROUP_VIOLATION_RE = /^(.+)_required_(?:not_called|all_failed|returned_empty)$/;

export function evaluatePhaseGate({ task, transcript, iteration, maxIterations }) {
  const stepGateSpec = selectSuccessContractValidationSpec(task);
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
  forceActionOnlyGroups = [],
  limits = DEFAULT_PHASE_GATE_GUIDANCE_LIMITS
}) {
  // Action handoff is terminal by design: once we tell the planner to
  // stop exploring and perform a side effect, the remaining transcript
  // becomes the action body. Do not enter that mode while a non-action
  // contract, such as external_web_read or local_file_text_read, is still
  // unsatisfied.
  if (missingNonActionRequiredPolicyGroups(stepGate).length > 0) {
    return null;
  }
  const actionGroups = shouldInjectRequiredActionGuidance(stepGate, transcript, { allowTerminal: true });
  const forcedActionOnlySet = new Set(
    Array.isArray(forceActionOnlyGroups) ? forceActionOnlyGroups.filter(Boolean) : []
  );
  const forcedActionOnly = actionGroups.length > 0
    && actionGroups.every((group) => forcedActionOnlySet.has(group));
  const terminalActionOnly = ["escalate", "abort"].includes(stepGate.next_action);
  const canInjectNormalActionGuidance = contractActionGuidanceCount < limits.maxContractActionGuidance;
  const actionOnlyHandoff = forcedActionOnly || terminalActionOnly || !canInjectNormalActionGuidance;
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

function missingNonActionRequiredPolicyGroups(stepGate) {
  const groups = [];
  for (const violation of stepGate?.violations ?? []) {
    const match = REQUIRED_POLICY_GROUP_VIOLATION_RE.exec(String(violation?.kind ?? ""));
    if (!match) continue;
    const group = match[1];
    if (ACTION_GROUP_SET.has(group)) continue;
    groups.push(group);
  }
  return [...new Set(groups)];
}

export function planRequiredPolicyGroupGuidance({
  stepGate,
  iteration,
  maxIterations,
  requiredPolicyGuidanceCount,
  limits = DEFAULT_PHASE_GATE_GUIDANCE_LIMITS
}) {
  if ((stepGate?.violations ?? []).some((violation) => violation?.kind === "tool_repeated_failure")) {
    return null;
  }
  const groups = missingNonActionRequiredPolicyGroups(stepGate);
  const canInject = groups.length > 0
    && iteration < maxIterations - 1
    && requiredPolicyGuidanceCount < limits.maxRequiredPolicyGuidance;
  if (!canInject) return null;

  const groupLines = groups.map((group) => {
    const members = toolsInGroup(group);
    const memberText = members.length > 0 ? members.join(", ") : "a registered tool in this policy group";
    return `- ${group}: call at least one of ${memberText} before finalizing.`;
  });

  return {
    groups,
    transcriptEntry: {
      type: "contract_guidance",
      groups,
      instruction: [
        "The task contract is not satisfied yet. Do not finalize.",
        ...groupLines,
        "Use the visible tool surface, then synthesize from the new tool result."
      ].join("\n"),
      action_only: false
    },
    eventPayload: {
      iteration,
      required_policy_groups: groups,
      action_only: false
    }
  };
}

export function planArtifactCreationGuidance({
  stepGate,
  taskSpec,
  iteration,
  maxIterations,
  artifactGuidanceCount,
  maxGuidance = Number.POSITIVE_INFINITY
}) {
  const violation = (stepGate?.violations ?? [])
    .find((entry) => entry?.kind === "artifact_required_not_created");
  const canInject = Boolean(violation)
    && iteration < maxIterations - 1
    && artifactGuidanceCount < maxGuidance;
  if (!canInject) return null;

  const kind = taskSpec?.artifact?.kind
    ?? taskSpec?.contract?.output_contract?.kind
    ?? "docx";
  return {
    transcriptEntry: {
      type: "contract_guidance",
      groups: ["artifact_generation"],
      instruction: [
        "The task contract requires a real file artifact. Do not finalize with prose only.",
        `Call generate_document now with kind="${kind}" and a structured outline, or call another artifact-producing tool if it better fits the requested output.`,
        "The final answer may summarize the generated file, but the task is not complete until an artifact path exists."
      ].join("\n"),
      action_only: false
    },
    eventPayload: {
      iteration,
      required_policy_groups: ["artifact_generation"],
      artifact_kind: kind,
      action_only: false
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
