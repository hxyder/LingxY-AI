import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeTranscriptionEventForLocale,
  normalizeTranscriptionTextForLocale,
  wantsSimplifiedChineseOutput
} from "../../src/service/audio/transcript-locale.mjs";

test("audio transcript locale normalizer converts Traditional Chinese to zh-CN", () => {
  assert.equal(wantsSimplifiedChineseOutput("zh-CN"), true);
  assert.equal(wantsSimplifiedChineseOutput("zh-Hans"), true);
  assert.equal(wantsSimplifiedChineseOutput("zh-Hans-CN"), true);
  assert.equal(wantsSimplifiedChineseOutput("cmn-Hans-CN"), true);
  assert.equal(wantsSimplifiedChineseOutput("en-US"), false);
  assert.equal(wantsSimplifiedChineseOutput("zh-TW"), false);

  assert.equal(
    normalizeTranscriptionTextForLocale("請幫我匯總郵件與網頁內容，保留 English words。", {
      outputLocale: "zh-CN"
    }),
    "请帮我汇总邮件与网页内容，保留 English words。"
  );
});

test("audio transcript locale normalizer leaves non zh-CN output unchanged", () => {
  const text = "請幫我匯總郵件";
  assert.equal(normalizeTranscriptionTextForLocale(text, { outputLocale: "en-US" }), text);
  assert.equal(normalizeTranscriptionTextForLocale(text, { outputLocale: "zh-TW" }), text);
  assert.equal(normalizeTranscriptionTextForLocale("東京駅と漢字", { outputLocale: "ja-JP" }), "東京駅と漢字");
  assert.equal(normalizeTranscriptionTextForLocale(text, { outputLocale: "" }), text);
});

test("audio transcript locale normalizer keeps already-simple or latin-only text stable", () => {
  assert.equal(
    normalizeTranscriptionTextForLocale("请帮我 summarize this email", { outputLocale: "zh-Hans-CN" }),
    "请帮我 summarize this email"
  );
  assert.equal(
    normalizeTranscriptionTextForLocale("summarize this email", { outputLocale: "zh-CN" }),
    "summarize this email"
  );
});

test("audio transcript locale normalizer handles streaming events", () => {
  assert.deepEqual(
    normalizeTranscriptionEventForLocale(
      { type: "segment", start: 1.2, end: 2.4, text: "分析這個頁面", transcript: "匯總郵件" },
      { outputLocale: "zh-CN" }
    ),
    { type: "segment", start: 1.2, end: 2.4, text: "分析这个页面", transcript: "汇总邮件" }
  );
});
