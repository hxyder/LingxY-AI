import assert from "node:assert/strict";
import test from "node:test";

import {
  FREE_TRANSLATOR_PROVIDERS,
  translateText
} from "../../src/service/translation/free-translator.mjs";
import { createTranslateExecutorScaffold } from "../../src/service/executors/translate/translate-executor.mjs";

test("free translator prefers the low-latency Google web endpoint", () => {
  assert.deepEqual(FREE_TRANSLATOR_PROVIDERS.slice(0, 2), ["google_web", "mymemory"]);
});

test("free translator does not wait for MyMemory before Google web", async () => {
  const called = [];
  const fetchImpl = async (url) => {
    called.push(url);
    if (url.includes("translate.googleapis.com")) {
      return {
        ok: true,
        async json() {
          return [[["你好", "Hello", null, null, 1]], null, "en"];
        }
      };
    }
    throw new Error("mymemory_should_not_be_called_first");
  };

  const result = await translateText({
    text: "Hello",
    target: "zh-CN",
    fetchImpl
  });

  assert.equal(result.provider, "google_web");
  assert.equal(result.text, "你好");
  assert.equal(called.length, 1);
  assert.match(called[0], /translate\.googleapis\.com/);
});

test("free translator falls back when the preferred provider exceeds its budget", async () => {
  const called = [];
  const fetchImpl = async (url, options = {}) => {
    called.push(url);
    if (url.includes("translate.googleapis.com")) {
      await new Promise((_resolve, reject) => {
        const keepAlive = setTimeout(() => {}, 1000);
        options.signal?.addEventListener("abort", () => {
          clearTimeout(keepAlive);
          reject(new Error("google_timeout"));
        }, { once: true });
      });
    }
    return {
      ok: true,
      async json() {
        return {
          responseStatus: 200,
          responseData: {
            translatedText: "你好",
            detectedLanguage: "en"
          }
        };
      }
    };
  };

  const result = await translateText({
    text: "Hello",
    target: "zh-CN",
    fetchImpl,
    providerTimeoutMs: 20
  });

  assert.equal(result.provider, "mymemory");
  assert.equal(result.text, "你好");
  assert.equal(called.filter((url) => url.includes("translate.googleapis.com")).length, 1);
  assert.equal(called.filter((url) => url.includes("mymemory")).length, 1);
});

test("free translator translates chunks concurrently while preserving output order", async () => {
  let active = 0;
  let maxActive = 0;
  const fetchImpl = async (url) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    try {
      await new Promise((resolve) => setTimeout(resolve, 20));
      const q = new URL(url).searchParams.get("q") ?? "";
      const marker = q.trim().slice(0, 1);
      return {
        ok: true,
        async json() {
          return [[[`${marker.toLowerCase()}`, q, null, null, 1]], null, "en"];
        }
      };
    } finally {
      active -= 1;
    }
  };

  const text = [
    `${"A".repeat(260)}.`,
    `${"B".repeat(260)}.`,
    `${"C".repeat(260)}.`,
    `${"D".repeat(260)}.`
  ].join(" ");
  const result = await translateText({
    text,
    target: "zh-CN",
    fetchImpl,
    chunkConcurrency: 2
  });

  assert.equal(result.text, "abcd");
  assert.ok(maxActive > 1, "chunks should run with bounded concurrency");
  assert.ok(maxActive <= 2, "chunk concurrency must respect the configured limit");
});

test("translate executor keeps provider details in metadata, not visible text", async () => {
  const executor = createTranslateExecutorScaffold({
    async translator() {
      return {
        text: "你好",
        input: "Hello",
        source_language: "en",
        target_language: "zh-CN",
        provider: "google_web",
        chunks: []
      };
    }
  });

  const events = [];
  for await (const event of executor.execute({
    user_command: "翻译这段",
    context_packet: { text: "Hello" }
  })) {
    events.push(event);
  }

  const inline = events.find((event) => event.event_type === "inline_result");
  assert.equal(inline.payload.text, "你好");
  assert.equal(inline.payload.translation.provider, "google_web");
});
