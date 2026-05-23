import test from "node:test";
import assert from "node:assert/strict";

import { createTaskSpec } from "../../src/service/core/task-spec.mjs";
import { buildAgenticSystemPrompt } from "../../src/service/executors/agentic/prompt-builder.mjs";
import { buildLeanChatSystemPrompt } from "../../src/service/executors/tool_using/planner-mode.mjs";

test("task spec honors English UI locale as response language", () => {
  const spec = createTaskSpec("请总结这段内容", {
    text: "Captured page text",
    selection_metadata: {
      ui_locale: "en-US",
      preferred_locale: "en-US",
      response_locale: "en-US"
    }
  });

  assert.equal(spec.constraints.language, "en-US");

  const task = { user_command: "请总结这段内容", task_spec: spec };
  assert.match(buildAgenticSystemPrompt({ task }), /Reply to the user in en-US\./);
  assert.match(buildLeanChatSystemPrompt({ task, synthesisBlock: "" }), /Reply in en-US\./);
});

test("task spec keeps Chinese response language when UI locale is Chinese or absent", () => {
  assert.equal(createTaskSpec("hello", {}).constraints.language, "zh-CN");
  assert.equal(createTaskSpec("hello", {
    selection_metadata: { ui_locale: "zh-CN" }
  }).constraints.language, "zh-CN");
});
