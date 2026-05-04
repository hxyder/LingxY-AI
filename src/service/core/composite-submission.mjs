import { routeIntent } from "./router/intent-router.mjs";
import {
  createTaskRecord,
  emitTaskEvent,
  markTaskSucceeded,
  refreshCompositeParentStatus,
  submitTaskWithConversation,
  updateTask
} from "./task-runtime.mjs";

function buildCompositeRoute(userCommand) {
  const route = routeIntent(userCommand);
  return {
    ...route,
    executor: "composite",
    suggested_executor: "composite"
  };
}

export async function submitCompositeTask({
  runtime,
  contextPacket,
  userCommand,
  executionMode,
  subtasks,
  conversationId = null,
  clientMessageId = null,
  projectId = null,
  submitChild
}) {
  const store = runtime.store;
  const route = buildCompositeRoute(userCommand);
  const { task: parentTask, userMessage: parentUserMessage } = submitTaskWithConversation({
    route,
    contextPacket,
    userCommand,
    executionMode,
    conversationId,
    clientMessageId,
    projectId,
    runtime,
    executorOverride: "composite",
    submissionKind: "composite",
    childTaskIds: []
  });
  emitTaskEvent({
    runtime,
    taskId: parentTask.task_id,
    eventType: "task_created",
    payload: {
      source_type: contextPacket?.source_type ?? "unknown",
      composite: true,
      child_count: subtasks.length
    }
  });

  updateTask(runtime, parentTask, {
    status: "running",
    sub_status: "composite_pending",
    progress: 0
  }, true);

  const childArtifacts = [];

  for (let i = 0; i < subtasks.length; i += 1) {
    const subtask = subtasks[i];
    const childResult = await submitChild({
      subtask,
      index: i,
      parentTaskId: parentTask.task_id,
      parentMessageId: parentUserMessage?.message_id ?? null
    });
    const childTaskId = childResult?.task?.task_id ?? null;
    if (childTaskId) {
      parentTask.child_task_ids = [...(parentTask.child_task_ids ?? []), childTaskId];
      updateTask(runtime, parentTask, {
        child_task_ids: parentTask.child_task_ids,
        progress: Math.min(1, (i + 1) / subtasks.length)
      }, false);
      emitTaskEvent({
        runtime,
        taskId: parentTask.task_id,
        eventType: "composite_child_created",
        payload: {
          child_task_id: childTaskId,
          child_index: i,
          command: subtask.command
        }
      });
    }

    if (Array.isArray(childResult?.artifacts)) {
      childArtifacts.push(...childResult.artifacts);
    }
  }

  const aggregateResult = refreshCompositeParentStatus(runtime, parentTask.task_id);
  if (aggregateResult?.aggregate?.status === "success") {
    emitTaskEvent({
      runtime,
      taskId: parentTask.task_id,
      eventType: "success",
      payload: {
        summary: "Composite task completed.",
        child_count: subtasks.length
      }
    });
    markTaskSucceeded(runtime, parentTask);
  } else if (aggregateResult?.aggregate?.status === "partial_success") {
    emitTaskEvent({
      runtime,
      taskId: parentTask.task_id,
      eventType: "partial_success",
      payload: {
        summary: "Composite task completed with warnings.",
        child_count: subtasks.length
      }
    });
    markTaskSucceeded(runtime, parentTask);
  }

  return {
    task: parentTask,
    taskEvents: store.getTaskEvents(parentTask.task_id),
    artifacts: childArtifacts
  };
}
