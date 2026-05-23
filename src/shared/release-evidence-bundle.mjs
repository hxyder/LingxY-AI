import {
  validateDesktopProductEvidencePack
} from "./desktop-product-evidence-pack.mjs";

export const RELEASE_EVIDENCE_BUNDLE_SCHEMA_VERSION = 1;

export const RELEASE_EVIDENCE_BUNDLE_STATUS = Object.freeze([
  "pass",
  "partial",
  "fail",
  "not_run"
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateGate(gate, name, missing) {
  if (!isObject(gate)) {
    missing.push(name);
    return;
  }
  if (!nonEmptyString(gate.command)) missing.push(`${name}.command`);
  if (!RELEASE_EVIDENCE_BUNDLE_STATUS.includes(gate.status)) missing.push(`${name}.status`);
}

function validateEvidenceRef(ref, prefix, missing) {
  if (!isObject(ref)) {
    missing.push(prefix);
    return;
  }
  if (!nonEmptyString(ref.kind)) missing.push(`${prefix}.kind`);
  if (!RELEASE_EVIDENCE_BUNDLE_STATUS.includes(ref.status)) missing.push(`${prefix}.status`);
  if (ref.status === "pass" || ref.status === "partial" || ref.status === "fail") {
    if (!nonEmptyString(ref.path) && !nonEmptyString(ref.summary)) missing.push(`${prefix}.path_or_summary`);
  }
  if (ref.live === true && !nonEmptyString(ref.redaction)) missing.push(`${prefix}.redaction`);
}

export function buildReleaseEvidenceBundle({
  commit,
  branch,
  generatedAt = new Date().toISOString(),
  gates = {},
  desktopProductEvidence = null,
  realEvidence = [],
  policyTraces = [],
  knownIssues = [],
  environment = {},
  releaseDecision = {}
} = {}) {
  return {
    schemaVersion: RELEASE_EVIDENCE_BUNDLE_SCHEMA_VERSION,
    commit,
    branch,
    generatedAt,
    gates: {
      checkFast: gates.checkFast ?? { command: "npm run check:fast", status: "not_run", summary: "" },
      electronGuiSmoke: gates.electronGuiSmoke ?? { command: "npm run verify:desktop-gui-smoke", status: "not_run", summary: "" },
      releaseReadiness: gates.releaseReadiness ?? { command: "node scripts/verify-release-readiness.mjs", status: "not_run", summary: "" }
    },
    desktopProductEvidence,
    realEvidence,
    policyTraces,
    knownIssues,
    environment: {
      os: environment.os ?? "",
      node: environment.node ?? "",
      electron: environment.electron ?? "",
      notes: environment.notes ?? ""
    },
    releaseDecision: {
      status: releaseDecision.status ?? "not_run",
      summary: releaseDecision.summary ?? "",
      blockerCount: Number(releaseDecision.blockerCount ?? 0)
    }
  };
}

export function validateReleaseEvidenceBundle(bundle = {}) {
  const missing = [];
  if (bundle.schemaVersion !== RELEASE_EVIDENCE_BUNDLE_SCHEMA_VERSION) missing.push("schemaVersion");
  for (const field of ["commit", "branch", "generatedAt"]) {
    if (!nonEmptyString(bundle[field])) missing.push(field);
  }
  validateGate(bundle.gates?.checkFast, "gates.checkFast", missing);
  validateGate(bundle.gates?.electronGuiSmoke, "gates.electronGuiSmoke", missing);
  validateGate(bundle.gates?.releaseReadiness, "gates.releaseReadiness", missing);
  if (!isObject(bundle.desktopProductEvidence)) {
    missing.push("desktopProductEvidence");
  } else {
    const desktopValidation = validateDesktopProductEvidencePack(bundle.desktopProductEvidence);
    if (!desktopValidation.ok) {
      missing.push(...desktopValidation.missing.map((entry) => `desktopProductEvidence.${entry}`));
    }
  }
  if (!Array.isArray(bundle.realEvidence)) missing.push("realEvidence");
  else bundle.realEvidence.forEach((ref, index) => validateEvidenceRef(ref, `realEvidence.${index}`, missing));
  if (!Array.isArray(bundle.policyTraces)) missing.push("policyTraces");
  else bundle.policyTraces.forEach((ref, index) => validateEvidenceRef(ref, `policyTraces.${index}`, missing));
  if (!Array.isArray(bundle.knownIssues)) {
    missing.push("knownIssues");
  } else if (bundle.releaseDecision?.status === "partial" || bundle.releaseDecision?.status === "fail") {
    if (bundle.knownIssues.length === 0) missing.push("knownIssues.release_blockers");
  }
  if (!isObject(bundle.environment)) missing.push("environment");
  if (!RELEASE_EVIDENCE_BUNDLE_STATUS.includes(bundle.releaseDecision?.status)) missing.push("releaseDecision.status");
  if (!nonEmptyString(bundle.releaseDecision?.summary)) missing.push("releaseDecision.summary");
  return {
    ok: missing.length === 0,
    missing
  };
}
