export function classifyAudioInputError(error) {
  const name = `${error?.name ?? ""}`.toLowerCase();
  const message = `${error?.message ?? error ?? ""}`.toLowerCase();
  if (name === "notallowederror" || name === "permissiondeniederror") {
    return "permission_denied";
  }
  if (name === "notfounderror" || name === "devicesnotfounderror") {
    return "no_device";
  }
  if (message.includes("getusermedia_timeout")) {
    return "timeout";
  }
  return "init_failed";
}

function stopStream(stream) {
  for (const track of stream?.getTracks?.() ?? []) {
    try { track.stop?.(); } catch { /* ignore late cleanup failures */ }
  }
}

export async function requestAudioInputStream({
  mediaDevices,
  permissions,
  timeoutMs = 5000,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout
} = {}) {
  if (typeof mediaDevices?.getUserMedia !== "function") {
    return { ok: false, code: "unsupported" };
  }

  try {
    const permission = await permissions?.query?.({ name: "microphone" });
    if (permission?.state === "denied") {
      return { ok: false, code: "permission_denied_preflight" };
    }
  } catch {
    // Some Chromium/Electron builds do not expose microphone permission query
    // from renderer context. The browser prompt is still owned by getUserMedia.
  }

  let timeoutId = null;
  let timedOut = false;
  const streamRequest = Promise.resolve()
    .then(() => mediaDevices.getUserMedia({ audio: true }))
    .then((stream) => {
      if (timedOut) {
        stopStream(stream);
      }
      return { ok: true, stream };
    })
    .catch((error) => ({
      ok: false,
      code: classifyAudioInputError(error),
      error
    }));

  const timeout = new Promise((resolve) => {
    timeoutId = setTimeoutFn(() => {
      timedOut = true;
      resolve({
        ok: false,
        code: "timeout",
        error: new Error("getUserMedia_timeout")
      });
    }, timeoutMs);
  });

  const result = await Promise.race([streamRequest, timeout]);
  if (timeoutId != null && !timedOut) {
    clearTimeoutFn(timeoutId);
  }
  return result;
}

