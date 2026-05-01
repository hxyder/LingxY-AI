const KNOWN_SUBMISSION_KINDS = Object.freeze(new Set([
  "action_tool",
  "browser",
  "composite",
  "context",
  "file",
  "image",
  "office",
  "screenshot",
  "unknown"
]));

const EXECUTOR_OVERRIDE_RISK = Object.freeze(new Map([
  ["code_cli", "medium"],
  ["tool_using", "medium"],
  ["composite", "low"],
  ["multi_modal", "low"]
]));

const RISK_SCORE = Object.freeze({
  low: 1,
  medium: 2,
  high: 3
});

function normalizeSubmissionKind(value) {
  const normalized = `${value ?? ""}`.trim().toLowerCase();
  if (!normalized) return "unknown";
  return KNOWN_SUBMISSION_KINDS.has(normalized) ? normalized : "unknown";
}

function bumpRisk(current, candidate) {
  return RISK_SCORE[candidate] > RISK_SCORE[current] ? candidate : current;
}

function listForbiddenPolicyGroups(taskSpec) {
  const groups = taskSpec?.tool_policy?.policy_groups;
  if (!groups || typeof groups !== "object") return [];
  return Object.entries(groups)
    .filter(([, policy]) => policy?.mode === "forbidden")
    .map(([group]) => group)
    .sort();
}

function listSuccessRequiredPolicyGroups(taskSpec) {
  const groups = taskSpec?.success_contract?.required_policy_groups;
  return Array.isArray(groups)
    ? [...new Set(groups.map((group) => `${group ?? ""}`.trim()).filter(Boolean))].sort()
    : [];
}

/**
 * Audit-only task admission classifier. This does not replace the action-tool
 * policy guard; it records task-level risk before a queued task runs.
 */
export function evaluateSubmissionBoundary({
  task,
  submissionKind = "unknown",
  executorOverride = null,
  contextPacket = null
} = {}) {
  const normalizedKind = normalizeSubmissionKind(submissionKind);
  const taskSpec = task?.task_spec ?? null;
  const reasons = [];
  const requiredGuards = [];
  let risk = "low";

  if (normalizedKind === "unknown") {
    reasons.push("missing_submission_kind");
    risk = bumpRisk(risk, "medium");
  }

  const forbiddenGroups = listForbiddenPolicyGroups(taskSpec);
  for (const group of forbiddenGroups) {
    reasons.push(`forbidden_policy_group:${group}`);
    requiredGuards.push(`policy_group:${group}`);
    risk = bumpRisk(risk, "medium");
  }

  for (const group of listSuccessRequiredPolicyGroups(taskSpec)) {
    reasons.push(`required_policy_group:${group}`);
    requiredGuards.push(`policy_group:${group}`);
    risk = bumpRisk(risk, "medium");
  }

  if (taskSpec?.side_effect_contract || contextPacket?.selection_metadata?.side_effect_contract) {
    reasons.push("side_effect_contract_present");
    requiredGuards.push("side_effect_contract");
    risk = bumpRisk(risk, "high");
  }

  if (executorOverride) {
    const normalizedExecutor = `${executorOverride}`.trim();
    reasons.push(`executor_override:${normalizedExecutor}`);
    risk = bumpRisk(risk, EXECUTOR_OVERRIDE_RISK.get(normalizedExecutor) ?? "medium");
  }

  const uniqueRequiredGuards = [...new Set(requiredGuards)].sort();
  const decision = reasons.length > 0 ? "audit_only" : "allow";

  return {
    decision,
    blocking: false,
    risk,
    submission_kind: normalizedKind,
    reasons,
    required_guards: uniqueRequiredGuards,
    audit_payload: {
      decision,
      blocking: false,
      risk,
      submission_kind: normalizedKind,
      reasons,
      required_guards: uniqueRequiredGuards,
      executor: task?.executor ?? null,
      goal: taskSpec?.goal ?? null
    }
  };
}

