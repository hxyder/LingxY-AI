import assert from "node:assert/strict";
import test from "node:test";

import {
  extractToolStdoutText,
  sanitizeUserVisibleFinalText
} from "../../src/service/executors/shared/final-answer-sanitizer.mjs";
import { runToolAgentLoop } from "../../src/service/executors/tool_using/agent-loop.mjs";
import { createActionToolRegistry } from "../../src/service/capabilities/registry/registry.mjs";

test("final answer sanitizer removes internal retry acknowledgements", () => {
  const text = [
    "你说得对，我上面只是回答解释，不需要调用工具。",
    "以下是纯文本的最终答复：",
    "Console 现在应该在任务运行时持续显示进度。"
  ].join("\n");

  assert.equal(
    sanitizeUserVisibleFinalText(text),
    "Console 现在应该在任务运行时持续显示进度。"
  );
});

test("final answer sanitizer keeps normal user-visible answers unchanged", () => {
  const text = "已经完成：Console 会先显示任务创建，再显示执行状态，最后展示结果。";
  assert.equal(sanitizeUserVisibleFinalText(text), text);
});

test("final answer sanitizer prefers stdout content when a tool transcript leaks", () => {
  const text = [
    "工具调用已经完成，以下是纯文本的最终答复：",
    "run_script (node) finished with exit 0.",
    "--- stdout ---",
    "LXSCRIPT-GENERIC-OK",
    "--- stderr ---"
  ].join("\n");

  assert.equal(extractToolStdoutText(text), "LXSCRIPT-GENERIC-OK");
  assert.equal(sanitizeUserVisibleFinalText(text), "LXSCRIPT-GENERIC-OK");
});

test("tool agent finalization sanitizes leaked retry preambles before returning", async () => {
  const events = [];
  const audits = [];
  const result = await runToolAgentLoop({
    task: {
      task_id: "task_sanitize",
      user_command: "修复 Console 实时输出",
      task_spec: { success_contract: { tool_called: false } }
    },
    runtime: {
      actionToolRegistry: createActionToolRegistry([]),
      toolContext: {},
      toolOutputDir: null,
      securityBroker: {
        authorizeToolCall() {
          return { allowed: true, reason: null };
        }
      },
      emitTaskEvent: (eventType, payload) => events.push({ eventType, payload }),
      store: {
        appendAuditLog: (entry) => audits.push(entry)
      }
    },
    planner: async () => ({
      type: "final",
      text: [
        "你说得对，我上面只是回答解释，不需要调用工具。以下是纯文本的最终答复：",
        "Console 实时输出已经恢复。"
      ].join("\n")
    }),
    maxIterations: 1
  });

  assert.equal(result.status, "success");
  assert.equal(result.final_text, "Console 实时输出已经恢复。");
  assert.ok(events.some((event) => event.eventType === "final_answer_sanitized"));
  assert.ok(audits.some((entry) => entry.event_subtype === "tool_loop.final_answer_sanitized"));
});

test("tool agent finalization recovers stdout when sanitized answer collapses to a stream label", async () => {
  const events = [];
  const audits = [];
  const result = await runToolAgentLoop({
    task: {
      task_id: "task_stdout_recovery",
      user_command: "运行脚本并只回答 stdout",
      task_spec: { success_contract: { tool_called: true } }
    },
    runtime: {
      actionToolRegistry: createActionToolRegistry([
        {
          id: "run_script_fixture",
          name: "Run Script Fixture",
          description: "Returns a run_script-like stdout/stderr observation.",
          risk_level: "low",
          requires_confirmation: false,
          parameters: { type: "object", properties: {} },
          async execute() {
            return {
              success: true,
              observation: [
                "run_script (node) finished with exit 0.",
                "--- stdout ---",
                "LXSCRIPT-STDOUT-RECOVERY",
                "--- stderr ---"
              ].join("\n")
            };
          }
        }
      ]),
      toolContext: {},
      toolOutputDir: null,
      securityBroker: {
        authorizeToolCall() {
          return { allowed: true, reason: null };
        }
      },
      emitTaskEvent: (eventType, payload) => events.push({ eventType, payload }),
      store: {
        appendAuditLog: (entry) => audits.push(entry)
      }
    },
    planner: async ({ iteration }) => {
      if (iteration === 0) return { type: "tool_call", tool: "run_script_fixture", args: {} };
      return { type: "final", text: "工具调用已经完成，以下是纯文本的最终答复：stderr ---" };
    },
    maxIterations: 2
  });

  assert.equal(result.status, "success");
  assert.match(result.final_text, /LXSCRIPT-STDOUT-RECOVERY/u);
  assert.doesNotMatch(result.final_text, /^stderr\s*-*$/iu);
});
