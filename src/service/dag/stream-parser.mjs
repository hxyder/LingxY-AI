/**
 * Streaming helpers.
 *
 * Two small independent parsers that together turn a ReadableStream of SSE
 * frames from an OpenAI-style chat completion into a sequence of parsed
 * JSON objects as soon as the LLM finishes each one.
 *
 *   HTTP chunk → SseContentReader → text deltas  → JsonLinesParser → objects
 *
 * Neither parser knows anything about DAG semantics. That's the streaming
 * executor's job.
 */

/**
 * Accumulates text deltas from an SSE stream and yields each complete line
 * the moment its terminating newline lands. Partial lines stay in the
 * buffer across feed() calls; flush() emits whatever is left (mostly used
 * when the stream ends without a trailing newline).
 */
export function createJsonLinesParser({ onLine, onError } = {}) {
  let buffer = "";

  function parseLine(raw) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (trimmed.startsWith("//") || trimmed.startsWith("#")) return; // comment-ish noise
    // Strip code fences if the LLM inserted them despite the instruction.
    if (trimmed === "```" || /^```(json)?$/i.test(trimmed)) return;
    try {
      const parsed = JSON.parse(trimmed);
      onLine?.(parsed, trimmed);
    } catch (error) {
      onError?.({ line: trimmed, error });
    }
  }

  return {
    feed(chunk) {
      buffer += String(chunk ?? "");
      while (true) {
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex < 0) break;
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        parseLine(line);
      }
    },
    flush() {
      if (buffer.length > 0) {
        parseLine(buffer);
        buffer = "";
      }
    },
    get pendingBufferLength() { return buffer.length; }
  };
}

/**
 * OpenAI / DeepSeek / Ollama-compatible SSE reader. Expects lines like
 *   data: {"choices":[{"delta":{"content":"..."}}]}
 *   data: [DONE]
 * Extracts the `choices[0].delta.content` text deltas and yields them
 * concatenated to onDelta(). Anthropic uses a different event structure
 * (`event: content_block_delta\ndata: {"type":"content_block_delta",...}`)
 * and isn't wired here — streaming providers can be added incrementally.
 */
export async function readOpenAiStyleSseStream(response, { onDelta, onError } = {}) {
  if (!response?.body) {
    throw new Error("response has no readable body");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const frameEnd = buffer.indexOf("\n\n");
        if (frameEnd < 0) break;
        const frame = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + 2);
        for (const rawLine of frame.split("\n")) {
          const line = rawLine.trim();
          if (!line.startsWith("data:")) continue;
          const payload = line.slice("data:".length).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const chunk = JSON.parse(payload);
            const delta = chunk.choices?.[0]?.delta?.content
              ?? chunk.choices?.[0]?.message?.content
              ?? "";
            if (delta) onDelta?.(delta);
          } catch (error) {
            onError?.({ line: payload, error });
          }
        }
      }
    }
    // Any remaining buffered frame (no trailing \n\n) → try to parse.
    if (buffer.trim()) {
      for (const rawLine of buffer.split("\n")) {
        const line = rawLine.trim();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice("data:".length).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const chunk = JSON.parse(payload);
          const delta = chunk.choices?.[0]?.delta?.content ?? "";
          if (delta) onDelta?.(delta);
        } catch { /* ignore final partial */ }
      }
    }
  } finally {
    try { reader.releaseLock?.(); } catch { /* ignore */ }
  }
}
