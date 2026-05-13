export const NETWORK_OTEL_DEFAULT_TIMEOUT_MS = 3000;
export const NETWORK_OTEL_DEFAULT_MAX_QUEUE_SIZE = 100;
export const NETWORK_OTEL_DEFAULT_BATCH_SIZE = 8;
export const NETWORK_OTEL_MAX_ENDPOINT_LENGTH = 500;

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function sanitizeNetworkOtelEndpoint(value = "") {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.length > NETWORK_OTEL_MAX_ENDPOINT_LENGTH) return "";
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.username = "";
    url.password = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function positiveInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

export function normalizeNetworkOtelConfig(config = {}) {
  const raw = asObject(config.observability?.networkOtel);
  const consent = asObject(raw.consent);
  const endpoint = sanitizeNetworkOtelEndpoint(raw.endpoint);
  const consentAccepted = raw.consentAccepted === true || consent.accepted === true;
  const enabled = raw.enabled === true && consentAccepted === true;
  return {
    enabled,
    active: enabled && Boolean(endpoint),
    endpoint,
    consent: {
      accepted: consentAccepted,
      acceptedAt: typeof consent.acceptedAt === "string" ? consent.acceptedAt : null
    },
    redaction: "summary_only_no_raw_payloads",
    timeoutMs: positiveInt(raw.timeoutMs, NETWORK_OTEL_DEFAULT_TIMEOUT_MS, { min: 500, max: 15000 }),
    maxQueueSize: positiveInt(raw.maxQueueSize, NETWORK_OTEL_DEFAULT_MAX_QUEUE_SIZE, { min: 1, max: 500 }),
    batchSize: positiveInt(raw.batchSize, NETWORK_OTEL_DEFAULT_BATCH_SIZE, { min: 1, max: 25 })
  };
}
