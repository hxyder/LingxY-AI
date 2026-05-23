import test from "node:test";
import assert from "node:assert/strict";

import { isRemoteFeatureEnabled } from "../../src/desktop/tray/desktop-remote-features.mjs";

test("remote feature helper preserves explicit disabled config", async () => {
  const enabled = await isRemoteFeatureEnabled({
    serviceBaseUrl: "http://127.0.0.1:4310",
    featureId: "active_window_probe",
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          config: {
            features: {
              active_window_probe: { enabled: false }
            }
          }
        };
      }
    })
  });

  assert.equal(enabled, false);
});

test("remote feature helper keeps default-enabled desktop features on health gaps", async () => {
  const rejected = await isRemoteFeatureEnabled({
    serviceBaseUrl: "http://127.0.0.1:4310",
    featureId: "active_window_probe",
    fetchImpl: async () => {
      throw new Error("runtime still booting");
    }
  });
  const unavailable = await isRemoteFeatureEnabled({
    serviceBaseUrl: "http://127.0.0.1:4310",
    featureId: "active_window_probe",
    fetchImpl: async () => ({ ok: false, async json() { return {}; } })
  });

  assert.equal(rejected, true);
  assert.equal(unavailable, true);
});

test("remote feature helper can still fail closed for opt-in features", async () => {
  const enabled = await isRemoteFeatureEnabled({
    serviceBaseUrl: "http://127.0.0.1:4310",
    featureId: "some_opt_in_feature",
    defaultEnabled: false,
    fetchImpl: async () => {
      throw new Error("runtime still booting");
    }
  });

  assert.equal(enabled, false);
});
