export const ISOLATION_DECISION_SCHEMA_VERSION = 1;

export const ISOLATION_DECISION_KIND = Object.freeze({
  SERVICE_IN_PROCESS: "service_in_process",
  WORKER: "worker",
  CHILD_PROCESS: "child_process",
  EXTERNAL_DAEMON: "external_daemon",
  OS_SANDBOX_REQUIRED: "os_sandbox_required",
  DEFERRED: "deferred"
});

export const SIDECAR_DECISION_REQUIRED_FIELDS = Object.freeze([
  "id",
  "owner",
  "scope",
  "measuredBottleneck",
  "workerInsufficientReason",
  "serializationBoundary",
  "cancellationBoundary",
  "failureBehavior",
  "packagingImpact",
  "rollbackPath",
  "userRecovery",
  "businessLogicRewriteProhibited"
]);

export const CURRENT_ISOLATION_DECISIONS = Object.freeze([
  Object.freeze({
    id: "file_operations",
    owner: "src/service/capabilities/tools",
    scope: "File read/write/edit tools and generated artifact writes.",
    currentBoundary: ISOLATION_DECISION_KIND.SERVICE_IN_PROCESS,
    decision: "No OS sandbox yet; enforce path policy, approval gates, artifact lineage, and reversibility checkpoints inside the service boundary.",
    riskLevel: "high",
    rollbackPath: "Use file reversibility checkpoints and task artifact lineage to restore overwritten files.",
    userRecovery: "Surface approval, blocked path, and restore controls in task detail.",
    nextReviewTrigger: "A measured path-policy escape, unbounded write latency, or cross-process file mutation requirement."
  }),
  Object.freeze({
    id: "external_commands",
    owner: "src/service/capabilities/tools",
    scope: "run_script, shell-like helpers, Code CLI execution, and provider-specific CLI wrappers.",
    currentBoundary: ISOLATION_DECISION_KIND.CHILD_PROCESS,
    decision: "Keep execution in explicit child-process lanes with approval, timeout, working-directory, and output capture controls; no native sidecar rewrite without a decision record.",
    riskLevel: "high",
    rollbackPath: "Disable the tool family or permission mode, then replay from task checkpoints where available.",
    userRecovery: "Show command failure, timeout, and approval state in the task timeline.",
    nextReviewTrigger: "Repeated event-loop blocking, uncontrolled process lifetime, or need for OS-level syscall restrictions."
  }),
  Object.freeze({
    id: "browser_automation",
    owner: "src/desktop and src/service/browser",
    scope: "Browser extension capture, page context extraction, and GUI/browser automation bridges.",
    currentBoundary: ISOLATION_DECISION_KIND.CHILD_PROCESS,
    decision: "Use existing browser/extension process boundaries and typed IPC/service routes; do not move browser state into Electron main.",
    riskLevel: "medium",
    rollbackPath: "Disable browser capture/enrichment routes and keep local context fallback.",
    userRecovery: "Report context prefetch failures as typed task context errors without leaking page secrets.",
    nextReviewTrigger: "Need to execute untrusted page code outside browser sandbox or persistent browser automation daemons."
  }),
  Object.freeze({
    id: "ocr_extractors",
    owner: "src/service/extractors",
    scope: "PDF OCR and image OCR helpers.",
    currentBoundary: ISOLATION_DECISION_KIND.DEFERRED,
    decision: "Keep as service-owned worker/child-process candidates; require latency and memory evidence before an OS sandbox or native sidecar.",
    riskLevel: "high",
    rollbackPath: "Disable OCR fallback and return structured extraction-unavailable quality metadata.",
    userRecovery: "Preserve source artifacts and expose extraction quality/failure reason.",
    nextReviewTrigger: "OCR causes sustained UI/runtime stalls, memory pressure, or requires untrusted binary execution."
  }),
  Object.freeze({
    id: "audio_daemons",
    owner: "src/service/audio",
    scope: "Whisper/sherpa daemons, text-to-speech process helpers, and hardware permission smoke.",
    currentBoundary: ISOLATION_DECISION_KIND.EXTERNAL_DAEMON,
    decision: "Existing daemon helpers are allowed only with single-owner lifecycle, circuit breaker, cancellation, and fallback contracts; new audio sidecars need a sidecar decision record.",
    riskLevel: "high",
    rollbackPath: "Trip circuit breaker, stop the daemon, and fall back to unavailable/diagnostic state.",
    userRecovery: "Expose actionable audio permission or daemon-unavailable diagnostics.",
    nextReviewTrigger: "New native audio helper, GPU-bound model hosting, or persistent microphone capture outside current daemon contract."
  }),
  Object.freeze({
    id: "mcp_install_sandbox",
    owner: "src/service/capabilities/mcp",
    scope: "External MCP package install planning and execution.",
    currentBoundary: ISOLATION_DECISION_KIND.CHILD_PROCESS,
    decision: "Keep package installs scoped to the configured MCP install sandbox directory with source classification and runtime-owned install execution.",
    riskLevel: "high",
    rollbackPath: "Remove staged install directory and leave MCP server disabled/catalog-only.",
    userRecovery: "Return structured install plan/run failures with stderr tail and no active MCP registration.",
    nextReviewTrigger: "Remote package execution needs stronger per-package isolation or signed marketplace distribution."
  })
]);

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateIsolationDecisionRecord(record = {}) {
  const missing = [];
  for (const field of [
    "id",
    "owner",
    "scope",
    "currentBoundary",
    "decision",
    "riskLevel",
    "rollbackPath",
    "userRecovery",
    "nextReviewTrigger"
  ]) {
    if (!nonEmptyString(record[field])) missing.push(field);
  }
  if (!Object.values(ISOLATION_DECISION_KIND).includes(record.currentBoundary)) {
    missing.push("known_currentBoundary");
  }
  return {
    ok: missing.length === 0,
    missing
  };
}

export function validateSidecarDecisionRecord(record = {}) {
  const missing = SIDECAR_DECISION_REQUIRED_FIELDS.filter((field) =>
    field === "businessLogicRewriteProhibited"
      ? record[field] !== true
      : !nonEmptyString(record[field])
  );
  return {
    ok: missing.length === 0,
    missing,
    allowed: missing.length === 0
  };
}

export function listIsolationDecisionRecords() {
  return CURRENT_ISOLATION_DECISIONS.map((record) => ({ ...record }));
}
