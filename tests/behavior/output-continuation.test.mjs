import test from "node:test";
import assert from "node:assert/strict";

import {
  generateTextWithContinuations,
  outputLimitFinishReason
} from "../../src/service/executors/shared/output-continuation.mjs";

test("output continuation detects provider length termination", () => {
  assert.equal(outputLimitFinishReason({ finish_reason: "length" }), "length");
  assert.equal(outputLimitFinishReason({ stop_reason: "max_tokens" }), "max_tokens");
  assert.equal(outputLimitFinishReason({ finish_reason: "stop" }), null);
});

test("output continuation continues from partial text without restarting", async () => {
  const calls = [];
  const adapter = {
    async generate(body) {
      calls.push(body);
      if (calls.length === 1) {
        body.onTextDelta?.("第一段");
        return {
          text: "第一段",
          finish_reason: "length",
          usage: { input_tokens: 10, output_tokens: 4 }
        };
      }
      body.onTextDelta?.("第二段完整结束");
      return {
        text: "第二段完整结束",
        finish_reason: "stop",
        usage: { input_tokens: 8, output_tokens: 5 }
      };
    }
  };
  const usage = [];
  const limited = [];
  const result = await generateTextWithContinuations({
    adapter,
    messages: [{ role: "user", content: "写一个完整计划" }],
    tools: [{ name: "call_tool" }],
    continuationTools: [],
    maxContinuations: 2,
    onUsage: (entry) => usage.push(entry),
    onOutputLimited: (entry) => limited.push(entry)
  });

  assert.equal(result.text, "第一段第二段完整结束");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].tools, []);
  assert.match(calls[1].messages.at(-1).content, /Continue exactly/);
  assert.match(calls[1].messages.at(-2).content, /第一段/);
  assert.equal(usage.length, 2);
  assert.equal(limited.length, 1);
});

test("output continuation can continue structurally incomplete normal-stop text", async () => {
  const calls = [];
  const adapter = {
    async generate(body) {
      calls.push(body);
      if (calls.length === 1) {
        body.onTextDelta?.("### 下一步\n\n##");
        return {
          text: "### 下一步\n\n##",
          finish_reason: "stop",
          usage: { input_tokens: 10, output_tokens: 4 }
        };
      }
      body.onTextDelta?.(" 申请策略\n补完整段内容。");
      return {
        text: " 申请策略\n补完整段内容。",
        finish_reason: "stop",
        usage: { input_tokens: 8, output_tokens: 5 }
      };
    }
  };
  const limited = [];
  const result = await generateTextWithContinuations({
    adapter,
    messages: [{ role: "user", content: "写一个完整计划" }],
    maxContinuations: 2,
    shouldContinue: ({ limitReason, text }) =>
      limitReason || (/^#{1,6}\s*$/m.test(String(text).split(/\r?\n/).at(-1) ?? "")
        ? { reason: "final_answer_dangling_markdown_heading" }
        : false),
    onOutputLimited: (entry) => limited.push(entry)
  });

  assert.equal(result.text, "### 下一步\n\n## 申请策略\n补完整段内容。");
  assert.equal(calls.length, 2);
  assert.equal(limited[0]?.limitReason, "final_answer_dangling_markdown_heading");
});
