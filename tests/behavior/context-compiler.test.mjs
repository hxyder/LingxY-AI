import test from "node:test";
import assert from "node:assert/strict";

import {
  CONTEXT_COMPILER_OWNER,
  compileContextForTask
} from "../../src/service/core/context/context-compiler.mjs";
import {
  SESSION_ITEM_KINDS,
  createConversationSessionService
} from "../../src/service/core/session/conversation-session-service.mjs";
import { createSessionCompactionService } from "../../src/service/core/session/session-compaction-service.mjs";
import { createInMemoryStoreScaffold } from "../../src/service/core/store/memory-store.mjs";

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
  assert.ok(compiled.selected.every((item) => item.decision === "selected"));
  assert.ok(compiled.selected.every((item) => typeof item.inclusion_reason === "string" && item.inclusion_reason.length > 0));
  assert.ok(compiled.selected.some((item) => item.kind === "latest_artifact"));
  assert.equal(compiled.debug_trace, undefined);
});

test("context compiler includes typed session anchors and resolver decisions deterministically", () => {
  const store = createInMemoryStoreScaffold();
  store.insertConversation({ conversation_id: "conv_session_ctx" });
  const sessions = createConversationSessionService({ store });
  const session = sessions.ensureSession({
    conversationId: "conv_session_ctx",
    activeTaskId: "task_seed"
  });
  sessions.appendItem({
    sessionId: session.session_id,
    kind: SESSION_ITEM_KINDS.TASK_ANCHOR,
    taskId: "task_seed",
    payload: { parent_task_id: null, is_continuation: false }
  });
  sessions.appendItem({
    sessionId: session.session_id,
    kind: SESSION_ITEM_KINDS.TOOL_OBSERVATION,
    taskId: "task_seed",
    content: "Created E:\\linxiDoc\\task_seed\\brief.xlsx",
    payload: { tool_id: "write_xlsx", success: true }
  });

  const compiled = compileContextForTask({
    task: {
      task_id: "task_follow",
      conversation_id: "conv_session_ctx",
      parent_task_id: "task_seed",
      user_command: "继续，把它改成 PPT",
      context_packet: {
        selection_metadata: {
          follow_up_resolution: {
            mode: "session_anchor",
            parent_task_id: "task_seed",
            confidence: 0.9,
            should_continue: true,
            anchors: [{ kind: "task_anchor", task_id: "task_seed" }]
          }
        },
        parent_task_summary: {
          parent_task_id: "task_seed",
          assistant_final_text: "Created the spreadsheet."
        }
      }
    },
    runtime: {
      store,
      conversationSessions: sessions
    },
    now: new Date("2026-05-09T03:00:00.000Z")
  });

  assert.deepEqual(
    compiled.selected.slice(0, 3).map((item) => item.kind),
    ["current_user_command", "follow_up_resolution", "parent_task_summary"]
  );
  assert.ok(compiled.selected.some((item) => item.kind === "session_task_anchor"));
  assert.ok(compiled.selected.some((item) => item.kind === "session_tool_observation"));
  assert.equal(
    compiled.selected.find((item) => item.kind === "session_tool_observation").value.tool_id,
    "write_xlsx"
  );
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

test("context compiler includes latest session compaction before stale transcript tails", () => {
  const store = createInMemoryStoreScaffold();
  store.insertConversation({ conversation_id: "conv_compiled_compaction" });
  const sessions = createConversationSessionService({ store });
  const session = sessions.ensureSession({
    conversationId: "conv_compiled_compaction",
    activeTaskId: "task_compact_seed"
  });
  for (let index = 0; index < 5; index += 1) {
    sessions.appendItem({
      sessionId: session.session_id,
      kind: SESSION_ITEM_KINDS.TOOL_OBSERVATION,
      taskId: `task_compact_${index}`,
      content: `Observation ${index} about the spreadsheet-to-PPT work thread.`,
      payload: { tool_id: "write_file", success: true }
    });
  }
  const compactions = createSessionCompactionService({ store });
  const compacted = compactions.compactSession({
    sessionId: session.session_id,
    minItems: 5
  });
  assert.equal(compacted.compacted, true);

  const compiled = compileContextForTask({
    task: {
      task_id: "task_follow_compacted",
      conversation_id: "conv_compiled_compaction",
      user_command: "继续处理这个会话里的文件",
      context_packet: {
        prior_messages: [
          { role: "user", content: "stale transcript tail" }
        ]
      }
    },
    runtime: {
      store,
      conversationSessions: sessions,
      sessionCompactions: compactions
    },
    limits: {
      maxItems: 4
    }
  });

  const compactionItem = compiled.selected.find((item) => item.kind === "session_compaction");
  assert.ok(compactionItem);
  assert.equal(compactionItem.source, "conversation_session.session_compactions");
  assert.ok(compactionItem.content.includes("Session compaction 0-4"));
  assert.equal(compactionItem.value.source_item_count, 5);
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
