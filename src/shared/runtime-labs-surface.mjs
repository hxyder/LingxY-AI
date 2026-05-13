export const RUNTIME_LABS_SCHEMA_VERSION = 1;

const BLOCKED_CAPABILITIES = Object.freeze(new Set([
  "network_otel_export",
  "multi_candidate_voting",
  "automatic_sub_agent_delegation"
]));

function bool(value) {
  return value === true;
}

function reviewerLoopEnabled(config = {}) {
  return bool(config.ai?.reviewerLoop?.enabled)
    || bool(config.ai?.finalAnswerReviewer?.enabled)
    || bool(config.ai?.modelRoleRouting?.reviewerLoop?.enabled);
}

function modelRoleRoutingEnabled(config = {}) {
  return bool(config.ai?.modelRoles?.enabled) || bool(config.ai?.modelRoleRouting?.enabled);
}

function capability({
  id,
  label,
  summary,
  enabled = false,
  status = enabled ? "enabled" : "available",
  userToggle = false,
  configPath = null,
  evidence = [],
  blockedReason = "",
  nextGate = ""
}) {
  return {
    id,
    label,
    summary,
    enabled: bool(enabled),
    status,
    userToggle: bool(userToggle),
    configPath,
    evidence,
    blockedReason,
    nextGate
  };
}

export function buildRuntimeLabsSurface({
  config = {},
  modelRoles = null
} = {}) {
  const modelRolesEnabled = modelRoleRoutingEnabled(config);
  const reviewerEnabled = reviewerLoopEnabled(config);
  return {
    id: "runtime_labs_surface",
    schemaVersion: RUNTIME_LABS_SCHEMA_VERSION,
    toggles: {
      modelRoleRouting: {
        enabled: modelRolesEnabled,
        configPath: "ai.modelRoles.enabled"
      },
      finalAnswerReviewer: {
        enabled: reviewerEnabled,
        configPath: "ai.reviewerLoop.enabled"
      }
    },
    capabilities: [
      capability({
        id: "desktop_polish",
        label: "Desktop Polish",
        summary: "Console, Overlay, task, settings, preview, keyboard, empty, loading, and error-state acceptance coverage.",
        enabled: true,
        status: "framework_complete",
        evidence: ["npm run verify:desktop-gui-smoke", "node scripts/verify-desktop-product-acceptance-matrix.mjs"]
      }),
      capability({
        id: "model_role_routing",
        label: "Model Role Routing",
        summary: "Planner, executor, reviewer, and fast lanes can use role-specific providers while token/cache usage remains traceable.",
        enabled: modelRolesEnabled,
        status: modelRolesEnabled ? "enabled" : "available",
        userToggle: true,
        configPath: "ai.modelRoles.enabled",
        evidence: modelRoles?.measurementKeys ?? ["model_role.planner", "model_role.executor", "model_role.reviewer", "model_role.fast"]
      }),
      capability({
        id: "final_answer_reviewer",
        label: "Final Answer Reviewer",
        summary: "Optional reviewer pass for high-risk answers using an explicit reviewer role and bounded token/latency budget.",
        enabled: reviewerEnabled,
        status: reviewerEnabled ? "enabled" : "available",
        userToggle: true,
        configPath: "ai.reviewerLoop.enabled",
        evidence: ["node scripts/verify-final-answer-reviewer-loop.mjs"]
      }),
      capability({
        id: "network_otel_export",
        label: "Network OTEL Export",
        summary: "Local OTEL-shaped trace records are available; network upload is not enabled.",
        enabled: false,
        status: "deferred",
        blockedReason: "Requires a concrete backend, privacy/redaction model, retry/backpressure policy, and latency budget.",
        nextGate: "Write the backend/privacy decision record before adding an exporter."
      }),
      capability({
        id: "multi_candidate_voting",
        label: "Multi-Candidate Voting",
        summary: "Multiple candidates or reviewers must prove better quality before runtime voting is allowed.",
        enabled: false,
        status: "evidence_gated",
        blockedReason: "Requires eval evidence, token/cache budget, trace fields, and a runtime candidate orchestration path.",
        nextGate: "Pass MMX evidence for a concrete task class before enabling."
      }),
      capability({
        id: "automatic_sub_agent_delegation",
        label: "Automatic Sub-Agent Delegation",
        summary: "Sub-agent contracts and timeline summaries exist; automatic planner delegation remains off.",
        enabled: false,
        status: "evidence_gated",
        blockedReason: "Requires SA-003 task-class gates: isolation, tool policy, budget, cancellation, child reports, and UI timeline evidence.",
        nextGate: "Enable only for a proven task class after live acceptance."
      })
    ]
  };
}

function readTogglePatch(patch = {}, key) {
  const value = patch?.[key];
  if (!value || typeof value !== "object" || !Object.prototype.hasOwnProperty.call(value, "enabled")) return null;
  if (typeof value.enabled !== "boolean") {
    return {
      ok: false,
      error: `${key}.enabled must be boolean`
    };
  }
  return { ok: true, enabled: value.enabled };
}

export function applyRuntimeLabsPatch(config = {}, patch = {}) {
  const attemptedBlockedEnable = Object.entries(patch ?? {})
    .find(([key, value]) => BLOCKED_CAPABILITIES.has(key) && value?.enabled === true);
  if (attemptedBlockedEnable) {
    return {
      ok: false,
      error: "capability_not_user_toggleable",
      capabilityId: attemptedBlockedEnable[0],
      config
    };
  }

  const modelRoleToggle = readTogglePatch(patch, "modelRoleRouting");
  if (modelRoleToggle?.ok === false) return { ok: false, error: modelRoleToggle.error, config };
  const reviewerToggle = readTogglePatch(patch, "finalAnswerReviewer");
  if (reviewerToggle?.ok === false) return { ok: false, error: reviewerToggle.error, config };

  const next = {
    ...config,
    ai: {
      ...(config.ai ?? {})
    }
  };

  if (modelRoleToggle?.ok) {
    next.ai.modelRoles = {
      ...(next.ai.modelRoles ?? {}),
      enabled: modelRoleToggle.enabled
    };
  }
  if (reviewerToggle?.ok) {
    next.ai.reviewerLoop = {
      ...(next.ai.reviewerLoop ?? {}),
      enabled: reviewerToggle.enabled
    };
  }

  return {
    ok: true,
    config: next,
    patch: {
      ai: {
        ...(modelRoleToggle?.ok ? { modelRoles: { enabled: modelRoleToggle.enabled } } : {}),
        ...(reviewerToggle?.ok ? { reviewerLoop: { enabled: reviewerToggle.enabled } } : {})
      }
    }
  };
}
