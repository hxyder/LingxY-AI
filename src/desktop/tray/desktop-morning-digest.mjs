export async function requestMorningDigestCheck({
  serviceBaseUrl,
  requestDesktopServiceJson,
  safeWarn
} = {}) {
  if (typeof fetch !== "function") {
    return;
  }
  try {
    await requestDesktopServiceJson({
      base: serviceBaseUrl ?? "http://127.0.0.1:4310",
      actor: "desktop_shell",
      method: "POST",
      pathname: "/email/digest/check",
      body: {}
    });
  } catch (error) {
    safeWarn?.("Morning digest check failed", error?.message ?? error);
  }
}
