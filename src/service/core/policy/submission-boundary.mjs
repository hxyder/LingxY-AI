import { groupsOfTool } from "./policy-groups.mjs";

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

function normalizeRequestedToolIds(boundaryContext) {
  const raw = boundaryContext?.requestedToolIds ?? boundaryContext?.requested_tool_ids ?? [];
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw
    .map((toolId) => `${toolId ?? ""}`.trim())
    .filter(Boolean))]
    .sort();
}

function listForbiddenRequestedTools(taskSpec, requestedToolIds) {
  const toolPolicy = taskSpec?.tool_policy;
  if (!toolPolicy || typeof toolPolicy !== "object" || requestedToolIds.length === 0) {
    return [];
  }

  const blocked = [];
  for (const toolId of requestedToolIds) {
    const direct = toolPolicy[toolId];
    if (direct?.mode === "forbidden") {
      blocked.push({
        tool_id: toolId,
        policy_source: `tool:${toolId}`,
        reason: direct.reason ?? null
      });
      continue;
    }

    const groupEntries = toolPolicy.policy_groups;
    if (!groupEntries || typeof groupEntries !== "object") continue;
    for (const group of groupsOfTool(toolId)) {
      const groupPolicy = groupEntries[group];
      if (groupPolicy?.mode === "forbidden") {
        blocked.push({
          tool_id: toolId,
          policy_source: `group:${group}`,
          reason: groupPolicy.reason ?? null
        });
        break;
      }
    }
  }
  return blocked;
}

/**
 * Task admission classifier. Most submissions are audit-only; when a caller
 * declares direct tools up front, this can block tools already forbidden by
 * the task policy before the queued task runs.
 */
export function evaluateSubmissionBoundary({
  task,
  submissionKind = "unknown",
  executorOverride = null,
  contextPacket = null,
  boundaryContext = null
} = {}) {
  const normalizedKind = normalizeSubmissionKind(submissionKind);
  const taskSpec = task?.task_spec ?? null;
  const requestedToolIds = normalizeRequestedToolIds(boundaryContext);
  const reasons = [];
  const requiredGuards = [];
  let risk = "low";
  let blocking = false;

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

  const blockedTools = listForbiddenRequestedTools(taskSpec, requestedToolIds);
  for (const blocked of blockedTools) {
    reasons.push(`requested_tool_forbidden:${blocked.tool_id}:${blocked.policy_source}`);
    requiredGuards.push(blocked.policy_source.startsWith("group:")
      ? `policy_group:${blocked.policy_source.slice("group:".length)}`
      : blocked.policy_source);
    risk = bumpRisk(risk, "high");
    blocking = true;
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
  const decision = blocking ? "block" : (reasons.length > 0 ? "audit_only" : "allow");

  return {
    decision,
    blocking,
    risk,
    submission_kind: normalizedKind,
    reasons,
    required_guards: uniqueRequiredGuards,
    requested_tools: requestedToolIds,
    blocked_tools: blockedTools,
    audit_payload: {
      decision,
      blocking,
      risk,
      submission_kind: normalizedKind,
      reasons,
      required_guards: uniqueRequiredGuards,
      requested_tools: requestedToolIds,
      blocked_tools: blockedTools,
      executor: task?.executor ?? null,
      goal: taskSpec?.goal ?? null
    }
  };
}
