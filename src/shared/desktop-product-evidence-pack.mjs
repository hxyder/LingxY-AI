export const DESKTOP_PRODUCT_EVIDENCE_PACK_SCHEMA_VERSION = 1;

export const DESKTOP_PRODUCT_WORKFLOW_IDS = Object.freeze([
  "first_run_provider_setup",
  "conversation_continuity",
  "task_operations",
  "artifact_workflow",
  "memory_governance",
  "marketplace_governance",
  "scheduler_and_approvals",
  "connector_workflows",
  "browser_and_office_entry",
  "native_windows_entry",
  "recovery_and_diagnostics",
  "performance_and_accessibility"
]);

export const DESKTOP_PRODUCT_EVIDENCE_STATUS = Object.freeze([
  "pass",
  "partial",
  "fail",
  "not_run"
]);

export const DESKTOP_PRODUCT_REAL_ENVIRONMENT_KINDS = Object.freeze([
  "none",
  "electron_gui",
  "provider_api",
  "connector_oauth",
  "browser_sideload",
  "office_sideload",
  "windows_shell",
  "audio_hardware",
  "packaged_build"
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateResultField(value, prefix, missing) {
  if (!isObject(value)) {
    missing.push(prefix);
    return;
  }
  if (!nonEmptyString(value.command)) missing.push(`${prefix}.command`);
  if (!DESKTOP_PRODUCT_EVIDENCE_STATUS.includes(value.status)) missing.push(`${prefix}.status`);
}

export function validateDesktopProductEvidencePack(pack = {}) {
  const missing = [];
  if (pack.schemaVersion !== DESKTOP_PRODUCT_EVIDENCE_PACK_SCHEMA_VERSION) {
    missing.push("schemaVersion");
  }
  for (const field of ["commit", "branch", "generatedAt"]) {
    if (!nonEmptyString(pack[field])) missing.push(field);
  }
  validateResultField(pack.checkFast, "checkFast", missing);
  validateResultField(pack.electronGuiSmoke, "electronGuiSmoke", missing);
  if (!Array.isArray(pack.realEnvironments)) {
    missing.push("realEnvironments");
  } else {
    for (const environment of pack.realEnvironments) {
      if (!isObject(environment)) {
        missing.push("realEnvironments.item");
        continue;
      }
      if (!DESKTOP_PRODUCT_REAL_ENVIRONMENT_KINDS.includes(environment.kind)) {
        missing.push(`${environment.kind || "environment"}.kind`);
      }
      if (!nonEmptyString(environment.status)) missing.push(`${environment.kind || "environment"}.status`);
      if (environment.kind !== "none" && !nonEmptyString(environment.redaction)) {
        missing.push(`${environment.kind}.redaction`);
      }
    }
  }
  if (!Array.isArray(pack.rows)) {
    missing.push("rows");
  } else {
    const rowIds = new Set(pack.rows.map((row) => row?.workflow));
    for (const workflow of DESKTOP_PRODUCT_WORKFLOW_IDS) {
      if (!rowIds.has(workflow)) missing.push(`rows.${workflow}`);
    }
    for (const row of pack.rows) {
      if (!isObject(row)) {
        missing.push("rows.item");
        continue;
      }
      if (!DESKTOP_PRODUCT_WORKFLOW_IDS.includes(row.workflow)) {
        missing.push(`${row.workflow || "row"}.workflow`);
      }
      if (!DESKTOP_PRODUCT_EVIDENCE_STATUS.includes(row.status)) {
        missing.push(`${row.workflow || "row"}.status`);
      }
      if (!Array.isArray(row.automatedGates) || row.automatedGates.length === 0) {
        missing.push(`${row.workflow || "row"}.automatedGates`);
      }
      if (!nonEmptyString(row.manualEvidence)) {
        missing.push(`${row.workflow || "row"}.manualEvidence`);
      }
      if ((row.status === "partial" || row.status === "fail") && !nonEmptyString(row.knownIssue)) {
        missing.push(`${row.workflow}.knownIssue`);
      }
    }
  }
  if (!Array.isArray(pack.knownIssues)) {
    missing.push("knownIssues");
  }
  return {
    ok: missing.length === 0,
    missing
  };
}

export function buildDesktopProductEvidencePack({
  commit,
  branch,
  generatedAt = new Date().toISOString(),
  checkFast = { command: "npm run check:fast", status: "not_run", summary: "" },
  electronGuiSmoke = { command: "npm run verify:desktop-gui-smoke", status: "not_run", summary: "" },
  realEnvironments = [{ kind: "none", status: "not_run", redaction: "no live environment used" }],
  rows = [],
  knownIssues = []
} = {}) {
  const byWorkflow = new Map(rows.map((row) => [row.workflow, row]));
  return {
    schemaVersion: DESKTOP_PRODUCT_EVIDENCE_PACK_SCHEMA_VERSION,
    commit,
    branch,
    generatedAt,
    checkFast,
    electronGuiSmoke,
    realEnvironments,
    rows: DESKTOP_PRODUCT_WORKFLOW_IDS.map((workflow) => ({
      workflow,
      status: "not_run",
      automatedGates: [],
      manualEvidence: "not recorded",
      knownIssue: "",
      notes: "",
      ...(byWorkflow.get(workflow) || {})
    })),
    knownIssues
  };
}
