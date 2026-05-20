import assert from "node:assert/strict";
import test from "node:test";

import {
  shouldHostEmbeddedService
} from "../../src/desktop/tray/desktop-service-runtime.mjs";

test("desktop service host embeds only local runtime urls by default", () => {
  assert.equal(shouldHostEmbeddedService("http://127.0.0.1:4310", { env: {} }), true);
  assert.equal(shouldHostEmbeddedService("http://localhost:4310", { env: {} }), true);
  assert.equal(shouldHostEmbeddedService("http://example.com:4310", { env: {} }), false);
  assert.equal(shouldHostEmbeddedService("not a url", { env: {} }), false);
});

test("start-desktop can disable Electron embedded runtime hosting", () => {
  assert.equal(shouldHostEmbeddedService("http://127.0.0.1:4310", {
    env: { LINGXY_DESKTOP_DISABLE_EMBEDDED_SERVICE: "1" }
  }), false);
});
