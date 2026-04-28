#!/usr/bin/env node
import assert from "node:assert/strict";

import { createInMemoryStoreScaffold } from "../src/service/core/store/memory-store.mjs";
import { createTaskQueueScaffold } from "../src/service/core/queue/task-queue.mjs";
import { createEventBusScaffold } from "../src/service/core/events/event-bus.mjs";
import {
  applyExecutorEvent,
  appendTaskOutcomeMessage,
  submitTaskWithConversation
} from "../src/service/core/task-runtime.mjs";

function makeRuntime() {
  return {
    store: createInMemoryStoreScaffold(),
    queue: createTaskQueueScaffold(),
    eventBus: createEventBusScaffold(),
    platform: {},
    securityBroker: { clearTaskRedactionMap() {} }
  };
}

const route = { intent: "general", executor: "tool_using" };
const baseContext = {
  schema_version: "1.0",
  source_type: "clipboard",
  source_app: "verify",
  capture_mode: "manual",
  security_level: "internal",
  text: "",
  selection_metadata: {},
  file_paths: [],
  image_paths: []
};

{
  const runtime = makeRuntime();
  const conversationId = "conv_followup";
  const first = submitTaskWithConversation({
    runtime,
    route,
    contextPacket: baseContext,
    userCommand: "打开我桌面上的第一张图片",
    executionMode: "interactive",
    conversationId
  }).task;
  first.status = "success";
  first.result_summary = "桌面上没有找到任何图片文件。";
  runtime.store.updateTask(first.task_id, first);
  appendTaskOutcomeMessage(runtime, first);

  const follow = submitTaskWithConversation({
    runtime,
    route,
    contextPacket: baseContext,
    userCommand: "文件夹里的",
    executionMode: "interactive",
    conversationId
  }).task;

  assert.equal(follow.parent_task_id, first.task_id);
  assert.ok(Array.isArray(follow.context_packet.prior_messages));
  assert.ok(follow.context_packet.prior_messages.some((m) => /桌面上没有找到/.test(m.content)));
}

{
  const runtime = makeRuntime();
  const conversationId = "conv_topic_shift";
  const greeting = submitTaskWithConversation({
    runtime,
    route,
    contextPacket: baseContext,
    userCommand: "你好",
    executionMode: "interactive",
    conversationId
  }).task;
  greeting.status = "success";
  greeting.result_summary = "你好，有什么可以帮你？";
  runtime.store.updateTask(greeting.task_id, greeting);
  appendTaskOutcomeMessage(runtime, greeting);

  const newTopic = submitTaskWithConversation({
    runtime,
    route,
    contextPacket: baseContext,
    userCommand: "汽车修空调要多少钱",
    executionMode: "interactive",
    conversationId
  }).task;

  assert.equal(newTopic.parent_task_id, null);
  assert.ok(Array.isArray(newTopic.context_packet.prior_messages));
  assert.ok(newTopic.context_packet.prior_messages.some((m) => /你好/.test(m.content)));
}

{
  const runtime = makeRuntime();
  const task = submitTaskWithConversation({
    runtime,
    route,
    contextPacket: baseContext,
    userCommand: "触发失败",
    executionMode: "interactive",
    conversationId: "conv_failed"
  }).task;
  task.status = "running";
  runtime.store.updateTask(task.task_id, task);

  applyExecutorEvent(runtime, task, { type: "failed", text: "Unknown tool requested: undefined" });

  assert.equal(task.status, "failed");
  assert.match(task.failure_user_message, /Unknown tool requested/);
  assert.equal(task.status === "queued" || task.status === "running", false);
}

console.log("Conversation follow-up routing verification passed.");
