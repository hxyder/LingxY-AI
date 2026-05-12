export const SANDBOX_EVIDENCE_PACK_SCHEMA_VERSION = 1;

export const SANDBOX_EVIDENCE_SURFACE_IDS = Object.freeze([
  "file_mutation",
  "command_execution",
  "mcp_install",
  "ocr",
  "browser_automation",
  "audio_daemon"
]);

export const SANDBOX_EVIDENCE_STATUSES = Object.freeze([
  "pass",
  "partial",
  "fail",
  "not_run"
]);

const SECRET_LIKE_PATTERNS = Object.freeze([
  /Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /(api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret)\s*[:=]\s*["']?[^"'\s,}]{6,}/gi
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function detectSandboxEvidenceSecretLeaks(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const leaks = [];
  for (const pattern of SECRET_LIKE_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) leaks.push(match[0].slice(0, 48));
  }
  return leaks;
}

export function redactSandboxEvidenceText(value = "") {
  let text = String(value ?? "");
  for (const pattern of SECRET_LIKE_PATTERNS) {
    pattern.lastIndex = 0;
    text = text.replace(pattern, "[REDACTED_SECRET]");
  }
  return text;
}

export function redactSandboxEvidencePack(pack = {}) {
  return JSON.parse(redactSandboxEvidenceText(JSON.stringify(pack ?? {}, null, 2)));
}

export function buildSandboxEvidencePack({
  generatedAt = new Date().toISOString(),
  commit = "unknown",
  branch = "unknown",
  boundaryChange = false,
  surfaces = [],
  redaction = "secrets, tokens, auth headers, local private paths, and file contents are omitted or redacted",
  notes = []
} = {}) {
  const byId = new Map((surfaces ?? []).map((surface) => [surface.id, surface]));
  return redactSandboxEvidencePack({
    schemaVersion: SANDBOX_EVIDENCE_PACK_SCHEMA_VERSION,
    generatedAt,
    commit,
    branch,
    boundaryChange: boundaryChange === true,
    redaction,
    surfaces: SANDBOX_EVIDENCE_SURFACE_IDS.map((id) => ({
      id,
      status: "not_run",
      command: "",
      evidence: "",
      measured: false,
      mitigation: "",
      notes: "",
      ...(byId.get(id) ?? {})
    })),
    notes
  });
}

export function validateSandboxEvidencePack(pack = {}) {
  const missing = [];
  if (!isObject(pack)) missing.push("pack");
  if (pack.schemaVersion !== SANDBOX_EVIDENCE_PACK_SCHEMA_VERSION) missing.push("schemaVersion");
  if (!nonEmptyString(pack.generatedAt)) missing.push("generatedAt");
  if (!nonEmptyString(pack.commit)) missing.push("commit");
  if (!nonEmptyString(pack.branch)) missing.push("branch");
  if (pack.boundaryChange !== false) missing.push("boundaryChange");
  if (!nonEmptyString(pack.redaction)) missing.push("redaction");
  if (!Array.isArray(pack.surfaces)) {
    missing.push("surfaces");
  } else {
    const ids = new Set(pack.surfaces.map((surface) => surface?.id));
    for (const id of SANDBOX_EVIDENCE_SURFACE_IDS) {
      if (!ids.has(id)) missing.push(`surfaces.${id}`);
    }
    for (const surface of pack.surfaces) {
      if (!isObject(surface)) {
        missing.push("surfaces.item");
        continue;
      }
      if (!SANDBOX_EVIDENCE_SURFACE_IDS.includes(surface.id)) missing.push(`${surface.id || "surface"}.id`);
      if (!SANDBOX_EVIDENCE_STATUSES.includes(surface.status)) missing.push(`${surface.id || "surface"}.status`);
      if (surface.status !== "not_run") {
        if (!nonEmptyString(surface.command)) missing.push(`${surface.id}.command`);
        if (!nonEmptyString(surface.evidence)) missing.push(`${surface.id}.evidence`);
        if (typeof surface.measured !== "boolean") missing.push(`${surface.id}.measured`);
        if (!nonEmptyString(surface.mitigation)) missing.push(`${surface.id}.mitigation`);
      }
    }
  }
  const leaks = detectSandboxEvidenceSecretLeaks(pack);
  return {
    ok: missing.length === 0 && leaks.length === 0,
    missing,
    leaks
  };
}
