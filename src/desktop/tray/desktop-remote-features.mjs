export async function isRemoteFeatureEnabled({
  serviceBaseUrl,
  featureId,
  fetchImpl = globalThis.fetch,
  timeoutMs = 2000
} = {}) {
  if (!featureId) return false;
  if (typeof fetchImpl !== "function") return false;
  try {
    const response = await fetchImpl(`${serviceBaseUrl}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return false;
    const payload = await response.json();
    return payload?.config?.features?.[featureId]?.enabled !== false;
  } catch {
    // Network error or timeout: default to disabled to avoid silently enabling features.
    return false;
  }
}
