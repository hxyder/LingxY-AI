import { DESKTOP_CONSOLE_ACTOR } from "./desktop-actor.mjs";

export const DESKTOP_ACTOR_HEADER = "X-Lingxy-Desktop-Actor";

export async function readServiceJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: "invalid_json_response", message: text.slice(0, 400) };
  }
}

async function fetchDesktopServiceJson(url, requestInit) {
  try {
    return await fetch(url, requestInit);
  } catch (error) {
    if (requestInit?.signal?.aborted || error?.name === "AbortError" || error?.code === "ABORT_ERR") {
      const wrapped = new Error(`Desktop service request aborted at ${url}.`);
      wrapped.code = "desktop_service_request_aborted";
      wrapped.cause = error;
      throw wrapped;
    }
    const cause = error?.cause?.code || error?.cause?.message || error?.message || "fetch_failed";
    const wrapped = new Error(`Desktop service unreachable at ${url}: ${cause}`);
    wrapped.code = "desktop_service_unreachable";
    wrapped.cause = error;
    throw wrapped;
  }
}

export async function requestDesktopServiceJson({
  base,
  pathname,
  method = "POST",
  body,
  actor = DESKTOP_CONSOLE_ACTOR
}) {
  const headers = {
    [DESKTOP_ACTOR_HEADER]: actor
  };
  const requestInit = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    requestInit.body = JSON.stringify(body ?? {});
  }
  const response = await fetchDesktopServiceJson(`${base}${pathname}`, {
    ...requestInit
  });
  const result = await readServiceJson(response);
  if (!response.ok) {
    return {
      ok: false,
      error: result.error ?? "desktop_service_request_failed",
      message: result.message ?? `Desktop service request failed with HTTP ${response.status}.`,
      status: response.status,
      ...result
    };
  }
  return result;
}

export async function postDesktopServiceJson({ base, pathname, body, actor = DESKTOP_CONSOLE_ACTOR }) {
  return requestDesktopServiceJson({ base, pathname, method: "POST", body, actor });
}

export function bufferFromIpcBinary(value) {
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value)) return Buffer.from(value);
  return Buffer.alloc(0);
}

export async function postDesktopServiceBinary({
  base,
  pathname,
  search = "",
  body,
  contentType = "application/octet-stream",
  actor = "desktop_shell"
}) {
  const response = await fetchDesktopServiceJson(`${base}${pathname}${search}`, {
    method: "POST",
    headers: {
      [DESKTOP_ACTOR_HEADER]: actor,
      "Content-Type": contentType || "application/octet-stream"
    },
    body: bufferFromIpcBinary(body)
  });
  const result = await readServiceJson(response);
  if (!response.ok) {
    return {
      ok: false,
      error: result.error ?? "desktop_service_request_failed",
      message: result.message ?? `Desktop service request failed with HTTP ${response.status}.`,
      status: response.status,
      ...result
    };
  }
  return result;
}

export async function postDesktopServiceBinaryStream({
  base,
  pathname,
  search = "",
  body,
  contentType = "application/octet-stream",
  actor = "desktop_overlay",
  firstFrameTimeoutMs = 30_000,
  onEvent
}) {
  const controller = new AbortController();
  let firstFrameTimer = null;
  let gotAnyFrame = false;
  let sawError = false;
  let assembled = "";
  let finalTranscript = "";
  const clearFirstFrameTimer = () => {
    if (firstFrameTimer) clearTimeout(firstFrameTimer);
    firstFrameTimer = null;
  };
  firstFrameTimer = setTimeout(() => controller.abort(), firstFrameTimeoutMs);
  try {
    const response = await fetchDesktopServiceJson(`${base}${pathname}${search}`, {
      method: "POST",
      headers: {
        [DESKTOP_ACTOR_HEADER]: actor,
        "Content-Type": contentType || "application/octet-stream"
      },
      body: bufferFromIpcBinary(body),
      signal: controller.signal
    });
    if (!response.ok || !response.body) {
      clearFirstFrameTimer();
      const result = await readServiceJson(response);
      return {
        ok: false,
        error: result.error ?? "note_transcribe_stream_failed",
        message: result.message ?? `Desktop service request failed with HTTP ${response.status}.`,
        status: response.status,
        ...result
      };
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLine = frame.split(/\r?\n/).find((line) => line.startsWith("data:"));
        if (!dataLine) continue;
        let event;
        try { event = JSON.parse(dataLine.slice(5).trim()); }
        catch { continue; }
        if (!gotAnyFrame) {
          gotAnyFrame = true;
          clearFirstFrameTimer();
        }
        onEvent?.(event);
        if (event.type === "segment" && event.text) {
          assembled += (assembled ? "\n" : "") + event.text;
        } else if (event.type === "done") {
          finalTranscript = `${event.transcript ?? assembled}`.trim();
        } else if (event.type === "error") {
          sawError = true;
        }
      }
    }
  } catch (error) {
    clearFirstFrameTimer();
    const timedOut = controller.signal.aborted || error?.code === "desktop_service_request_aborted" || error?.name === "AbortError";
    return {
      ok: false,
      error: timedOut ? "note_transcribe_stream_timeout" : "note_transcribe_stream_failed",
      message: timedOut ? "Timed out waiting for transcription stream." : (error?.message ?? String(error))
    };
  } finally {
    clearFirstFrameTimer();
  }
  if (!gotAnyFrame || sawError) {
    return {
      ok: false,
      error: sawError ? "note_transcribe_stream_error" : "note_transcribe_stream_empty"
    };
  }
  return {
    ok: true,
    transcript: finalTranscript || assembled
  };
}
