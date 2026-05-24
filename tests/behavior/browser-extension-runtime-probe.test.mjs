import assert from "node:assert/strict";
import test from "node:test";

import {
  invalidateDesktopProbe,
  isDesktopAvailable
} from "../../browser_ext/background/standalone-client.js";

test("desktop runtime probe cache is keyed by runtime URL", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).startsWith("http://stale.local:9999/")) {
      throw new Error("configured runtime is stale");
    }
    return { ok: true };
  };

  try {
    invalidateDesktopProbe();
    assert.equal(await isDesktopAvailable("http://stale.local:9999"), false);
    assert.equal(await isDesktopAvailable("http://127.0.0.1:4310"), true);
    assert.deepEqual(calls, [
      "http://stale.local:9999/health",
      "http://127.0.0.1:4310/health"
    ]);

    assert.equal(await isDesktopAvailable("http://127.0.0.1:4310"), true);
    assert.equal(calls.length, 2, "successful default runtime probe should be cached separately");
  } finally {
    invalidateDesktopProbe();
    if (originalFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = originalFetch;
  }
});
