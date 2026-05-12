export const MODEL_FALLBACK_CASCADE_VERSION = 1;

export const MODEL_FALLBACK_CASCADE_DEFAULTS = Object.freeze({
  enabled: false,
  optIn: false,
  mode: "single_model",
  maxAttempts: 1,
  maxEstimatedUsd: 0,
  allowedRoles: Object.freeze(["planner", "executor", "reviewer", "fast"]),
  requireTrace: true,
  requireUsage: true,
  ensembleVoting: Object.freeze({
    enabled: false,
    requiresEvalEvidence: true
  })
});

function asNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function asArray(value, fallback = []) {
  return Array.isArray(value) ? value : fallback;
}

export function buildModelFallbackCascadePolicy(config = {}) {
  const raw = config.ai?.modelFallbackCascade ?? config.ai?.modelCascade ?? {};
  const enabled = raw.enabled === true;
  const maxAttempts = Math.max(1, Math.floor(asNumber(raw.maxAttempts, MODEL_FALLBACK_CASCADE_DEFAULTS.maxAttempts)));
  const maxEstimatedUsd = Math.max(0, asNumber(raw.maxEstimatedUsd, MODEL_FALLBACK_CASCADE_DEFAULTS.maxEstimatedUsd));
  const ensembleVoting = {
    enabled: raw.ensembleVoting?.enabled === true || raw.voting?.enabled === true,
    requiresEvalEvidence: raw.ensembleVoting?.requiresEvalEvidence !== false
  };
  return {
    schemaVersion: MODEL_FALLBACK_CASCADE_VERSION,
    enabled,
    optIn: raw.optIn === true || raw.opt_in === true,
    mode: enabled ? (raw.mode === "cascade" ? "cascade" : "fallback") : "single_model",
    maxAttempts: enabled ? Math.max(2, maxAttempts) : 1,
    maxEstimatedUsd,
    allowedRoles: asArray(raw.allowedRoles, MODEL_FALLBACK_CASCADE_DEFAULTS.allowedRoles)
      .map((role) => `${role ?? ""}`.trim())
      .filter(Boolean),
    requireTrace: raw.requireTrace !== false,
    requireUsage: raw.requireUsage !== false,
    evalEvidenceId: `${raw.evalEvidenceId ?? raw.eval_evidence_id ?? ""}`.trim() || null,
    ensembleVoting
  };
}

export function buildModelFallbackCascadeEvidence({
  policy = buildModelFallbackCascadePolicy({}),
  role = null,
  taskId = null,
  decision = {},
  trace = {},
  usage = {},
  qualityGate = {}
} = {}) {
  return {
    schemaVersion: MODEL_FALLBACK_CASCADE_VERSION,
    policy,
    role,
    taskId,
    decision: {
      status: decision.status ?? (policy.enabled ? "planned" : "disabled"),
      primaryModel: decision.primaryModel ?? null,
      selectedModel: decision.selectedModel ?? decision.primaryModel ?? null,
      fallbackUsed: decision.fallbackUsed === true,
      reason: decision.reason ?? (policy.enabled ? "policy_enabled" : "policy_disabled")
    },
    trace: {
      events: asArray(trace.events),
      spanNames: asArray(trace.spanNames)
    },
    usage: {
      measurementKeys: asArray(usage.measurementKeys),
      tokenUsage: usage.tokenUsage ?? null,
      estimatedUsd: usage.estimatedUsd ?? null
    },
    qualityGate: {
      status: qualityGate.status ?? "not_required",
      evalEvidenceId: qualityGate.evalEvidenceId ?? policy.evalEvidenceId ?? null
    }
  };
}

export function validateModelFallbackCascadeEvidence(evidence = {}) {
  const errors = [];
  if (evidence.schemaVersion !== MODEL_FALLBACK_CASCADE_VERSION) {
    errors.push("schemaVersion");
  }
  const policy = evidence.policy ?? {};
  if (policy.enabled === true) {
    if (policy.optIn !== true) errors.push("policy.optIn");
    if (Number(policy.maxAttempts ?? 0) < 2) errors.push("policy.maxAttempts");
    if (Number(policy.maxEstimatedUsd ?? 0) <= 0) errors.push("policy.maxEstimatedUsd");
    if (policy.requireTrace !== false && !Array.isArray(evidence.trace?.events)) errors.push("trace.events");
    if (policy.requireTrace !== false && (evidence.trace?.events ?? []).length === 0) errors.push("trace.events.non_empty");
    if (policy.requireUsage !== false && (evidence.usage?.measurementKeys ?? []).length === 0) errors.push("usage.measurementKeys");
  }
  if (policy.ensembleVoting?.enabled === true && policy.ensembleVoting?.requiresEvalEvidence !== false) {
    if (!evidence.qualityGate?.evalEvidenceId) errors.push("qualityGate.evalEvidenceId");
    if (evidence.qualityGate?.status !== "passed") errors.push("qualityGate.status");
  }
  return {
    ok: errors.length === 0,
    errors
  };
}
