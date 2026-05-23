export async function isRemoteFeatureEnabled({
  serviceBaseUrl,
  featureId,
  fetchImpl = globalThis.fetch,
  timeoutMs = 2000,
  defaultEnabled = true
} = {}) {
  if (!featureId) return false;
  const fallback = Boolean(defaultEnabled);
  if (typeof fetchImpl !== "function") return fallback;
  try {
    const response = await fetchImpl(`${serviceBaseUrl}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return fallback;
    const payload = await response.json();
    return payload?.config?.features?.[featureId]?.enabled !== false;
  } catch {
    // Local desktop features should not turn off just because the runtime is
    // still booting or temporarily unreachable. Explicit config `false` above
    // still wins whenever health is available.
    return fallback;
  }
}
