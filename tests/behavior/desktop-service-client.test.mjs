import test from "node:test";
import assert from "node:assert/strict";

import { requestDesktopServiceJson } from "../../src/desktop/tray/desktop-service-client.mjs";

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
