import test from "node:test";
import assert from "node:assert/strict";

import {
  CONTEXT_COMPILER_OWNER,
  compileContextForTask
} from "../../src/service/core/context/context-compiler.mjs";

test("context compiler creates typed selected items with inclusion reasons", () => {
  const compiled = compileContextForTask({
    task: {
      task_id: "task_ctx_1",
      conversation_id: "conv_1",
      user_command: "继续，把上个文件改成 PPT",
      context_packet: {
        file_paths: ["E:\\linxi\\notes.xlsx"],
        recent_conversation_artifacts: [
          {
            artifact_id: "artifact_1",
            task_id: "task_seed",
            kind: "xlsx",
            path: "E:\\linxi\\notes.xlsx",
            created_at: "2026-05-09T01:00:00.000Z"
          }
        ],
        background_contexts: [
          {
            kind: "active_task",
            task_id: "task_seed",
            reason: "latest successful task in conversation"
          }
        ]
      }
    },
    now: new Date("2026-05-09T02:00:00.000Z")
  });

  assert.equal(compiled.owner, CONTEXT_COMPILER_OWNER);
  assert.equal(compiled.task_id, "task_ctx_1");
  assert.equal(compiled.conversation_id, "conv_1");
  assert.ok(compiled.selected.length >= 3);
  assert.ok(compiled.selected.every((item) => typeof item.reason === "string" && item.reason.length > 0));
  assert.ok(compiled.selected.some((item) => item.kind === "recent_artifact"));
  assert.equal(compiled.debug_trace, undefined);
});

test("context compiler enforces compact default traces and records omissions", () => {
  const compiled = compileContextForTask({
    task: {
      task_id: "task_ctx_2",
      user_command: "总结这些上下文",
      context_packet: {
        prior_messages: Array.from({ length: 12 }, (_, index) => ({
          role: "user",
          content: `message ${index}`
        }))
      }
    },
    limits: {
      maxItems: 4,
      maxTextChars: 200,
      maxOmissions: 3
    }
  });

  assert.equal(compiled.selected.length, 4);
  assert.ok(compiled.omitted_count > compiled.omissions.length);
  assert.equal(compiled.omissions.length, 3);
  assert.equal(compiled.debug_trace, undefined);
});

test("context compiler emits runtime metrics when available", () => {
  const timings = [];
  const counters = [];
  compileContextForTask({
    task: {
      task_id: "task_ctx_3",
      user_command: "hello",
      context_packet: {}
    },
    runtime: {
      metrics: {
        recordRuntimeTiming(name, durationMs, context) {
          timings.push({ name, durationMs, context });
        },
        incrementRuntimeCounter(name, value, context) {
          counters.push({ name, value, context });
        }
      }
    }
  });

  assert.equal(timings[0].name, "context.compile");
  assert.equal(timings[0].context.source, "context_compiler");
  assert.ok(timings[0].durationMs >= 0);
  assert.ok(counters.some((counter) => counter.name === "context.selected_items"));
});
