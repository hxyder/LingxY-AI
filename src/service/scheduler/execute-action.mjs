import crypto from "node:crypto";
import { submitContextTask } from "../core/context-submission.mjs";
import { submitActionToolTask } from "../core/action-tool-submission.mjs";
import { submitConnectorWorkflowTask } from "../connectors/core/workflow-submission.mjs";
import { buildSideEffectContract } from "../core/policy/side-effect-contracts.mjs";
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
  triggerReason = "scheduled",
  selectionMetadata = {}
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
      scheduled_task_fire: true,
      ...selectionMetadata
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
  if (!runtime.actionToolRegistry?.get?.(actionTarget)) {
    throw new Error(`Unknown scheduled action tool: ${actionTarget}`);
  }

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

const REMINDER_FIRE_PATTERN = /(?:提醒我|提醒用户|提醒一下|提醒|remind\s+me|notify\s+me|alert\s+me|set\s+(?:a\s+)?reminder|reminder)/i;
const SCHEDULE_TIME_WORD_PATTERN = /(?:现在|今天|今晚|明天|后天|下周|这周|本周|上午|下午|晚上|早上|中午|凌晨|\d{1,2}\s*(?:点|[:：.])\s*(?:半|\d{1,2}\s*分?)?|\d+\s*(?:分钟|小时|天|minute|minutes|hour|hours|day|days)\s*(?:以后|后|later|from now))/gi;

function cleanReminderText(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const cleaned = text
    .replace(SCHEDULE_TIME_WORD_PATTERN, " ")
    .replace(/(?:请)?(?:现在)?\s*(?:提醒我|提醒用户|提醒一下|提醒|remind\s+me\s+to|remind\s+me|notify\s+me\s+to|notify\s+me|alert\s+me\s+to|alert\s+me)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || text;
}

function buildDirectReminderNotifyArgs({ userCommand, actionTarget, actionParams = {}, sourceLabel }) {
  const reminderSources = [
    userCommand,
    actionParams.userCommand,
    actionParams.contextText,
    actionParams.message,
    actionParams.body,
    actionTarget,
    sourceLabel
  ].filter(Boolean).map(String);
  if (!reminderSources.some((value) => REMINDER_FIRE_PATTERN.test(value))) {
    return null;
  }

  const rawBody = actionParams.body
    ?? actionParams.message
    ?? userCommand
    ?? actionParams.userCommand
    ?? actionParams.contextText
    ?? actionTarget
    ?? "时间到了";
  const body = cleanReminderText(rawBody);
  const title = actionParams.title
    ?? (actionTarget && actionTarget !== "context_task" ? cleanReminderText(actionTarget) : null)
    ?? "LingxY 提醒";

  return {
    kind: "info",
    title: title || "LingxY 提醒",
    body: body || String(rawBody),
    openWindow: "overlay",
    allowContinue: false,
    autoHideMs: actionParams.autoHideMs ?? 14000,
    dedupeKey: actionParams.dedupeKey ?? null
  };
}

export function buildScheduledSideEffectAuthorization({
  scheduleContext,
  sideEffectContract
}) {
  if (!scheduleContext?.schedule_id) {
    return null;
  }
  if (scheduleContext?.execution_mode === "approval_required") {
    return null;
  }
  const groups = Object.keys(sideEffectContract?.groups ?? {});
  if (groups.length === 0) {
    return null;
  }
  return {
    kind: "scheduled_fire",
    decision: "preauthorized",
    source: "schedule_definition",
    schedule_id: scheduleContext?.schedule_id ?? null,
    execution_mode: scheduleContext?.execution_mode ?? null,
    groups
  };
}

async function executeScheduledTask({
  runtime,
  actionTarget,
  actionParams,
  executionMode,
  sourceLabel,
  sourceId,
  scheduleContext = null,
  sourceApp = "uca.scheduler",
  captureMode = "event",
  triggerReason = "scheduled",
  bypassDedupe = false
}) {
  const userCommand = actionParams.userCommand ?? actionParams.command ?? sourceLabel ?? actionTarget;
  const storedSideEffectContract = scheduleContext?.metadata?.side_effect_contract
    ?? actionParams.side_effect_contract
    ?? null;
  const sideEffectContract = buildSideEffectContract({
    runtime,
    existingContract: storedSideEffectContract,
    inferPolicyGroups: !storedSideEffectContract,
    includeEntityValues: !storedSideEffectContract,
    sources: storedSideEffectContract
      ? []
      : [
          scheduleContext?.name,
          scheduleContext?.description,
          scheduleContext?.action_target,
          userCommand,
          actionParams.contextText
        ].filter(Boolean),
    task: storedSideEffectContract
      ? null
      : {
          user_command: userCommand,
          context_packet: {
            text: [
              scheduleContext?.name,
              scheduleContext?.description,
              scheduleContext?.action_target,
              userCommand,
              actionParams.contextText
            ].filter(Boolean).join("\n"),
            file_paths: actionParams.file_paths ?? actionParams.filePaths ?? [],
            selection_metadata: {
              schedule_name: scheduleContext?.name ?? null,
              schedule_description: scheduleContext?.description ?? null,
              schedule_action_target: scheduleContext?.action_target ?? actionTarget
            }
          }
        }
  });
  const sideEffectAuthorization = buildScheduledSideEffectAuthorization({
    scheduleContext,
    sideEffectContract
  });
  const directReminder = buildDirectReminderNotifyArgs({
    userCommand,
    actionTarget,
    actionParams,
    sourceLabel
  });
  if (directReminder) {
    return submitActionToolTask({
      userCommand,
      executionMode,
      sourceApp,
      captureMode,
      bypassDedupe,
      runtime,
      fastPathTool: "notify",
      fastPathArgs: {
        ...directReminder,
        dedupeKey: directReminder.dedupeKey ?? `scheduled-reminder:${sourceId ?? actionTarget ?? userCommand}`
      }
    });
  }

  const submission = await submitContextTask({
    contextPacket: buildSchedulerContextPacket({
      title: actionParams.contextText ?? userCommand,
      sourceId,
      filePaths: actionParams.file_paths ?? actionParams.filePaths ?? [],
      imagePaths: actionParams.image_paths ?? actionParams.imagePaths ?? [],
      sourceApp,
      captureMode,
      triggerReason,
      selectionMetadata: {
        schedule_name: scheduleContext?.name ?? null,
        schedule_description: scheduleContext?.description ?? null,
        schedule_action_target: scheduleContext?.action_target ?? actionTarget,
        ...(sideEffectContract ? { side_effect_contract: sideEffectContract } : {}),
        ...(sideEffectAuthorization ? { side_effect_authorization: sideEffectAuthorization } : {})
      }
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
  scheduleContext = null,
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
      scheduleContext,
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
