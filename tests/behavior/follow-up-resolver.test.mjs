import assert from "node:assert/strict";
import test from "node:test";

import { createInMemoryStoreScaffold } from "../../src/service/core/store/memory-store.mjs";
import { createConversationSessionService, SESSION_ITEM_KINDS } from "../../src/service/core/session/conversation-session-service.mjs";
import {
  FOLLOW_UP_RESOLUTION_MODES,
  looksLikeFollowUpSignal,
  resolveFollowUp
} from "../../src/service/core/session/follow-up-resolver.mjs";
import { ensureRuntimeServices } from "../../src/service/core/task-runtime/runtime-services.mjs";
import { submitTaskWithConversation } from "../../src/service/core/task-runtime.mjs";

const route = {
  intent: "general",
  goal: "qa",
  executor: "fast",
  suggested_executor: "fast",
  intent_tags: [],
  suggested_formats: [],
  requires_confirmation: false
};

function makeRuntime() {
  const runtime = {
    store: createInMemoryStoreScaffold(),
    queue: {
      snapshot() { return { queued: 0, running: 0 }; },
      enqueue() {}
    },
    eventBus: { publish() {} },
    logsDir: null,
    toolContext: {}
  };
  ensureRuntimeServices(runtime);
  return runtime;
}

test("follow-up resolver selects the latest typed session task anchor", () => {
  const store = createInMemoryStoreScaffold();
  store.insertConversation({ conversation_id: "conv_resolver" });
  const service = createConversationSessionService({ store });
  const session = service.ensureSession({
    conversationId: "conv_resolver",
    activeTaskId: "task_anchor_latest"
  });
  service.appendItem({
    sessionId: session.session_id,
    kind: SESSION_ITEM_KINDS.TASK_ANCHOR,
    taskId: "task_anchor_old"
  });
  service.appendItem({
    sessionId: session.session_id,
    kind: SESSION_ITEM_KINDS.TOOL_OBSERVATION,
    taskId: "task_anchor_latest",
    content: "Created the file."
  });

  const resolution = resolveFollowUp({
    userCommand: "继续",
    conversationId: "conv_resolver",
    runtime: { store, conversationSessions: service }
  });

  assert.equal(resolution.mode, FOLLOW_UP_RESOLUTION_MODES.SESSION_ANCHOR);
  assert.equal(resolution.parent_task_id, "task_anchor_latest");
  assert.equal(resolution.should_continue, true);
  assert.equal(resolution.anchors[0].kind, SESSION_ITEM_KINDS.TOOL_OBSERVATION);
});

test("follow-up resolver does not bind standalone new-topic requests", () => {
  const store = createInMemoryStoreScaffold();
  store.insertConversation({ conversation_id: "conv_new_topic" });
  const service = createConversationSessionService({ store });
  const session = service.ensureSession({
    conversationId: "conv_new_topic",
    activeTaskId: "task_prior"
  });
  service.appendItem({
    sessionId: session.session_id,
    kind: SESSION_ITEM_KINDS.TASK_ANCHOR,
    taskId: "task_prior"
  });

  const resolution = resolveFollowUp({
    userCommand: "查一下明天天气",
    conversationId: "conv_new_topic",
    runtime: { store, conversationSessions: service }
  });

  assert.equal(looksLikeFollowUpSignal("查一下明天天气"), false);
  assert.equal(resolution.mode, FOLLOW_UP_RESOLUTION_MODES.NONE);
  assert.equal(resolution.parent_task_id, null);
  assert.equal(resolution.should_continue, false);
});

test("follow-up resolver blocks explicit same-conversation topic switches", () => {
  const store = createInMemoryStoreScaffold();
  store.insertConversation({ conversation_id: "conv_topic_switch" });
  const service = createConversationSessionService({ store });
  const session = service.ensureSession({
    conversationId: "conv_topic_switch",
    activeTaskId: "task_prior_file"
  });
  service.appendItem({
    sessionId: session.session_id,
    kind: SESSION_ITEM_KINDS.ARTIFACT_REFERENCE,
    taskId: "task_prior_file",
    artifactId: "artifact_prior"
  });

  const resolution = resolveFollowUp({
    userCommand: "换个完全无关的问题：2+3 等于几？不要引用之前生成的文件。",
    conversationId: "conv_topic_switch",
    runtime: { store, conversationSessions: service }
  });

  assert.equal(looksLikeFollowUpSignal("换个完全无关的问题：2+3 等于几？不要引用之前生成的文件。"), false);
  assert.equal(resolution.mode, FOLLOW_UP_RESOLUTION_MODES.NONE);
  assert.equal(resolution.parent_task_id, null);
});

test("follow-up resolver does not auto-parent standalone generated file requests with local pronouns", () => {
  const store = createInMemoryStoreScaffold();
  store.insertConversation({ conversation_id: "conv_standalone_artifact" });
  const service = createConversationSessionService({ store });
  const session = service.ensureSession({
    conversationId: "conv_standalone_artifact",
    activeTaskId: "task_prior_artifact"
  });
  service.appendItem({
    sessionId: session.session_id,
    kind: SESSION_ITEM_KINDS.ARTIFACT_REFERENCE,
    taskId: "task_prior_artifact",
    artifactId: "artifact_prior"
  });

  const command = "生成一个 Node.js 脚本文件，文件名 followup_exec_test.mjs，然后执行这个真实落盘的 .mjs 文件。";
  const resolution = resolveFollowUp({
    userCommand: command,
    conversationId: "conv_standalone_artifact",
    runtime: { store, conversationSessions: service }
  });

  assert.equal(looksLikeFollowUpSignal(command), false);
  assert.equal(resolution.mode, FOLLOW_UP_RESOLUTION_MODES.NONE);
  assert.equal(resolution.parent_task_id, null);
});

test("follow-up resolver still binds explicit prior-artifact edit requests", () => {
  const store = createInMemoryStoreScaffold();
  store.insertConversation({ conversation_id: "conv_prior_edit" });
  const service = createConversationSessionService({ store });
  const session = service.ensureSession({
    conversationId: "conv_prior_edit",
    activeTaskId: "task_prior_md"
  });
  service.appendItem({
    sessionId: session.session_id,
    kind: SESSION_ITEM_KINDS.ARTIFACT_REFERENCE,
    taskId: "task_prior_md",
    artifactId: "artifact_md"
  });

  const resolution = resolveFollowUp({
    userCommand: "继续：只编辑上一个 Markdown 文件，在末尾追加一行。",
    conversationId: "conv_prior_edit",
    runtime: { store, conversationSessions: service }
  });

  assert.equal(resolution.mode, FOLLOW_UP_RESOLUTION_MODES.SESSION_ANCHOR);
  assert.equal(resolution.parent_task_id, "task_prior_md");
});

test("caller-provided parent wins over session anchors", () => {
  const resolution = resolveFollowUp({
    userCommand: "继续",
    conversationId: "conv_parent",
    parentTaskId: "task_explicit",
    runtime: { store: createInMemoryStoreScaffold() }
  });

  assert.equal(resolution.mode, FOLLOW_UP_RESOLUTION_MODES.CALLER_PARENT);
  assert.equal(resolution.parent_task_id, "task_explicit");
  assert.equal(resolution.confidence, 1);
  assert.equal(resolution.anchors[0].source, "caller");
});

test("task record creation uses FollowUpResolver session anchors", () => {
  const runtime = makeRuntime();
  const first = submitTaskWithConversation({
    route,
    contextPacket: { source_type: "clipboard", source_app: "uca.overlay" },
    userCommand: "先分析这个表格",
    executionMode: "interactive",
    conversationId: "conv_task_record_resolver",
    runtime
  }).task;
  runtime.store.updateTask(first.task_id, {
    ...first,
    status: "success",
    result_summary: "表格已经分析完成。"
  });

  const follow = submitTaskWithConversation({
    route,
    contextPacket: { source_type: "clipboard", source_app: "uca.overlay" },
    userCommand: "继续",
    executionMode: "interactive",
    conversationId: "conv_task_record_resolver",
    runtime
  }).task;

  assert.equal(follow.parent_task_id, first.task_id);
  assert.equal(follow.is_continuation, true);
  assert.equal(
    follow.context_packet.selection_metadata.follow_up_resolution.mode,
    FOLLOW_UP_RESOLUTION_MODES.SESSION_ANCHOR
  );
  assert.equal(
    follow.context_packet.selection_metadata.follow_up_resolution.parent_task_id,
    first.task_id
  );
});
