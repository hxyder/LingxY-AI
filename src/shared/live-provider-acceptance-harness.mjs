export const LIVE_PROVIDER_ACCEPTANCE_SCHEMA_VERSION = 1;

export const LIVE_PROVIDER_ACCEPTANCE_STATUSES = Object.freeze([
  "pass",
  "partial",
  "fail",
  "skipped",
  "not_run"
]);

export const LIVE_PROVIDER_ACCEPTANCE_MODES = Object.freeze([
  "dry_run",
  "live"
]);

export const LIVE_PROVIDER_ACCEPTANCE_SCENARIOS = Object.freeze([
  Object.freeze({
    id: "provider_setup_health",
    label: "Provider setup and health"
  }),
  Object.freeze({
    id: "short_text_task",
    label: "Short text task"
  }),
  Object.freeze({
    id: "model_role_routing",
    label: "Model role routing"
  }),
  Object.freeze({
    id: "token_cost_trace",
    label: "Token and cache trace"
  }),
  Object.freeze({
    id: "missing_key_recovery",
    label: "Missing key recovery"
  }),
  Object.freeze({
    id: "rate_limit_recovery",
    label: "Rate limit recovery"
  }),
  Object.freeze({
    id: "invalid_model_recovery",
    label: "Invalid model recovery"
  }),
  Object.freeze({
    id: "provider_failure_recovery",
    label: "Provider failure recovery"
  })
]);

const SCENARIO_IDS = new Set(LIVE_PROVIDER_ACCEPTANCE_SCENARIOS.map((scenario) => scenario.id));
const SECRET_LIKE_PATTERNS = Object.freeze([
  /sk-[A-Za-z0-9_-]{12,}/g,
  /sk-ant-[A-Za-z0-9_-]{12,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /(api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret)\s*[:=]\s*["']?[^"'\s,}]{6,}/gi
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeStatus(value) {
  return LIVE_PROVIDER_ACCEPTANCE_STATUSES.includes(value) ? value : "not_run";
}

function emptyUsageTrace() {
  return {
    observed: false,
    tokenUsage: {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      cache_hit_tokens: 0,
      cache_miss_tokens: 0
    },
    tokenCache: {
      cache_hit_tokens: 0,
      cache_miss_tokens: 0,
      cache_observed: false
    },
    costEstimate: {
      estimated_usd: null,
      rate_source: "not_displayed_token_trace_only"
    },
    llmUsageCallCount: 0,
    callSites: []
  };
}

export function detectLiveProviderAcceptanceSecretLeaks(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const leaks = [];
  for (const pattern of SECRET_LIKE_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      leaks.push(match[0].slice(0, 48));
    }
  }
  return leaks;
}

export function redactLiveProviderAcceptanceText(value = "") {
  let text = String(value ?? "");
  for (const pattern of SECRET_LIKE_PATTERNS) {
    pattern.lastIndex = 0;
    text = text.replace(pattern, "[REDACTED_SECRET]");
  }
  return text;
}

export function redactLiveProviderAcceptanceReport(report = {}) {
  return JSON.parse(redactLiveProviderAcceptanceText(JSON.stringify(report ?? {}, null, 2)));
}

export function buildLiveProviderAcceptanceReport({
  generatedAt = new Date().toISOString(),
  commit = "unknown",
  branch = "unknown",
  mode = "dry_run",
  liveOptIn = false,
  runtimeBaseUrl = null,
  provider = null,
  providerSetup = null,
  modelRoles = null,
  scenarios = [],
  usageTrace = null,
  redaction = "secrets, prompts, request bodies, and provider headers are omitted or redacted",
  notes = []
} = {}) {
  const byId = new Map((scenarios ?? []).map((scenario) => [scenario.id, scenario]));
  return redactLiveProviderAcceptanceReport({
    schemaVersion: LIVE_PROVIDER_ACCEPTANCE_SCHEMA_VERSION,
    generatedAt,
    commit,
    branch,
    mode: LIVE_PROVIDER_ACCEPTANCE_MODES.includes(mode) ? mode : "dry_run",
    liveOptIn: liveOptIn === true,
    runtimeBaseUrl,
    provider,
    providerSetup,
    modelRoles,
    usageTrace: usageTrace ?? emptyUsageTrace(),
    scenarios: LIVE_PROVIDER_ACCEPTANCE_SCENARIOS.map((scenario) => ({
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

export function validateLiveProviderAcceptanceReport(report = {}) {
  const missing = [];
  if (!isObject(report)) missing.push("report");
  if (report.schemaVersion !== LIVE_PROVIDER_ACCEPTANCE_SCHEMA_VERSION) missing.push("schemaVersion");
  if (!nonEmptyString(report.generatedAt)) missing.push("generatedAt");
  if (!nonEmptyString(report.commit)) missing.push("commit");
  if (!nonEmptyString(report.branch)) missing.push("branch");
  if (!LIVE_PROVIDER_ACCEPTANCE_MODES.includes(report.mode)) missing.push("mode");
  if (typeof report.liveOptIn !== "boolean") missing.push("liveOptIn");
  if (!nonEmptyString(report.redaction)) missing.push("redaction");
  if (!isObject(report.usageTrace)) {
    missing.push("usageTrace");
  } else {
    if (typeof report.usageTrace.observed !== "boolean") missing.push("usageTrace.observed");
    if (!isObject(report.usageTrace.tokenUsage)) missing.push("usageTrace.tokenUsage");
    if (!isObject(report.usageTrace.tokenCache)) missing.push("usageTrace.tokenCache");
    if (!isObject(report.usageTrace.costEstimate)) missing.push("usageTrace.costEstimate");
    if (!Array.isArray(report.usageTrace.callSites)) missing.push("usageTrace.callSites");
  }
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
      if (!LIVE_PROVIDER_ACCEPTANCE_STATUSES.includes(scenario.status)) {
        missing.push(`${scenario.id || "scenario"}.status`);
      }
      if (["pass", "partial", "fail"].includes(normalizeStatus(scenario.status))) {
        if (!nonEmptyString(scenario.command)) missing.push(`${scenario.id}.command`);
        if (!nonEmptyString(scenario.evidence)) missing.push(`${scenario.id}.evidence`);
      }
      if (/recovery$/u.test(String(scenario.id ?? "")) && scenario.status !== "not_run") {
        if (!nonEmptyString(scenario.recovery)) missing.push(`${scenario.id}.recovery`);
      }
    }
  }
  if (report.mode === "live") {
    if (report.liveOptIn !== true) missing.push("liveOptIn");
    if (!isObject(report.provider)) missing.push("provider");
    if (!isObject(report.providerSetup)) missing.push("providerSetup");
    if (!isObject(report.modelRoles)) missing.push("modelRoles");
  }
  const leaks = detectLiveProviderAcceptanceSecretLeaks(report);
  return {
    ok: missing.length === 0 && leaks.length === 0,
    missing,
    leaks
  };
}
