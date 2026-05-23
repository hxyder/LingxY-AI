export const CONNECTOR_OAUTH_ACCEPTANCE_SCHEMA_VERSION = 1;

export const CONNECTOR_OAUTH_ACCEPTANCE_PROVIDERS = Object.freeze(["google", "microsoft"]);

export const CONNECTOR_OAUTH_ACCEPTANCE_STATUSES = Object.freeze([
  "pass",
  "partial",
  "fail",
  "skipped",
  "not_run"
]);

export const CONNECTOR_OAUTH_ACCEPTANCE_MODES = Object.freeze(["dry_run", "live"]);

export const CONNECTOR_OAUTH_ACCEPTANCE_SCENARIOS = Object.freeze([
  Object.freeze({ id: "connector_catalog", label: "Connector catalog" }),
  Object.freeze({ id: "oauth_config_and_start", label: "OAuth config and start" }),
  Object.freeze({ id: "oauth_callback_connect", label: "OAuth callback connect" }),
  Object.freeze({ id: "connected_accounts", label: "Connected accounts" }),
  Object.freeze({ id: "token_refresh", label: "Token refresh" }),
  Object.freeze({ id: "read_lists", label: "Mail/files/calendar list" }),
  Object.freeze({ id: "guarded_side_effect", label: "Guarded side effect" }),
  Object.freeze({ id: "disconnect_recovery", label: "Disconnect and recovery" }),
  Object.freeze({ id: "auth_permission_recovery", label: "Auth and permission recovery" })
]);

const SCENARIO_IDS = new Set(CONNECTOR_OAUTH_ACCEPTANCE_SCENARIOS.map((scenario) => scenario.id));
const SECRET_LIKE_PATTERNS = Object.freeze([
  /ya29\.[A-Za-z0-9._-]{12,}/g,
  /eyJ[A-Za-z0-9._-]{20,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /(access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|authorization|password|secret)\s*[:=]\s*["']?[^"'\s,}]{6,}/gi
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function detectConnectorOAuthAcceptanceSecretLeaks(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const leaks = [];
  for (const pattern of SECRET_LIKE_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) leaks.push(match[0].slice(0, 48));
  }
  return leaks;
}

export function redactConnectorOAuthAcceptanceText(value = "") {
  let text = String(value ?? "");
  for (const pattern of SECRET_LIKE_PATTERNS) {
    pattern.lastIndex = 0;
    text = text.replace(pattern, "[REDACTED_SECRET]");
  }
  return text;
}

export function redactConnectorOAuthAcceptanceReport(report = {}) {
  return JSON.parse(redactConnectorOAuthAcceptanceText(JSON.stringify(report ?? {}, null, 2)));
}

export function buildConnectorOAuthAcceptanceReport({
  generatedAt = new Date().toISOString(),
  commit = "unknown",
  branch = "unknown",
  mode = "dry_run",
  liveOptIn = false,
  runtimeBaseUrl = null,
  providers = CONNECTOR_OAUTH_ACCEPTANCE_PROVIDERS.map((provider) => ({
    provider,
    configured: false,
    connected: false,
    accountCount: 0
  })),
  scenarios = [],
  sideEffects = {
    allowed: false,
    executed: false,
    approval: "not_requested"
  },
  redaction = "tokens, OAuth codes, auth headers, message bodies, file contents, and personal data are omitted or redacted",
  notes = []
} = {}) {
  const byId = new Map((scenarios ?? []).map((scenario) => [scenario.id, scenario]));
  return redactConnectorOAuthAcceptanceReport({
    schemaVersion: CONNECTOR_OAUTH_ACCEPTANCE_SCHEMA_VERSION,
    generatedAt,
    commit,
    branch,
    mode: CONNECTOR_OAUTH_ACCEPTANCE_MODES.includes(mode) ? mode : "dry_run",
    liveOptIn: liveOptIn === true,
    runtimeBaseUrl,
    providers,
    sideEffects,
    scenarios: CONNECTOR_OAUTH_ACCEPTANCE_SCENARIOS.map((scenario) => ({
      id: scenario.id,
      label: scenario.label,
      status: "not_run",
      command: "",
      evidence: "",
      recovery: "",
      notes: "",
      ...(byId.get(scenario.id) ?? {})
    })),
    redaction,
    notes
  });
}

export function validateConnectorOAuthAcceptanceReport(report = {}) {
  const missing = [];
  if (!isObject(report)) missing.push("report");
  if (report.schemaVersion !== CONNECTOR_OAUTH_ACCEPTANCE_SCHEMA_VERSION) missing.push("schemaVersion");
  if (!nonEmptyString(report.generatedAt)) missing.push("generatedAt");
  if (!nonEmptyString(report.commit)) missing.push("commit");
  if (!nonEmptyString(report.branch)) missing.push("branch");
  if (!CONNECTOR_OAUTH_ACCEPTANCE_MODES.includes(report.mode)) missing.push("mode");
  if (typeof report.liveOptIn !== "boolean") missing.push("liveOptIn");
  if (!nonEmptyString(report.redaction)) missing.push("redaction");
  if (!Array.isArray(report.providers)) {
    missing.push("providers");
  } else {
    const providers = new Set(report.providers.map((provider) => provider?.provider));
    for (const provider of CONNECTOR_OAUTH_ACCEPTANCE_PROVIDERS) {
      if (!providers.has(provider)) missing.push(`providers.${provider}`);
    }
  }
  if (!isObject(report.sideEffects)) missing.push("sideEffects");
  if (!Array.isArray(report.scenarios)) {
    missing.push("scenarios");
  } else {
    const ids = new Set(report.scenarios.map((scenario) => scenario?.id));
    for (const id of SCENARIO_IDS) {
      if (!ids.has(id)) missing.push(`scenarios.${id}`);
    }
    for (const scenario of report.scenarios) {
      if (!isObject(scenario)) {
        missing.push("scenarios.item");
        continue;
      }
      if (!SCENARIO_IDS.has(scenario.id)) missing.push(`${scenario.id || "scenario"}.id`);
      if (!CONNECTOR_OAUTH_ACCEPTANCE_STATUSES.includes(scenario.status)) {
        missing.push(`${scenario.id || "scenario"}.status`);
      }
      if (["pass", "partial", "fail"].includes(scenario.status)) {
        if (!nonEmptyString(scenario.command)) missing.push(`${scenario.id}.command`);
        if (!nonEmptyString(scenario.evidence)) missing.push(`${scenario.id}.evidence`);
      }
      if (/recovery$/u.test(String(scenario.id ?? "")) && scenario.status !== "not_run") {
        if (!nonEmptyString(scenario.recovery)) missing.push(`${scenario.id}.recovery`);
      }
    }
  }
  if (report.mode === "live" && report.liveOptIn !== true) missing.push("liveOptIn");
  const leaks = detectConnectorOAuthAcceptanceSecretLeaks(report);
  return {
    ok: missing.length === 0 && leaks.length === 0,
    missing,
    leaks
  };
}
