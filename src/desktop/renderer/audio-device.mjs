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

export function describeAudioInputFailure(result = {}) {
  const code = result?.code ?? "init_failed";
  const error = result?.error;
  if (code === "unsupported") {
    return "当前环境无法访问麦克风接口。";
  }
  if (code === "permission_denied_preflight") {
    return "麦克风权限已被系统拒绝。请到系统设置 → 隐私 → 麦克风 允许此应用访问后重试。";
  }
  if (code === "timeout") {
    return "麦克风启动超时——请检查系统麦克风权限，或重启 UCA 后重试。";
  }
  if (code === "permission_denied") {
    return "麦克风权限被拒绝。请在系统设置 → 隐私 → 麦克风 中允许此应用访问，然后重试。";
  }
  if (code === "no_device") {
    return "未检测到可用的麦克风。请确认设备已连接后重试。";
  }
  return `麦克风初始化失败：${error?.message ?? error ?? "未知错误"}`;
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
