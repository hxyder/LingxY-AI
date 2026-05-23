// Minimal SSE reader for the extension side.
//
// MV3 service workers have a global fetch() with ReadableStream support,
// which is reliable across Chrome versions. We intentionally avoid
// EventSource — it doesn't carry custom headers and restarts on connection
// loss in ways that don't fit a one-task stream.
//
// Returns an async iterable of parsed frames { event, data } so callers can
// stop iterating early (e.g. on "success") without forcing abort plumbing.

export async function* readSseFrames(url, { signal } = {}) {
  const response = await fetch(url, {
    method: "GET",
    headers: { "Accept": "text/event-stream" },
    signal
  });
  if (!response.ok || !response.body) {
    throw new Error(`sse_http_${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary;
      // SSE frames are separated by a blank line ("\n\n"). Some servers
      // emit "\r\n\r\n" on Windows proxies; handle both.
      while ((boundary = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const rawFrame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + (buffer[boundary] === "\r" ? 4 : 2));
        const parsed = parseFrame(rawFrame);
        if (parsed) yield parsed;
      }
    }
    if (buffer.trim()) {
      const parsed = parseFrame(buffer);
      if (parsed) yield parsed;
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
}

function parseFrame(raw) {
  let event = "message";
  const dataLines = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^\s/, ""));
    }
  }
  if (dataLines.length === 0) return null;
  const dataText = dataLines.join("\n");
  let data = dataText;
  if (dataText.startsWith("{") || dataText.startsWith("[")) {
    try { data = JSON.parse(dataText); } catch { /* keep raw */ }
  }
  return { event, data };
}

// Helper: consume the task-event SSE until the task reaches a terminal state
// or the caller aborts. Returns { ok, text, status, error }.
export async function runTaskWithStream(taskDetailUrl, { signal, onFrame } = {}) {
  let lastInlineText = "";
  try {
    for await (const frame of readSseFrames(`${taskDetailUrl}/events`, { signal })) {
      try { onFrame?.(frame); } catch { /* observability only */ }
      const event = frame.event ?? frame.data?.event_type ?? "";
      const payload = frame.data?.payload ?? frame.data ?? {};
      if ((event === "inline_result" || event === "success") && typeof payload.text === "string" && payload.text.length > 0) {
        lastInlineText = payload.text;
      }
      const status = payload.status ?? frame.data?.status;
      if (status === "success" || status === "partial_success") {
        return { ok: true, text: lastInlineText || payload.text || "(无内容)", status };
      }
      if (status === "failed" || status === "cancelled") {
        return { ok: false, error: payload.failure_user_message ?? status, status };
      }
    }
  } catch (error) {
    return { ok: false, error: `stream_error:${error?.message ?? error}` };
  }
  // Stream closed without a terminal event — fall back to polling the detail
  // endpoint once to see if the task completed between frames.
  return { ok: false, error: "stream_ended_without_terminal", text: lastInlineText };
}
