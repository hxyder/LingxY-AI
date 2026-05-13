import { waitForServiceHealth } from "./desktop-service-runtime.mjs";

export async function requestMorningDigestCheck({
  serviceBaseUrl,
  requestDesktopServiceJson,
  safeWarn,
  waitForHealthy = waitForServiceHealth,
  healthTimeoutMs = 5000
} = {}) {
  if (typeof requestDesktopServiceJson !== "function") return { ok: false, skipped: true, reason: "request_bridge_unavailable" };
  const base = serviceBaseUrl ?? "http://127.0.0.1:4310";
  const healthy = await waitForHealthy(() => base, { timeoutMs: healthTimeoutMs });
  if (!healthy) {
    return { ok: false, skipped: true, reason: "service_unavailable", base };
  }
  try {
    return await requestDesktopServiceJson({
      base,
      actor: "desktop_shell",
      method: "POST",
      pathname: "/email/digest/check",
      body: {}
    });
  } catch (error) {
    safeWarn?.("Morning digest check failed", error?.message ?? error);
    return {
      ok: false,
      error: "morning_digest_check_failed",
      message: error?.message ?? String(error)
    };
  }
}
