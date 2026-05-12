import {
  CURRENT_ISOLATION_DECISIONS,
  ISOLATION_DECISION_KIND,
  validateIsolationDecisionRecord
} from "./isolation-decision-records.mjs";

export const OS_SANDBOX_IMPLEMENTATION_DECISION_SCHEMA_VERSION = 1;

export const OS_SANDBOX_IMPLEMENTATION_STATE = Object.freeze({
  DEFER_NEW_OS_SANDBOX: "defer_new_os_sandbox",
  KEEP_EXISTING_BOUNDARY: "keep_existing_boundary",
  MEASURE_BEFORE_BOUNDARY_CHANGE: "measure_before_boundary_change"
});

export const OS_SANDBOX_IMPLEMENTATION_REQUIRED_FIELDS = Object.freeze([
  "id",
  "owner",
  "currentBoundary",
  "implementationDecision",
  "requiredEvidenceBeforeChange",
  "rollbackPath",
  "userRecovery"
]);

const IMPLEMENTATION_DECISIONS = Object.freeze({
  file_operations: Object.freeze({
    implementationDecision: "do_not_os_sandbox_now",
    requiredEvidenceBeforeChange:
      "Measured path-policy escape, unbounded write latency, or cross-process mutation requirement that cannot be enforced by service policy, approvals, artifact lineage, and reversibility checkpoints."
  }),
  external_commands: Object.freeze({
    implementationDecision: "keep_child_process_lane",
    requiredEvidenceBeforeChange:
      "Repeated event-loop blocking, uncontrolled process lifetime, or concrete need for OS-level syscall restrictions beyond approval, timeout, cwd, and output capture controls."
  }),
  browser_automation: Object.freeze({
    implementationDecision: "keep_browser_process_boundary",
    requiredEvidenceBeforeChange:
      "Need to execute untrusted page code outside browser sandbox or to operate a persistent automation daemon outside the browser/extension process boundary."
  }),
  ocr_extractors: Object.freeze({
    implementationDecision: "measure_before_sidecar_or_os_sandbox",
    requiredEvidenceBeforeChange:
      "Latency, memory, packaging, or binary-execution measurements proving that worker or child-process extraction is insufficient."
  }),
  audio_daemons: Object.freeze({
    implementationDecision: "keep_external_daemon_with_breaker",
    requiredEvidenceBeforeChange:
      "New native audio helper, GPU-bound model hosting, or persistent microphone capture that cannot fit the existing daemon lifecycle, circuit breaker, cancellation, and fallback contract."
  }),
  mcp_install_sandbox: Object.freeze({
    implementationDecision: "keep_install_sandbox_child_process",
    requiredEvidenceBeforeChange:
      "Remote package execution risk that requires stronger per-package isolation or signed marketplace distribution beyond the configured MCP install sandbox directory."
  })
});

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function buildOsSandboxImplementationDecision({
  decisions = CURRENT_ISOLATION_DECISIONS
} = {}) {
  const candidates = decisions.map((record) => {
    const validation = validateIsolationDecisionRecord(record);
    if (!validation.ok) {
      throw new Error(`Invalid isolation decision ${record.id}: ${validation.missing.join(", ")}`);
    }
    const implementation = IMPLEMENTATION_DECISIONS[record.id];
    if (!implementation) {
      throw new Error(`Missing OS sandbox implementation decision for ${record.id}`);
    }
    return Object.freeze({
      id: record.id,
      owner: record.owner,
      currentBoundary: record.currentBoundary,
      riskLevel: record.riskLevel,
      implementationDecision: implementation.implementationDecision,
      requiredEvidenceBeforeChange: implementation.requiredEvidenceBeforeChange,
      rollbackPath: record.rollbackPath,
      userRecovery: record.userRecovery,
      nextReviewTrigger: record.nextReviewTrigger
    });
  });

  const noNewOsSandbox =
    candidates.length > 0 &&
    candidates.every((candidate) => candidate.currentBoundary !== ISOLATION_DECISION_KIND.OS_SANDBOX_REQUIRED);

  return Object.freeze({
    schemaVersion: OS_SANDBOX_IMPLEMENTATION_DECISION_SCHEMA_VERSION,
    state: OS_SANDBOX_IMPLEMENTATION_STATE.DEFER_NEW_OS_SANDBOX,
    runtimeDefault: OS_SANDBOX_IMPLEMENTATION_STATE.KEEP_EXISTING_BOUNDARY,
    plannerAction: OS_SANDBOX_IMPLEMENTATION_STATE.MEASURE_BEFORE_BOUNDARY_CHANGE,
    noNewOsSandbox,
    candidates: Object.freeze(candidates)
  });
}

export function validateOsSandboxImplementationDecision(record = {}) {
  const missing = [];
  if (record.schemaVersion !== OS_SANDBOX_IMPLEMENTATION_DECISION_SCHEMA_VERSION) {
    missing.push("schemaVersion");
  }
  if (!Object.values(OS_SANDBOX_IMPLEMENTATION_STATE).includes(record.state)) {
    missing.push("state");
  }
  if (!Object.values(OS_SANDBOX_IMPLEMENTATION_STATE).includes(record.runtimeDefault)) {
    missing.push("runtimeDefault");
  }
  if (record.noNewOsSandbox !== true) {
    missing.push("noNewOsSandbox");
  }
  if (!Array.isArray(record.candidates) || record.candidates.length === 0) {
    missing.push("candidates");
  } else {
    for (const candidate of record.candidates) {
      for (const field of OS_SANDBOX_IMPLEMENTATION_REQUIRED_FIELDS) {
        if (!nonEmptyString(candidate[field])) {
          missing.push(`${candidate.id || "candidate"}.${field}`);
        }
      }
      if (candidate.currentBoundary === ISOLATION_DECISION_KIND.OS_SANDBOX_REQUIRED) {
        missing.push(`${candidate.id}.currentBoundary`);
      }
    }
  }
  return {
    ok: missing.length === 0,
    missing
  };
}

export const CURRENT_OS_SANDBOX_IMPLEMENTATION_DECISION =
  buildOsSandboxImplementationDecision();
