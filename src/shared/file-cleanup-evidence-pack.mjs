export const FILE_CLEANUP_EVIDENCE_PACK_SCHEMA_VERSION = 1;

export const FILE_CLEANUP_CATEGORIES = Object.freeze([
  "local_generated_output",
  "historical_evidence",
  "old_reachable_implementation",
  "large_mixed_responsibility_file"
]);

export const FILE_CLEANUP_DECISIONS = Object.freeze([
  "candidate",
  "retain",
  "archive_ready",
  "delete_ready",
  "split_required",
  "blocked"
]);

export const FILE_CLEANUP_EVIDENCE_STATUSES = Object.freeze([
  "pass",
  "fail",
  "not_run",
  "not_applicable"
]);

export const FILE_CLEANUP_EVIDENCE_KEYS = Object.freeze([
  "referenceSweep",
  "packageScriptSweep",
  "publicExportSweep",
  "interfaceSweep",
  "replacementVerifier",
  "rollbackOrArchivePath",
  "checkFast"
]);

const TRACKED_SOURCE_READY_KEYS = Object.freeze(FILE_CLEANUP_EVIDENCE_KEYS);
const LOCAL_GENERATED_ROOTS = Object.freeze([
  ".tmp/",
  "tmp/",
  ".cache/lingxy/",
  ".tmp-checkfast.log",
  ".codex-behavior.log"
]);
const FORBIDDEN_CLEANUP_PATH_PREFIXES = Object.freeze([
  "node_modules/",
  "dist/",
  "data/",
  "userdata/",
  "user-data/",
  ".env",
  ".secrets/",
  "secrets/"
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizePathForPolicy(value = "") {
  return String(value ?? "").replace(/\\/g, "/").replace(/^\.\//u, "");
}

function defaultEvidence(key) {
  return {
    status: "not_run",
    command: "",
    summary: "",
    ...(key === "checkFast" ? { requiredCommand: "npm run check:fast" } : {})
  };
}

function normalizeEvidence(evidence = {}) {
  const normalized = {};
  for (const key of FILE_CLEANUP_EVIDENCE_KEYS) {
    normalized[key] = {
      ...defaultEvidence(key),
      ...(isObject(evidence[key]) ? evidence[key] : {})
    };
  }
  return normalized;
}

export function isDisposableLocalCleanupPath(value = "") {
  const rel = normalizePathForPolicy(value);
  return LOCAL_GENERATED_ROOTS.some((prefix) => rel === prefix.slice(0, -1) || rel.startsWith(prefix));
}

export function isForbiddenCleanupPath(value = "") {
  const rel = normalizePathForPolicy(value).toLowerCase();
  return FORBIDDEN_CLEANUP_PATH_PREFIXES.some((prefix) => rel === prefix.slice(0, -1) || rel.startsWith(prefix));
}

export function normalizeFileCleanupCandidate(candidate = {}) {
  return {
    path: normalizePathForPolicy(candidate.path),
    category: FILE_CLEANUP_CATEGORIES.includes(candidate.category) ? candidate.category : "local_generated_output",
    trackedSource: candidate.trackedSource === true,
    decision: FILE_CLEANUP_DECISIONS.includes(candidate.decision) ? candidate.decision : "candidate",
    ownerLayer: candidate.ownerLayer ?? "",
    reason: candidate.reason ?? "",
    replacementPath: candidate.replacementPath ?? "",
    splitDirection: candidate.splitDirection ?? "",
    evidence: normalizeEvidence(candidate.evidence),
    notes: Array.isArray(candidate.notes) ? candidate.notes : []
  };
}

export function buildFileCleanupEvidencePack({
  generatedAt = new Date().toISOString(),
  commit = "unknown",
  branch = "unknown",
  candidates = [],
  notes = []
} = {}) {
  return {
    schemaVersion: FILE_CLEANUP_EVIDENCE_PACK_SCHEMA_VERSION,
    generatedAt,
    commit,
    branch,
    candidates: candidates.map((candidate) => normalizeFileCleanupCandidate(candidate)),
    notes: Array.isArray(notes) ? notes : []
  };
}

function validateEvidenceRecord(candidate, key, missing) {
  const record = candidate.evidence?.[key];
  if (!isObject(record)) {
    missing.push(`${candidate.path || "candidate"}.evidence.${key}`);
    return;
  }
  if (!FILE_CLEANUP_EVIDENCE_STATUSES.includes(record.status)) {
    missing.push(`${candidate.path || "candidate"}.evidence.${key}.status`);
  }
  if (record.status === "pass") {
    if (!nonEmptyString(record.command) && key !== "rollbackOrArchivePath") {
      missing.push(`${candidate.path}.evidence.${key}.command`);
    }
    if (!nonEmptyString(record.summary)) {
      missing.push(`${candidate.path}.evidence.${key}.summary`);
    }
  }
  if (key === "checkFast" && candidate.trackedSource && ["archive_ready", "delete_ready"].includes(candidate.decision)) {
    const commandText = `${record.command ?? ""} ${record.requiredCommand ?? ""}`;
    if (!commandText.includes("npm run check:fast")) {
      missing.push(`${candidate.path}.evidence.checkFast.requiredCommand`);
    }
  }
}

function requireTrackedSourceReadyEvidence(candidate, missing) {
  for (const key of TRACKED_SOURCE_READY_KEYS) {
    if (candidate.evidence?.[key]?.status !== "pass") {
      missing.push(`${candidate.path}.evidence.${key}.pass`);
    }
  }
}

function validateCandidate(candidate, missing) {
  if (!nonEmptyString(candidate.path)) missing.push("candidate.path");
  if (!FILE_CLEANUP_CATEGORIES.includes(candidate.category)) missing.push(`${candidate.path || "candidate"}.category`);
  if (!FILE_CLEANUP_DECISIONS.includes(candidate.decision)) missing.push(`${candidate.path || "candidate"}.decision`);
  if (typeof candidate.trackedSource !== "boolean") missing.push(`${candidate.path || "candidate"}.trackedSource`);
  if (!nonEmptyString(candidate.reason)) missing.push(`${candidate.path || "candidate"}.reason`);
  if (candidate.trackedSource && !nonEmptyString(candidate.ownerLayer)) {
    missing.push(`${candidate.path || "candidate"}.ownerLayer`);
  }
  if (candidate.category === "large_mixed_responsibility_file") {
    if (!["candidate", "split_required", "blocked"].includes(candidate.decision)) {
      missing.push(`${candidate.path}.largeFileDecision`);
    }
    if (candidate.decision === "split_required" && !nonEmptyString(candidate.splitDirection)) {
      missing.push(`${candidate.path}.splitDirection`);
    }
    if (candidate.decision === "split_required" && !nonEmptyString(candidate.ownerLayer)) {
      missing.push(`${candidate.path}.ownerLayer`);
    }
  }
  if (isForbiddenCleanupPath(candidate.path) && ["archive_ready", "delete_ready"].includes(candidate.decision)) {
    missing.push(`${candidate.path}.forbiddenCleanupPath`);
  }
  if (candidate.category === "local_generated_output" && candidate.decision === "delete_ready") {
    if (candidate.trackedSource) missing.push(`${candidate.path}.trackedSource`);
    if (!isDisposableLocalCleanupPath(candidate.path)) missing.push(`${candidate.path}.disposableLocalPath`);
  }
  for (const key of FILE_CLEANUP_EVIDENCE_KEYS) validateEvidenceRecord(candidate, key, missing);
  if (candidate.trackedSource && ["archive_ready", "delete_ready"].includes(candidate.decision)) {
    requireTrackedSourceReadyEvidence(candidate, missing);
  }
  if (candidate.category === "old_reachable_implementation" && ["archive_ready", "delete_ready"].includes(candidate.decision)) {
    if (candidate.evidence?.replacementVerifier?.status !== "pass") {
      missing.push(`${candidate.path}.replacementVerifier`);
    }
    if (!nonEmptyString(candidate.replacementPath)) {
      missing.push(`${candidate.path}.replacementPath`);
    }
  }
}

export function validateFileCleanupEvidencePack(pack = {}) {
  const missing = [];
  if (!isObject(pack)) missing.push("pack");
  if (pack.schemaVersion !== FILE_CLEANUP_EVIDENCE_PACK_SCHEMA_VERSION) missing.push("schemaVersion");
  if (!nonEmptyString(pack.generatedAt)) missing.push("generatedAt");
  if (!nonEmptyString(pack.commit)) missing.push("commit");
  if (!nonEmptyString(pack.branch)) missing.push("branch");
  if (!Array.isArray(pack.candidates)) {
    missing.push("candidates");
  } else {
    for (const rawCandidate of pack.candidates) {
      validateCandidate(normalizeFileCleanupCandidate(rawCandidate), missing);
    }
  }
  if (!Array.isArray(pack.notes)) missing.push("notes");
  return {
    ok: missing.length === 0,
    missing
  };
}
