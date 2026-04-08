import { submitBrowserTask } from "../core/browser-submission.mjs";
import { submitFileTask } from "../core/file-submission.mjs";

function isFileSource(task) {
  return ["file", "file_group"].includes(task.context_packet.source_type);
}

function isBrowserSource(task) {
  return ["text_selection", "link", "image", "webpage"].includes(task.context_packet.source_type);
}

export function buildRetryRequest(task, mode = "retry_same", overrides = {}) {
  const base = {
    mode,
    parentTaskId: task.parent_task_id ?? task.task_id,
    retryCount: (task.retry_count ?? 0) + 1,
    executionMode: overrides.executionMode ?? task.execution_mode,
    userCommand: overrides.userCommand ?? task.user_command,
    executorOverride: overrides.executorOverride
  };

  if (isFileSource(task)) {
    return {
      ...base,
      submissionType: "file",
      filePaths: task.context_packet.file_paths ?? [],
      captureMode: task.context_packet.capture_mode,
      sourceApp: task.context_packet.source_app
    };
  }

  if (isBrowserSource(task)) {
    return {
      ...base,
      submissionType: "browser",
      capture: {
        sourceType: task.context_packet.source_type,
        browser: task.context_packet.source_app,
        url: task.context_packet.url,
        text: task.context_packet.text,
        html: task.context_packet.html,
        pageTitle: task.context_packet.selection_metadata?.page_title,
        contextBefore: task.context_packet.selection_metadata?.context_before,
        contextAfter: task.context_packet.selection_metadata?.context_after,
        anchorText: task.context_packet.selection_metadata?.anchor_text,
        imageUrl: task.context_packet.selection_metadata?.image_url,
        tabId: task.context_packet.selection_metadata?.tab_id
      }
    };
  }

  throw new Error(`Unsupported retry source type: ${task.context_packet.source_type}`);
}

export async function retryTask({
  taskId,
  runtime,
  mode = "retry_same",
  overrides = {}
}) {
  const task = runtime.store.getTask(taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const request = buildRetryRequest(task, mode, overrides);

  if (request.submissionType === "file") {
    return submitFileTask({
      filePaths: request.filePaths,
      userCommand: request.userCommand,
      captureMode: request.captureMode,
      sourceApp: request.sourceApp,
      executionMode: request.executionMode,
      parentTaskId: request.parentTaskId,
      retryCount: request.retryCount,
      executorOverride: request.executorOverride,
      runtime
    });
  }

  return submitBrowserTask({
    capture: request.capture,
    userCommand: request.userCommand,
    executionMode: request.executionMode,
    parentTaskId: request.parentTaskId,
    retryCount: request.retryCount,
    executorOverride: request.executorOverride,
    runtime
  });
}
