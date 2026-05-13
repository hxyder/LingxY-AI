import {
  normalizeNetworkOtelConfig,
  sanitizeNetworkOtelEndpoint
} from "./network-otel-config.mjs";

export const RUNTIME_LABS_SCHEMA_VERSION = 1;

const BLOCKED_CAPABILITIES = Object.freeze(new Set([
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
  nextGate = "",
  settings = null
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
    nextGate,
    ...(settings ? { settings } : {})
  };
}

export function buildRuntimeLabsSurface({
  config = {},
  modelRoles = null,
  networkOtelStatus = null
} = {}) {
  const modelRolesEnabled = modelRoleRoutingEnabled(config);
  const reviewerEnabled = reviewerLoopEnabled(config);
  const networkOtel = normalizeNetworkOtelConfig(config);
  const networkOtelEnabled = networkOtel.enabled;
  const networkOtelActive = networkOtel.active;
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
      },
      networkOtel: {
        enabled: networkOtelEnabled,
        active: networkOtelActive,
        configPath: "observability.networkOtel.enabled",
        endpointConfigured: Boolean(networkOtel.endpoint),
        consentAccepted: networkOtel.consent.accepted
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
        summary: "Opt-in upload of redacted task span summaries to a configured OTLP HTTP endpoint.",
        enabled: networkOtelEnabled,
        status: networkOtelActive ? "enabled" : networkOtelEnabled ? "needs_endpoint" : "available",
        userToggle: true,
        configPath: "observability.networkOtel.enabled",
        evidence: ["local_otel_span_v1", "summary_only_no_raw_payloads", "bounded_queue"],
        blockedReason: networkOtelEnabled && !networkOtel.endpoint
          ? "Consent is saved, but uploads need an HTTP(S) OTLP endpoint."
          : "",
        nextGate: networkOtelActive
          ? "Exporter is active for terminal task traces."
          : "Enter an endpoint and keep consent checked to activate uploads.",
        settings: {
          endpoint: networkOtel.endpoint,
          endpointConfigured: Boolean(networkOtel.endpoint),
          consentAccepted: networkOtel.consent.accepted,
          redaction: networkOtel.redaction,
          queueDepth: networkOtelStatus?.queueDepth ?? 0,
          exportedSpans: networkOtelStatus?.exportedSpans ?? 0,
          failedBatches: networkOtelStatus?.failedBatches ?? 0,
          lastError: networkOtelStatus?.lastError ?? null
        }
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

function readNetworkOtelPatch(patch = {}) {
  const raw = patch?.networkOtel;
  if (!raw || typeof raw !== "object") return null;
  if (Object.prototype.hasOwnProperty.call(raw, "enabled") && typeof raw.enabled !== "boolean") {
    return { ok: false, error: "networkOtel.enabled must be boolean" };
  }
  const consentAccepted = raw.consentAccepted === true || raw.consent?.accepted === true;
  const endpoint = sanitizeNetworkOtelEndpoint(raw.endpoint ?? "");
  if (raw.endpoint && !endpoint) {
    return { ok: false, error: "networkOtel.endpoint must be http(s) without credentials" };
  }
  return {
    ok: true,
    enabled: raw.enabled === true && consentAccepted,
    consentAccepted,
    endpoint
  };
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
  const networkOtelPatch = readNetworkOtelPatch(patch);
  if (networkOtelPatch?.ok === false) return { ok: false, error: networkOtelPatch.error, config };

  const next = {
    ...config,
    ai: {
      ...(config.ai ?? {})
    },
    observability: {
      ...(config.observability ?? {})
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
  if (networkOtelPatch?.ok) {
    next.observability.networkOtel = {
      ...(next.observability.networkOtel ?? {}),
      enabled: networkOtelPatch.enabled,
      endpoint: networkOtelPatch.endpoint,
      consent: {
        ...(next.observability.networkOtel?.consent ?? {}),
        accepted: networkOtelPatch.consentAccepted,
        acceptedAt: networkOtelPatch.consentAccepted
          ? next.observability.networkOtel?.consent?.acceptedAt ?? new Date().toISOString()
          : null
      },
      redaction: "summary_only_no_raw_payloads"
    };
  }

  return {
    ok: true,
    config: next,
    patch: {
      ai: {
        ...(modelRoleToggle?.ok ? { modelRoles: { enabled: modelRoleToggle.enabled } } : {}),
        ...(reviewerToggle?.ok ? { reviewerLoop: { enabled: reviewerToggle.enabled } } : {})
      },
      ...(networkOtelPatch?.ok ? {
        observability: {
          networkOtel: {
            enabled: networkOtelPatch.enabled,
            endpoint: networkOtelPatch.endpoint,
            consent: {
              accepted: networkOtelPatch.consentAccepted,
              acceptedAt: next.observability.networkOtel.consent.acceptedAt
            },
            redaction: "summary_only_no_raw_payloads"
          }
        }
      } : {})
    }
  };
}
