import assert from "node:assert/strict";
import test from "node:test";

import {
  ExternalCallHttpError,
  ExternalCallTimeoutError,
  fetchExternal,
  fetchExternalResponse,
  spawnExternal,
  withRetry,
  withTimeout
} from "../../src/service/core/external-call.mjs";

test("withRetry retries transient external-call failures and returns a later success", async () => {
  const attempts = [];
  const result = await withRetry(async ({ attempt }) => {
    attempts.push(attempt);
    if (attempt < 2) throw Object.assign(new Error(`fake fetch failed ${attempt}`), { status: 502 });
    return { ok: true, attempt };
  }, {
    retries: 2,
    delayMs: 0,
    label: "fake_fetch"
  });

  assert.deepEqual(attempts, [0, 1, 2]);
  assert.deepEqual(result, { ok: true, attempt: 2 });
});

test("withRetry does not retry non-transient HTTP failures by default", async () => {
  const attempts = [];
  await assert.rejects(
    () => withRetry(async ({ attempt }) => {
      attempts.push(attempt);
      throw Object.assign(new Error("bad request"), { status: 400 });
    }, {
      retries: 3,
      delayMs: 0
    }),
    /bad request/
  );
  assert.deepEqual(attempts, [0]);
});

test("withRetry does not retry unknown errors by default", async () => {
  const attempts = [];
  await assert.rejects(
    () => withRetry(async ({ attempt }) => {
      attempts.push(attempt);
      throw new Error("credential parser failed");
    }, {
      retries: 3,
      delayMs: 0
    }),
    /credential parser failed/
  );
  assert.deepEqual(attempts, [0]);
});

test("withTimeout aborts a stuck external call instead of letting it hang", async () => {
  let observedAbort = false;
  await assert.rejects(
    () => withTimeout(({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => {
        observedAbort = true;
        reject(signal.reason);
      }, { once: true });
    }), {
      timeoutMs: 10,
      label: "fake_spawn"
    }),
    ExternalCallTimeoutError
  );

  assert.equal(observedAbort, true);
});

test("fetchExternal turns HTTP 5xx responses into retryable external-call errors", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      if (calls.length === 1) {
        return new Response("temporarily unavailable", { status: 502 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const response = await fetchExternal("https://example.invalid/chat", {
      method: "POST",
      body: "{}"
    }, {
      retries: 1,
      delayMs: 0,
      label: "fake_fetch",
      httpErrorPrefix: "API error"
    });

    assert.equal(calls.length, 2);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchExternal preserves HTTP error status when retries are exhausted", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("unauthorized", { status: 401 });

    await assert.rejects(
      () => fetchExternal("https://example.invalid/chat", {}, {
        retries: 2,
        delayMs: 0,
        label: "fake_fetch",
        httpErrorPrefix: "API error"
      }),
      (error) => {
        assert.equal(error instanceof ExternalCallHttpError, true);
        assert.equal(error.status, 401);
        assert.match(error.message, /API error 401: unauthorized/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchExternalResponse retries 5xx but returns the final response for adapter callers", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async () => {
      calls.push(true);
      return new Response(calls.length < 3 ? "temporarily unavailable" : "still unavailable", { status: 503 });
    };

    const response = await fetchExternalResponse("https://example.invalid/chat", {}, {
      retries: 2,
      delayMs: 0,
      label: "fake_response_fetch"
    });

    assert.equal(calls.length, 3);
    assert.equal(response.status, 503);
    assert.equal(await response.text(), "still unavailable");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("spawnExternal captures stdout and stderr while writing stdin", async () => {
  const result = await spawnExternal(process.execPath, [
    "-e",
    [
      "let input = '';",
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', (chunk) => { input += chunk; });",
      "process.stdin.on('end', () => {",
      "  console.log(`stdout:${input.trim()}`);",
      "  console.error('stderr:ready');",
      "});"
    ].join("")
  ], {
    input: "hello subprocess\n",
    timeoutMs: 1000,
    label: "fake_spawn"
  });

  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /stdout:hello subprocess/);
  assert.match(result.stderr, /stderr:ready/);
  assert.equal(result.timedOut, false);
  assert.equal(result.aborted, false);
  assert.equal(result.spawnError, false);
});

test("spawnExternal times out a stuck subprocess without hanging the caller", async () => {
  const result = await spawnExternal(process.execPath, [
    "-e",
    "setInterval(() => {}, 1000);"
  ], {
    timeoutMs: 20,
    label: "slow_spawn",
    timeoutKillSignal: "SIGKILL"
  });

  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.equal(result.spawnError, false);
  assert.match(result.stderr, /\[slow_spawn\] killed after 20ms timeout/);
});

test("spawnExternal aborts a running subprocess through AbortSignal", async () => {
  const controller = new AbortController();
  const pending = spawnExternal(process.execPath, [
    "-e",
    "setInterval(() => {}, 1000);"
  ], {
    signal: controller.signal,
    timeoutMs: 1000,
    label: "abort_spawn",
    forceKillAfterMs: 20
  });

  setTimeout(() => controller.abort(), 10);
  const result = await pending;

  assert.equal(result.ok, false);
  assert.equal(result.aborted, true);
  assert.equal(result.timedOut, false);
  assert.equal(result.spawnError, false);
  assert.match(result.stderr, /\[abort_spawn\] aborted by signal/);
});

test("spawnExternal can wait for subprocess close after timeout before returning", async () => {
  const result = await spawnExternal(process.execPath, [
    "-e",
    [
      "process.on('SIGTERM', () => {",
      "  console.error('cleanup-before-close');",
      "  setTimeout(() => process.exit(0), 10);",
      "});",
      "setInterval(() => {}, 1000);"
    ].join("")
  ], {
    timeoutMs: 20,
    label: "close_spawn",
    timeoutKillSignal: "SIGTERM",
    forceKillAfterMs: 200,
    settleOnSignal: "close"
  });

  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.equal(result.spawnError, false);
  assert.equal(result.exitCode !== null || result.exitSignal !== null, true);
  if (process.platform !== "win32") {
    assert.match(result.stderr, /cleanup-before-close/);
  }
  assert.match(result.stderr, /\[close_spawn\] killed after 20ms timeout/);
});
