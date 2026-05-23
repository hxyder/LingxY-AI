const DEFAULT_READ_PROBE_TTL_MS = 5_000;

function normalizePositiveMs(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function cloneProbeResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return { ...value };
}

export function createReadProbeCache({
  probe,
  ttlMs = DEFAULT_READ_PROBE_TTL_MS,
  now = () => Date.now()
} = {}) {
  if (typeof probe !== "function") {
    throw new TypeError("createReadProbeCache requires a probe function");
  }
  const ttl = normalizePositiveMs(ttlMs, DEFAULT_READ_PROBE_TTL_MS);
  let cached = null;
  let inFlight = null;

  return async function readProbe() {
    const currentTime = Number(now());
    if (cached && cached.expiresAt > currentTime) {
      return cloneProbeResult(cached.value);
    }
    if (inFlight) {
      return cloneProbeResult(await inFlight);
    }
    inFlight = Promise.resolve()
      .then(() => probe())
      .then((value) => {
        cached = {
          value,
          expiresAt: Number(now()) + ttl
        };
        return value;
      })
      .finally(() => {
        inFlight = null;
      });
    return cloneProbeResult(await inFlight);
  };
}

