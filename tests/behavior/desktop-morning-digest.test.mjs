import test from "node:test";
import assert from "node:assert/strict";

import { requestMorningDigestCheck } from "../../src/desktop/tray/desktop-morning-digest.mjs";

test("morning digest startup check skips when the desktop service is not healthy", async () => {
  const warnings = [];
  let requested = false;
  const result = await requestMorningDigestCheck({
    serviceBaseUrl: "http://127.0.0.1:4310",
    waitForHealthy: async () => false,
    requestDesktopServiceJson: async () => {
      requested = true;
      return { ok: true };
    },
    safeWarn: (...args) => warnings.push(args)
  });

  assert.deepEqual(result, {
    ok: false,
    skipped: true,
    reason: "service_unavailable",
    base: "http://127.0.0.1:4310"
  });
  assert.equal(requested, false);
  assert.deepEqual(warnings, []);
});

test("morning digest startup check posts after the desktop service is healthy", async () => {
  const request = [];
  const result = await requestMorningDigestCheck({
    serviceBaseUrl: "http://127.0.0.1:4310",
    waitForHealthy: async () => true,
    requestDesktopServiceJson: async (payload) => {
      request.push(payload);
      return { ok: true, sent: false, reason: "feature_disabled" };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.reason, "feature_disabled");
  assert.equal(request.length, 1);
  assert.equal(request[0].base, "http://127.0.0.1:4310");
  assert.equal(request[0].actor, "desktop_shell");
  assert.equal(request[0].method, "POST");
  assert.equal(request[0].pathname, "/email/digest/check");
});

test("morning digest startup check reports structured failures after healthy preflight", async () => {
  const warnings = [];
  const result = await requestMorningDigestCheck({
    waitForHealthy: async () => true,
    requestDesktopServiceJson: async () => {
      throw new Error("Desktop service unreachable at http://127.0.0.1:4310/email/digest/check: ECONNREFUSED");
    },
    safeWarn: (...args) => warnings.push(args)
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "morning_digest_check_failed");
  assert.match(result.message, /Desktop service unreachable/);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][0], "Morning digest check failed");
  assert.match(warnings[0][1], /Desktop service unreachable/);
});
