import assert from "node:assert/strict";
import test from "node:test";

import {
  formatPartialSuccessContent,
  normalizePartialSuccessDetail,
  selectPartialSuccessTaskMessage
} from "../../src/shared/partial-success-text.mjs";

test("partial-success detail normalization removes empty punctuation-only text", () => {
  assert.equal(normalizePartialSuccessDetail("Task partially succeeded: ."), "see task for details");
  assert.equal(formatPartialSuccessContent("."), "Task partially succeeded: see task for details");
  assert.equal(
    formatPartialSuccessContent("Task partially succeeded: source fetch blocked"),
    "Task partially succeeded: source fetch blocked"
  );
});

test("partial-success task message prefers real final summaries over generic failure fallback", () => {
  const task = {
    status: "partial_success",
    result_summary: "找到了可用来源，但未能保存图片文件。",
    failure_user_message: "."
  };

  assert.equal(selectPartialSuccessTaskMessage(task), "找到了可用来源，但未能保存图片文件。");
});

test("partial-success task message formats failure detail when no final summary exists", () => {
  assert.equal(
    selectPartialSuccessTaskMessage({
      status: "partial_success",
      failure_user_message: "HTTP 403 blocked the selected source"
    }),
    "Task partially succeeded: HTTP 403 blocked the selected source"
  );
});
