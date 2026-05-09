import assert from "node:assert/strict";
import test from "node:test";

import { createInMemoryStoreScaffold } from "../../src/service/core/store/memory-store.mjs";
import { submitTaskWithConversation } from "../../src/service/core/task-runtime/task-submission.mjs";
import {
  AUTO_SCHEDULE_PROJECT_ID,
  buildScheduledConversationScope
} from "../../src/service/scheduler/execute-action.mjs";

const route = {
  intent: "scheduled_task",
  executor: "tool_using",
  requires_confirmation: false
};

test("scheduled conversation scope is stable per schedule id", () => {
  const scope = buildScheduledConversationScope({
    sourceId: "sched_e1f9a7db-c3ee-4da5-a5ea-a81286735c85",
    scheduleContext: {
      schedule_id: "sched_e1f9a7db-c3ee-4da5-a5ea-a81286735c85",
      name: "美股日报"
    },
    sourceLabel: "收集美股市场最新汇总信息"
  });

  assert.equal(scope.projectId, AUTO_SCHEDULE_PROJECT_ID);
  assert.equal(scope.conversationId, "conv_auto_schedule_sched_e1f9a7db-c3ee-4da5-a5ea-a81286735c85");
  assert.equal(scope.title, "美股日报");
  assert.equal(scope.metadata.autoSource, "schedule");
  assert.equal(scope.metadata.autoKey, "schedule:sched_e1f9a7db-c3ee-4da5-a5ea-a81286735c85");
});

test("scheduled tasks create canonical system conversation turns", () => {
  const store = createInMemoryStoreScaffold();
  const runtime = { store };
  const scope = buildScheduledConversationScope({
    sourceId: "sched_market_digest",
    scheduleContext: {
      schedule_id: "sched_market_digest",
      name: "美股日报"
    }
  });

  const result = submitTaskWithConversation({
    runtime,
    route,
    contextPacket: {
      source_type: "window",
      source_app: "uca.scheduler",
      capture_mode: "event",
      selection_metadata: {
        source_id: "sched_market_digest",
        scheduler_context: true,
        scheduled_task_fire: true,
        conversation_id: scope.conversationId,
        project_id: scope.projectId
      }
    },
    userCommand: "收集美股市场最新汇总信息，整理后发送邮件。",
    executionMode: "background",
    conversationId: scope.conversationId,
    conversationTitle: scope.title,
    conversationMetadata: scope.metadata,
    projectId: scope.projectId,
    submissionKind: "context"
  });

  const conversation = store.getConversation(scope.conversationId);
  const messages = store.getConversationMessages(scope.conversationId);

  assert.equal(result.task.conversation_id, scope.conversationId);
  assert.equal(conversation.project_id, AUTO_SCHEDULE_PROJECT_ID);
  assert.equal(conversation.title, "美股日报");
  assert.equal(conversation.metadata.autoSource, "schedule");
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, "system");
  assert.equal(messages[0].content, result.task.user_command);
  assert.deepEqual(
    store.getTaskMessages(result.task.task_id).map((link) => link.relation),
    ["triggered"]
  );
});
