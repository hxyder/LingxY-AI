import crypto from "node:crypto";
import { submitContextTask } from "../core/context-submission.mjs";
import { submitActionToolTask } from "../core/action-tool-submission.mjs";
import { submitConnectorWorkflowTask } from "../connectors/core/workflow-submission.mjs";
import {
  createTaskRecord,
  emitTaskEvent,
  ensureRuntimeServices,
  markTaskFailed,
  markTaskSucceeded,
  updateTask
} from "../core/task-runtime.mjs";

function buildSchedulerContextPacket({
  title,
  sourceId,
  filePaths = [],
  imagePaths = [],
  sourceApp = "uca.scheduler",
  captureMode = "event",
  triggerReason = "scheduled"
}) {
  return {
    schema_version: "1.0",
    context_id: `ctx_${crypto.randomUUID()}`,
    trace_id: `trace_${crypto.randomUUID()}`,
    source_type: "window",
    source_app: sourceApp,
    capture_mode: captureMode,
    security_level: "internal",
    redaction_applied: false,
    text: title,
    file_paths: filePaths,
    image_paths: imagePaths,
    selection_metadata: {
      source_id: sourceId,
      trigger_reason: triggerReason
    },
    captured_at: new Date().toISOString()
  };
}

async function executeActionTool({
  runtime,
  actionTarget,
  actionParams,
  executionMode,
  sourceLabel,
  sourceApp = "uca.scheduler",
  captureMode = "event",
  bypassDedupe = false
}) {
  const previousPlanner = runtime.toolPlanner;
  const previousConfirmationHandler = runtime.confirmationHandler;
  let emitted = false;

  runtime.toolPlanner = () => {
    if (!emitted) {
      emitted = true;
      return {
        type: "tool_call",
        tool: actionTarget,
        args: actionParams
      };
    }
    return {
      type: "final",
      text: `Completed scheduled tool ${actionTarget}.`
    };
  };
  runtime.confirmationHandler = () => ({
    decision: "confirm",
    args: actionParams
  });

  try {
    return await submitActionToolTask({
      userCommand: sourceLabel,
      executionMode,
      sourceApp,
      captureMode,
      bypassDedupe,
      runtime
    });
  } finally {
    runtime.toolPlanner = previousPlanner;
    runtime.confirmationHandler = previousConfirmationHandler;
  }
}

async function executeTaskTemplate({
  runtime,
  actionTarget,
  actionParams,
  executionMode,
  sourceLabel,
  sourceId,
  sourceApp = "uca.scheduler",
  captureMode = "event",
  triggerReason = "scheduled",
  bypassDedupe = false
}) {
  ensureRuntimeServices(runtime);

  const inspection = runtime.securityBroker.inspectContext(buildSchedulerContextPacket({
    title: sourceLabel,
    sourceId,
    sourceApp,
    captureMode,
    triggerReason
  }), {
    trigger: "schedule_dispatch"
  });

  const route = {
    intent: "scheduled_task_template",
    executor: "fast",
    requires_confirmation: false
  };

  const task = createTaskRecord({
    route,
    contextPacket: inspection.allowed ? inspection.contextPacket : buildSchedulerContextPacket({
      title: sourceLabel,
      sourceId,
      sourceApp,
      captureMode,
      triggerReason
    }),
    userCommand: sourceLabel,
    executionMode,
    bypassDedupe,
    executorOverride: "fast"
  });

  runtime.store.insertTask(task);
  runtime.queue.enqueue(task);
  emitTaskEvent({
    runtime,
    taskId: task.task_id,
    eventType: "task_created",
    payload: {
      source_type: task.context_packet.source_type,
      schedule_source: sourceId,
      template_id: actionTarget
    }
  });

  if (!inspection.allowed) {
    markTaskFailed(runtime, task, {
      message: `Security broker blocked schedule task: ${inspection.reason}`
    });
    return {
      task,
      taskEvents: runtime.store.getTaskEvents(task.task_id),
      artifacts: []
    };
  }

  runtime.queue.markRunning(task.task_id);
  updateTask(runtime, task, {
    status: "running",
    sub_status: "scheduled_template"
  }, true);
  emitTaskEvent({
    runtime,
    taskId: task.task_id,
    eventType: "step_started",
    payload: {
      step: "scheduled_template",
      template_id: actionTarget,
      params: actionParams
    }
  });
  emitTaskEvent({
    runtime,
    taskId: task.task_id,
    eventType: "step_finished",
    payload: {
      step: "scheduled_template"
    }
  });
  emitTaskEvent({
    runtime,
    taskId: task.task_id,
    eventType: "success",
    payload: {
      text: `Executed template ${actionTarget}`
    }
  });
  updateTask(runtime, task, {
    status: "success",
    sub_status: "completed",
    progress: 1
  }, true);
  markTaskSucceeded(runtime, task);

  return {
    task,
    taskEvents: runtime.store.getTaskEvents(task.task_id),
    artifacts: []
  };
}

async function executeScheduledTask({
  runtime,
  actionTarget,
  actionParams,
  executionMode,
  sourceLabel,
  sourceId,
  sourceApp = "uca.scheduler",
  captureMode = "event",
  triggerReason = "scheduled",
  bypassDedupe = false
}) {
  const userCommand = actionParams.userCommand ?? actionParams.command ?? sourceLabel ?? actionTarget;
  const submission = await submitContextTask({
    contextPacket: buildSchedulerContextPacket({
      title: actionParams.contextText ?? userCommand,
      sourceId,
      filePaths: actionParams.file_paths ?? actionParams.filePaths ?? [],
      imagePaths: actionParams.image_paths ?? actionParams.imagePaths ?? [],
      sourceApp,
      captureMode,
      triggerReason
    }),
    userCommand,
    executionMode,
    bypassDedupe,
    executorOverride: actionParams.executorOverride ?? actionParams.executor ?? null,
    // The plan layer already deferred this task once; skip it so the
    // scheduled run actually executes instead of re-scheduling itself.
    skipPlanLayer: true,
    runtime
  });

  // Scheduled tasks often fire when the user isn't watching. When the task
  // finishes, push a desktop notification with a short summary of the final
  // answer so the user actually sees the result. Skip when:
  //   (a) the scheduled command itself mentions notify / email (regex on
  //       userCommand) — textual pre-check to avoid obvious double-notify
  //   (b) the task was deduped / never really ran — `success` event missing
  //   (c) UCA-098: the task's transcript already shows a successful
  //       `notify` tool_call — otherwise a reminder command like
  //       "提醒我喝水" that the agent already handled by calling notify
  //       produces a SECOND, generic "计划任务完成：提醒我喝水" toast.
  // Best-effort; never blocks task completion.
  try {
    if (actionParams.notifyOnComplete !== false
        && sourceApp === "uca.scheduler"
        && captureMode === "event"
        && !/(\bnotify\b|通知|发邮件|send\s+email|account_send_email)/i.test(userCommand)) {
      const task = submission?.task;
      const taskId = task?.task_id;
      if (taskId && runtime?.actionToolRegistry?.call) {
        const events = runtime.store?.getTaskEvents?.(taskId) ?? [];
        const successEvent = [...events].reverse().find((e) => e.event_type === "success");
        const agentAlreadyNotified = events.some((e) => {
          if (e.event_type !== "tool_call_completed") return false;
          const payload = e.payload ?? {};
          const toolId = payload.tool_id ?? payload.tool;
          return toolId === "notify" && payload.success === true;
        });
        const taskReallyRan = Boolean(successEvent) && task?.status !== "partial_success";
        if (taskReallyRan && !agentAlreadyNotified) {
          const resultText = typeof successEvent?.payload?.text === "string"
            ? successEvent.payload.text
            : (task?.result_summary ?? `定时任务"${actionTarget}"已完成`);
          const title = `计划任务完成：${actionTarget ?? "schedule"}`;
          // Fire and forget — a notify failure must not mark the scheduled
          // run as failed.
          runtime.actionToolRegistry.call("notify", {
            kind: "success",
            title,
            body: resultText,
            taskId,
            openWindow: "overlay",
            allowLongBody: true,
            autoHideMs: 14000,
            dedupeKey: `scheduled-result:${taskId}`
          }, { runtime, task })
            .catch(() => { /* ignore */ });
        }
      }
    }
  } catch { /* silent */ }

  return submission;
}

export async function executeProposedAction({
  runtime,
  actionType,
  actionTarget,
  actionParams = {},
  executionMode = "interactive",
  sourceLabel,
  sourceId,
  sourceApp = "uca.scheduler",
  captureMode = "event",
  triggerReason = "scheduled",
  bypassDedupe = false
}) {
  if (actionType === "connector_workflow") {
    return submitConnectorWorkflowTask({
      runtime,
      workflowId: actionTarget,
      input: actionParams.input ?? {},
      state: actionParams.state ?? {},
      userCommand: sourceLabel,
      executionMode,
      bypassDedupe
    });
  }

  if (actionType === "action_tool") {
    return executeActionTool({
      runtime,
      actionTarget,
      actionParams,
      executionMode,
      sourceLabel,
      sourceApp,
      captureMode,
      bypassDedupe
    });
  }

  if (actionType === "task") {
    return executeScheduledTask({
      runtime,
      actionTarget,
      actionParams,
      executionMode,
      sourceLabel,
      sourceId,
      sourceApp,
      captureMode,
      triggerReason,
      bypassDedupe
    });
  }

  return executeTaskTemplate({
    runtime,
    actionTarget,
    actionParams,
    executionMode,
    sourceLabel,
    sourceId,
    sourceApp,
    captureMode,
    triggerReason,
    bypassDedupe
  });
}
