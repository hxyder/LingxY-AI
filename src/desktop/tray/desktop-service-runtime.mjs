export function servicePortFromUrl(urlValue) {
  try {
    const parsed = new URL(urlValue);
    return parsed.port ? Number(parsed.port) : (parsed.protocol === "https:" ? 443 : 80);
  } catch {
    return 4310;
  }
}

export function shouldHostEmbeddedService(urlValue, { env = process.env } = {}) {
  if (env?.LINGXY_DESKTOP_DISABLE_EMBEDDED_SERVICE === "1") {
    return false;
  }
  try {
    const parsed = new URL(urlValue);
    return ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

export async function serviceIsHealthy(baseUrl, { fetchImpl = globalThis.fetch, timeoutMs = 1000 } = {}) {
  if (typeof fetchImpl !== "function") return false;
  try {
    const response = await fetchImpl(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(timeoutMs)
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function waitForServiceHealth(getBaseUrl, {
  isHealthy = serviceIsHealthy,
  timeoutMs = 5000,
  intervalMs = 250
} = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isHealthy(getBaseUrl())) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}
