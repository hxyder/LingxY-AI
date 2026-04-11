import assert from "node:assert/strict";
import {
  detectSourceLanguage,
  pickDefaultTarget,
  splitIntoChunks,
  normalizeLanguageCode,
  translateText
} from "../src/service/translation/free-translator.mjs";
import { createTranslateExecutorScaffold, inferTargetLanguageFromCommand } from "../src/service/executors/translate/translate-executor.mjs";
import { routeIntent } from "../src/service/core/router/intent-router.mjs";
import { createServiceBootstrap } from "../src/service/core/service-bootstrap.mjs";
import { submitContextTask } from "../src/service/core/context-submission.mjs";
import { submitBrowserTask } from "../src/service/core/browser-submission.mjs";
import { BUILTIN_ACTION_TOOLS } from "../src/service/action_tools/tools/index.mjs";
import { createActionToolRegistry } from "../src/service/action_tools/registry.mjs";

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers

assert.equal(detectSourceLanguage("Hello world"), "en");
assert.equal(detectSourceLanguage("你好，世界"), "zh-CN");
assert.equal(detectSourceLanguage("こんにちは"), "ja");
assert.equal(detectSourceLanguage("안녕하세요"), "ko");
assert.equal(detectSourceLanguage(""), "en");

assert.equal(pickDefaultTarget("en"), "zh-CN");
assert.equal(pickDefaultTarget("zh-CN"), "en");

assert.equal(normalizeLanguageCode("zh"), "zh-CN");
assert.equal(normalizeLanguageCode("ZH-cn"), "zh-CN");
assert.equal(normalizeLanguageCode("EN"), "en");

const longText = "First sentence. Second sentence! Third? Fourth. ".repeat(40);
const chunks = splitIntoChunks(longText, 200);
assert.ok(chunks.length > 1, "should split long text into multiple chunks");
assert.ok(chunks.every((chunk) => chunk.length <= 200), "no chunk should exceed limit");
assert.equal(chunks.join(""), longText.trim(), "chunks should reassemble to original");

assert.equal(inferTargetLanguageFromCommand("translate to English please"), "en");
assert.equal(inferTargetLanguageFromCommand("请翻译成中文"), "zh-CN");
assert.equal(inferTargetLanguageFromCommand("translate this to japanese"), "ja");
assert.equal(inferTargetLanguageFromCommand("just translate"), null);

// ─────────────────────────────────────────────────────────────────────────────
// Mock fetch — simulate MyMemory's response shape

function buildMockFetch({ failProvider = null } = {}) {
  return async function mockFetch(url) {
    if (url.includes("api.mymemory.translated.net")) {
      if (failProvider === "mymemory") {
        return { ok: false, status: 503, async json() { return {}; } };
      }
      const decoded = decodeURIComponent(new URL(url).searchParams.get("q") ?? "");
      return {
        ok: true,
        async json() {
          return {
            responseStatus: 200,
            responseData: {
              translatedText: `[zh] ${decoded}`,
              detectedLanguage: "en"
            }
          };
        }
      };
    }
    if (url.includes("translate.googleapis.com")) {
      if (failProvider === "google_web") {
        return { ok: false, status: 500, async json() { return []; } };
      }
      const decoded = decodeURIComponent(new URL(url).searchParams.get("q") ?? "");
      return {
        ok: true,
        async json() {
          return [[[`[google-zh] ${decoded}`, decoded, null, null, 1]], null, "en"];
        }
      };
    }
    throw new Error(`unexpected fetch url: ${url}`);
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// translateText() round trip with mocked fetch

const happy = await translateText({
  text: "Hello world",
  fetchImpl: buildMockFetch()
});
assert.equal(happy.text, "[zh] Hello world");
assert.equal(happy.target_language, "zh-CN");
assert.equal(happy.provider, "mymemory");

const fallback = await translateText({
  text: "Hello world",
  fetchImpl: buildMockFetch({ failProvider: "mymemory" })
});
assert.equal(fallback.provider, "google_web");
assert.equal(fallback.text, "[google-zh] Hello world");

const sameLang = await translateText({
  text: "你好",
  source: "zh-CN",
  target: "zh-CN",
  fetchImpl: buildMockFetch()
});
assert.equal(sameLang.provider, "noop_same_language");
assert.equal(sameLang.text, "你好");

// long input → chunked translation, all chunks should hit the mock
const long = "Sentence one. Sentence two! Sentence three? ".repeat(30);
const chunked = await translateText({
  text: long,
  fetchImpl: buildMockFetch()
});
assert.ok(chunked.chunks.length > 1, "chunked translation should produce multiple chunks");
assert.ok(chunked.text.startsWith("[zh] "), "concatenated translation should start with mock prefix");

// ─────────────────────────────────────────────────────────────────────────────
// Translate executor end-to-end (with injected translator)

const stubTranslator = async ({ text, target }) => ({
  input: text,
  text: `<<TR:${target ?? "auto"}>>${text}`,
  source_language: "en",
  target_language: target ?? "zh-CN",
  provider: "stub",
  chunks: [{ source: text, translated: `<<TR>>${text}`, provider: "stub" }]
});

const executor = createTranslateExecutorScaffold({ translator: stubTranslator });
assert.equal(executor.id, "translate");

const events = [];
for await (const event of executor.execute({
  task_id: "task_test",
  user_command: "请翻译这段网页内容",
  context_packet: { text: "Hello world" }
})) {
  events.push(event);
}
assert.ok(events.find((e) => e.event_type === "inline_result" && /Hello world/.test(e.payload.text)));
const successEvent = events.find((e) => e.event_type === "success");
assert.ok(successEvent, "executor should emit a success event");
assert.match(successEvent.payload.text, /Hello world/);

// empty context → graceful message (no fetch)
const emptyEvents = [];
for await (const event of createTranslateExecutorScaffold({
  translator: async () => { throw new Error("should not be called"); }
}).execute({
  task_id: "task_empty",
  user_command: "翻译",
  context_packet: { text: "" }
})) {
  emptyEvents.push(event);
}
assert.ok(emptyEvents.find((e) => e.event_type === "success"));

// ─────────────────────────────────────────────────────────────────────────────
// Intent routing — "翻译" should map to the translate executor

const route = routeIntent("请翻译这段网页内容");
assert.equal(route.intent, "translate");
assert.equal(route.executor, "translate");

const enRoute = routeIntent("translate this paragraph");
assert.equal(enRoute.executor, "translate");

// ─────────────────────────────────────────────────────────────────────────────
// translate_text action tool

const toolRegistry = createActionToolRegistry(BUILTIN_ACTION_TOOLS);
const translateTool = toolRegistry.get("translate_text");
assert.ok(translateTool, "translate_text tool should be registered");
assert.equal(translateTool.risk_level, "low");
assert.equal(translateTool.requires_confirmation, false);

// ─────────────────────────────────────────────────────────────────────────────
// End-to-end via service bootstrap with stubbed global fetch

const bootstrap = createServiceBootstrap();
// Replace the executor with one that uses our stub translator so we don't hit the network.
bootstrap.runtime.executors = bootstrap.runtime.executors.map((executor) => {
  if (executor.id === "translate") {
    return createTranslateExecutorScaffold({ translator: stubTranslator });
  }
  return executor;
});

const browserResult = await submitBrowserTask({
  capture: {
    sourceType: "text_selection",
    text: "Hello browser world",
    url: "https://example.com",
    pageTitle: "Example",
    browser: "chrome.exe"
  },
  userCommand: "请翻译这段网页内容",
  executionMode: "interactive",
  runtime: bootstrap.runtime
});
assert.equal(browserResult.task.executor, "translate");
assert.equal(browserResult.task.status, "success");
const browserInline = browserResult.taskEvents.find((e) => e.event_type === "inline_result");
assert.ok(browserInline, "browser task should emit inline_result");
assert.match(browserInline.payload.text, /Hello browser world/);

const contextResult = await submitContextTask({
  contextPacket: {
    source_type: "clipboard",
    source_app: "uca.test",
    capture_mode: "manual",
    text: "Quick brown fox"
  },
  userCommand: "translate this please",
  executionMode: "interactive",
  runtime: bootstrap.runtime
});
assert.equal(contextResult.task.executor, "translate");
assert.equal(contextResult.task.status, "success");

console.log("Free translation, translate executor, intent routing, and tool registration verified.");
