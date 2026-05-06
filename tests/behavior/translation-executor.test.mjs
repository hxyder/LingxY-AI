import assert from "node:assert/strict";
import test from "node:test";

import {
  FREE_TRANSLATOR_PROVIDERS,
  translateText
} from "../../src/service/translation/free-translator.mjs";

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
