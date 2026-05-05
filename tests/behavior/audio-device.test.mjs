import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyAudioInputError,
  requestAudioInputStream
} from "../../src/desktop/renderer/audio-device.mjs";

test("audio input request reports unsupported browsers without touching permissions", async () => {
  let permissionQueried = false;
  const result = await requestAudioInputStream({
    mediaDevices: {},
    permissions: {
      async query() {
        permissionQueried = true;
      }
    }
  });

  assert.deepEqual(result, { ok: false, code: "unsupported" });
  assert.equal(permissionQueried, false);
});

test("audio input request stops at denied permission preflight", async () => {
  let getUserMediaCalled = false;
  const result = await requestAudioInputStream({
    mediaDevices: {
      async getUserMedia() {
        getUserMediaCalled = true;
      }
    },
    permissions: {
      async query(request) {
        assert.deepEqual(request, { name: "microphone" });
        return { state: "denied" };
      }
    }
  });

  assert.deepEqual(result, { ok: false, code: "permission_denied_preflight" });
  assert.equal(getUserMediaCalled, false);
});

test("audio input request returns stream on success and clears timeout", async () => {
  let cleared = false;
  const stream = { getTracks: () => [] };
  const result = await requestAudioInputStream({
    mediaDevices: {
      async getUserMedia(request) {
        assert.deepEqual(request, { audio: true });
        return stream;
      }
    },
    setTimeoutFn() {
      return "timer";
    },
    clearTimeoutFn(timer) {
      assert.equal(timer, "timer");
      cleared = true;
    }
  });

  assert.deepEqual(result, { ok: true, stream });
  assert.equal(cleared, true);
});

test("audio input request times out and stops a late stream", async () => {
  let timeoutCallback = null;
  let resolveStream = null;
  let stopped = false;
  const streamPromise = new Promise((resolve) => {
    resolveStream = resolve;
  });

  const pending = requestAudioInputStream({
    mediaDevices: {
      getUserMedia() {
        return streamPromise;
      }
    },
    setTimeoutFn(callback) {
      timeoutCallback = callback;
      return "timer";
    },
    clearTimeoutFn() {
      throw new Error("timeout result should not clear an already-fired timer");
    }
  });

  await Promise.resolve();
  timeoutCallback();
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.code, "timeout");

  resolveStream({
    getTracks: () => [{
      stop() {
        stopped = true;
      }
    }]
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(stopped, true);
});

test("audio input error classifier keeps device failures generic and narrow", () => {
  assert.equal(classifyAudioInputError({ name: "NotAllowedError" }), "permission_denied");
  assert.equal(classifyAudioInputError({ name: "PermissionDeniedError" }), "permission_denied");
  assert.equal(classifyAudioInputError({ name: "NotFoundError" }), "no_device");
  assert.equal(classifyAudioInputError(new Error("getUserMedia_timeout")), "timeout");
  assert.equal(classifyAudioInputError(new Error("driver crashed")), "init_failed");
});
