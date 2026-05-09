import assert from "node:assert/strict";
import test from "node:test";

import {
  SESSION_ITEM_KINDS,
  createConversationSessionService
} from "../../src/service/core/session/conversation-session-service.mjs";
import { createInMemoryStoreScaffold } from "../../src/service/core/store/memory-store.mjs";
import { createTaskRecord } from "../../src/service/core/task-runtime/task-record.mjs";

const baseRoute = {
  intent: "general",
  goal: "qa",
  executor: "fast",
  suggested_executor: "fast",
  intent_tags: [],
  suggested_formats: [],
  requires_confirmation: false
};

function makeRuntimeWithParent() {
  const store = createInMemoryStoreScaffold();
  const runtime = { store };
  store.insertConversation({ conversation_id: "conv_record" });
  store.appendMessage({ conversation_id: "conv_record", role: "user", content: "first" });
  store.appendMessage({ conversation_id: "conv_record", role: "assistant", content: "parent answer" });
  store.insertTask({
    task_id: "task_parent",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    status: "success",
    result_summary: "parent answer",
    conversation_id: "conv_record"
  });
  runtime.conversationSessions = createConversationSessionService({ store });
  const session = runtime.conversationSessions.ensureSession({
    conversationId: "conv_record",
    activeTaskId: "task_parent"
  });
  runtime.conversationSessions.appendItem({
    sessionId: session.session_id,
    kind: SESSION_ITEM_KINDS.TASK_ANCHOR,
    taskId: "task_parent"
  });
  return runtime;
}

test("task record factory applies conversation precedence and enriches follow-up context", () => {
  const runtime = makeRuntimeWithParent();

  const task = createTaskRecord({
    route: baseRoute,
    runtime,
    contextPacket: {
      source_type: "text",
      source_app: "uca.test",
      text: "selected text",
      selection_metadata: { conversation_id: "conv_other" }
    },
    userCommand: "继续",
    executionMode: "interactive",
    conversationId: "conv_record",
    submissionKind: "context"
  });

  assert.equal(task.conversation_id, "conv_record");
  assert.equal(task.parent_task_id, "task_parent");
  assert.equal(task.is_continuation, true);
  assert.equal(task.context_packet.parent_task_summary.parent_task_id, "task_parent");
  assert.ok(task.context_packet.prior_messages.some((message) => message.content === "parent answer"));
  assert.equal(task.context_packet.compiled_context.owner, "service/runtime");
  assert.ok(task.context_packet.compiled_context.selected.some((item) => item.kind === "follow_up_resolution"));
  assert.ok(task.context_packet.compiled_context.selected.some((item) => item.kind === "session_task_anchor"));
});

test("task record factory does not auto-parent standalone document generation requests", () => {
  const runtime = makeRuntimeWithParent();

  const task = createTaskRecord({
    route: baseRoute,
    runtime,
    contextPacket: {
      source_type: "text",
      source_app: "uca.test",
      text: "",
      selection_metadata: { conversation_id: "conv_record" }
    },
    userCommand: "生成这一周美股走势的excel报表",
    executionMode: "interactive",
    conversationId: "conv_record",
    submissionKind: "context"
  });

  assert.equal(task.parent_task_id, null);
  assert.equal(task.is_continuation, false);
  assert.equal(task.task_spec.goal, "generate_document");
  assert.equal(task.task_spec.artifact.kind, "xlsx");
});

test("task record factory exposes recent conversation artifacts and routes format tweaks to edit_file", () => {
  const store = createInMemoryStoreScaffold();
  const runtime = { store };
  store.insertConversation({ conversation_id: "conv_excel" });
  store.insertTask({
    task_id: "task_excel",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    status: "success",
    result_summary: "created xlsx",
    conversation_id: "conv_excel"
  });
  store.appendArtifact({
    artifact_id: "artifact_xlsx",
    task_id: "task_excel",
    conversation_id: "conv_excel",
    path: "E:\\linxiDoc\\task_excel\\result.xlsx",
    kind: "xlsx",
    source: "generated",
    status: "ready",
    created_at: "2026-01-01T00:00:01.000Z"
  });

  const task = createTaskRecord({
    route: baseRoute,
    runtime,
    contextPacket: {
      source_type: "text",
      source_app: "uca.test",
      text: "",
      selection_metadata: { conversation_id: "conv_excel" }
    },
    userCommand: "给我生成excel表的格式",
    executionMode: "interactive",
    conversationId: "conv_excel",
    submissionKind: "context"
  });

  assert.equal(task.parent_task_id, null);
  assert.equal(task.is_continuation, false);
  assert.equal(task.context_packet.latest_conversation_artifact.path, "E:\\linxiDoc\\task_excel\\result.xlsx");
  assert.equal(task.task_spec.goal, "transform_existing_file");
  assert.equal(task.task_spec.artifact.kind, "xlsx");
  assert.ok(task.task_spec.success_contract.required_tool_names.includes("edit_file"));
});

test("task record factory stamps task spec snapshot, dedupe key, and submission boundary", () => {
  const task = createTaskRecord({
    route: baseRoute,
    runtime: { store: createInMemoryStoreScaffold() },
    contextPacket: {
      source_type: "text",
      source_app: "uca.test",
      text: "  repeated source text  ",
      selection_metadata: { conversation_id: "conv_from_context" }
    },
    userCommand: "Summarize",
    executionMode: "interactive",
    executorOverride: "tool_using",
    submissionKind: "action_tool"
  });

  assert.match(task.task_id, /^task_/);
  assert.equal(task.conversation_id, "conv_from_context");
  assert.equal(task.executor, "tool_using");
  assert.equal(task.is_continuation, false);
  assert.equal(task.task_spec_initial, task.task_spec);
  assert.equal(task.task_spec_valid, true);
  assert.equal(task.submission_boundary.submission_kind, "action_tool");
  assert.equal(task.submission_boundary.blocking, false);
  assert.match(task.source_dedupe_key, /^text:uca\.test:tool_using:Summarize:repeated source text$/);
});

test("task record factory keeps retry and child metadata stable", () => {
  const task = createTaskRecord({
    route: baseRoute,
    runtime: null,
    contextPacket: {
      source_type: "manual",
      source_app: "uca.test",
      file_paths: ["a.md", "b.md"]
    },
    userCommand: "Run child",
    executionMode: null,
    parentTaskId: "task_parent",
    childTaskIds: ["child_a"],
    childIndex: 2,
    retryCount: 1,
    bypassDedupe: false
  });

  assert.equal(task.parent_task_id, "task_parent");
  assert.deepEqual(task.child_task_ids, ["child_a"]);
  assert.equal(task.child_index, 2);
  assert.equal(task.is_continuation, true);
  assert.equal(task.retry_count, 1);
  assert.equal(task.bypass_dedupe, true);
  assert.equal(task.execution_mode, "interactive");
  assert.equal(task.source_dedupe_key, `manual:uca.test:${task.executor}:Run child:a.md|b.md`);
});

test("task record factory marks caller-provided follow-up parents as continuations", () => {
  const task = createTaskRecord({
    route: baseRoute,
    runtime: null,
    contextPacket: {
      source_type: "manual",
      source_app: "uca.test"
    },
    userCommand: "继续",
    executionMode: "interactive",
    parentTaskId: "task_parent",
    retryCount: 0
  });

  assert.equal(task.parent_task_id, "task_parent");
  assert.equal(task.child_index, null);
  assert.equal(task.is_continuation, true);
});
