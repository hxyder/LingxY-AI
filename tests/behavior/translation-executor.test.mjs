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
