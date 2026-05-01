import assert from "node:assert/strict";
import test from "node:test";

import {
  ExternalCallHttpError,
  ExternalCallTimeoutError,
  fetchExternal,
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
