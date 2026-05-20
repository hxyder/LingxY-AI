import test from "node:test";
import assert from "node:assert/strict";

import {
  postDesktopServiceBinaryStream,
  requestDesktopServiceJson
} from "../../src/desktop/tray/desktop-service-client.mjs";

test("desktop service client normalizes fetch failures with endpoint context", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw Object.assign(new Error("fetch failed"), {
      cause: { code: "ECONNREFUSED" }
    });
  };
  try {
    await assert.rejects(
      () => requestDesktopServiceJson({
        base: "http://127.0.0.1:4310",
        pathname: "/email/digest/check",
        method: "POST",
        body: {}
      }),
      (error) => {
        assert.equal(error.code, "desktop_service_unreachable");
        assert.match(error.message, /Desktop service unreachable/);
        assert.match(error.message, /\/email\/digest\/check/);
        assert.match(error.message, /ECONNREFUSED/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("desktop service streaming bridge reports first-frame aborts as transcription timeouts", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init = {}) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => {
      reject(Object.assign(new Error("The operation was aborted."), { name: "AbortError" }));
    }, { once: true });
  });
  try {
    const result = await postDesktopServiceBinaryStream({
      base: "http://127.0.0.1:4310",
      pathname: "/note/transcribe",
      search: "?stream=1",
      body: new Uint8Array([1, 2, 3]),
      contentType: "audio/webm",
      firstFrameTimeoutMs: 1
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, "note_transcribe_stream_timeout");
    assert.match(result.message, /Timed out waiting for transcription stream/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
