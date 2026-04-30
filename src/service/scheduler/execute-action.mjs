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
      trigger_reason: triggerReason,
      scheduler_context: true,
      scheduled_task_fire: true
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
  // UCA-181 follow-up: default was "uca.scheduler", which was wrong
  // for approval-resumed tasks (engine.mjs's executeApprovedAction
  // doesn't pass sourceApp). That false label made create_scheduled_task
  // think the task was a scheduler fire and refuse to create the
  // schedule the user just approved. The default now reflects the
  // common caller — an approval resume — and scheduler dispatch
  // explicitly passes "uca.scheduler" with the scheduled_task_fire
  // metadata when it really IS a fire.
  sourceApp = "uca.approval",
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

  // Scheduled tasks often fire when the user isn't watching. Two notify
  // surfaces:
  //   (a) success path — fired on terminal `success` events with the
  //       agent's final text.
  //   (b) waiting-approval path (UCA-181) — fired when the agent
  //       suspended the task on a side-effect obligation (email_send /
  //       calendar_create / file_upload). Without this, a scheduled
  //       email task would silently sit on a pending_approval forever
  //       because the user wasn't watching the desktop when the
  //       approval card appeared.
  // Approval notifications must still fire for scheduled email/calendar/file
  // tasks even though their command naturally says "send email". The textual
  // notify/email pre-check only suppresses the generic success toast.
  // Best-effort; never blocks task completion.
  try {
    const commandRequestsOwnNotification = /(\bnotify\b|通知|发邮件|send\s+email|account_send_email)/i.test(userCommand);
    if (actionParams.notifyOnComplete !== false
        && sourceApp === "uca.scheduler"
        && captureMode === "event") {
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

        const pendingApprovalEvent = task?.sub_status === "waiting_external_decision"
          ? [...events].reverse().find((e) => e.event_type === "pending_approval_created")
          : null;

        if (pendingApprovalEvent && !agentAlreadyNotified) {
          const approvalId = pendingApprovalEvent.payload?.approval_id ?? "";
          const toolId = pendingApprovalEvent.payload?.tool_id ?? "";
          const previewEvent = [...events].reverse().find(
            (e) => e.event_type === "partial_success"
              && typeof e.payload?.text === "string"
          );
          const previewText = previewEvent?.payload?.text
            ?? `定时任务"${actionTarget}"生成了待确认操作`;
          runtime.actionToolRegistry.call("notify", {
            kind: "approval_pending",
            title: `需要确认：${actionTarget ?? "schedule"}`,
            body: previewText,
            taskId,
            approvalId,
            toolId,
            openWindow: "console",
            allowLongBody: true,
            autoHideMs: 0,
            dedupeKey: `scheduled-approval:${taskId}:${approvalId || toolId}`
          }, { runtime, task })
            .catch(() => { /* ignore */ });
        } else if (!commandRequestsOwnNotification && taskReallyRan && !agentAlreadyNotified) {
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
