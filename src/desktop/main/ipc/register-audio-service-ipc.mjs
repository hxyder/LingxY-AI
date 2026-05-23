function normalizeFirstFrameTimeoutMs(value, fallback = 30_000) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1000, Math.min(30_000, Math.trunc(numeric)));
}

export function registerAudioServiceIpc({
  ipcMain,
  IPC_CHANNELS,
  getServiceBaseUrl,
  desktopActorForSender,
  postDesktopServiceBinary,
  postDesktopServiceBinaryStream
}) {
  if (!ipcMain?.handle) throw new TypeError("registerAudioServiceIpc requires ipcMain.");
  if (!IPC_CHANNELS) throw new TypeError("registerAudioServiceIpc requires IPC_CHANNELS.");
  if (typeof getServiceBaseUrl !== "function") throw new TypeError("registerAudioServiceIpc requires getServiceBaseUrl.");
  if (typeof desktopActorForSender !== "function") throw new TypeError("registerAudioServiceIpc requires desktopActorForSender.");
  if (typeof postDesktopServiceBinary !== "function") throw new TypeError("registerAudioServiceIpc requires postDesktopServiceBinary.");
  if (typeof postDesktopServiceBinaryStream !== "function") {
    throw new TypeError("registerAudioServiceIpc requires postDesktopServiceBinaryStream.");
  }

  ipcMain.handle(IPC_CHANNELS.echoKwsDetect, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    const params = new URLSearchParams();
    if (Array.isArray(payload?.keywords) && payload.keywords.length) {
      params.set("keywords", payload.keywords.map((item) => String(item ?? "").trim()).filter(Boolean).join("\n"));
    }
    const search = params.toString() ? `?${params}` : "";
    try {
      return await postDesktopServiceBinary({
        base,
        actor,
        pathname: "/echo/kws",
        search,
        body: payload?.audio,
        contentType: payload?.mimeType || "audio/webm"
      });
    } catch (error) {
      return {
        ok: false,
        error: "echo_kws_detect_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.echoKeywordEnroll, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    const params = new URLSearchParams();
    if (payload?.sample) params.set("sample", `${payload.sample}`);
    if (payload?.session) params.set("session", `${payload.session}`);
    const search = params.toString() ? `?${params}` : "";
    try {
      return await postDesktopServiceBinary({
        base,
        actor,
        pathname: "/echo/enroll-keyword",
        search,
        body: payload?.audio,
        contentType: payload?.mimeType || "audio/webm"
      });
    } catch (error) {
      return {
        ok: false,
        error: "echo_keyword_enroll_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.noteTranscribe, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    const params = new URLSearchParams();
    params.set("lang", `${payload?.lang || "auto"}`);
    if (payload?.outputLocale) params.set("output_locale", `${payload.outputLocale}`);
    try {
      return await postDesktopServiceBinary({
        base,
        actor,
        pathname: "/note/transcribe",
        search: `?${params}`,
        body: payload?.audio,
        contentType: payload?.mimeType || "audio/webm"
      });
    } catch (error) {
      return {
        ok: false,
        error: "note_transcribe_failed",
        message: error?.message ?? String(error)
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.noteTranscribeStream, async (event, payload = {}) => {
    const base = getServiceBaseUrl();
    const actor = desktopActorForSender(event.sender);
    const streamId = `${payload?.streamId ?? ""}`.trim();
    const firstFrameTimeoutMs = normalizeFirstFrameTimeoutMs(payload?.firstFrameTimeoutMs);
    const params = new URLSearchParams();
    params.set("stream", "1");
    params.set("lang", `${payload?.lang || "auto"}`);
    if (payload?.outputLocale) params.set("output_locale", `${payload.outputLocale}`);
    try {
      return await postDesktopServiceBinaryStream({
        base,
        actor,
        pathname: "/note/transcribe",
        search: `?${params}`,
        body: payload?.audio,
        contentType: payload?.mimeType || "audio/webm",
        firstFrameTimeoutMs,
        onEvent(frame) {
          event.sender.send(IPC_CHANNELS.noteTranscribeStreamEvent, {
            streamId,
            ...frame
          });
        }
      });
    } catch (error) {
      return {
        ok: false,
        error: "note_transcribe_stream_failed",
        message: error?.message ?? String(error)
      };
    }
  });
}
