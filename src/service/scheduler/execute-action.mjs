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

function buildSchedulerContextPacket({ title, sourceId }) {
  return {
    schema_version: "1.0",
    context_id: `ctx_${crypto.randomUUID()}`,
    trace_id: `trace_${crypto.randomUUID()}`,
    source_type: "window",
    source_app: "uca.scheduler",
    capture_mode: "event",
    security_level: "internal",
    redaction_applied: false,
    text: title,
    selection_metadata: {
      source_id: sourceId
    },
    captured_at: new Date().toISOString()
  };
}

async function executeActionTool({ runtime, actionTarget, actionParams, executionMode, sourceLabel }) {
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
      sourceApp: "uca.scheduler",
      captureMode: "event",
      runtime
    });
  } finally {
    runtime.toolPlanner = previousPlanner;
    runtime.confirmationHandler = previousConfirmationHandler;
  }
}

async function executeTaskTemplate({ runtime, actionTarget, actionParams, executionMode, sourceLabel, sourceId }) {
  ensureRuntimeServices(runtime);

  const inspection = runtime.securityBroker.inspectContext(buildSchedulerContextPacket({
    title: sourceLabel,
    sourceId
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
      sourceId
    }),
    userCommand: sourceLabel,
    executionMode,
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

async function executeScheduledTask({ runtime, actionTarget, actionParams, executionMode, sourceLabel, sourceId }) {
  const userCommand = actionParams.userCommand ?? actionParams.command ?? sourceLabel ?? actionTarget;
  return submitContextTask({
    contextPacket: buildSchedulerContextPacket({
      title: actionParams.contextText ?? userCommand,
      sourceId
    }),
    userCommand,
    executionMode,
    executorOverride: actionParams.executorOverride ?? actionParams.executor ?? null,
    runtime
  });
}

export async function executeProposedAction({
  runtime,
  actionType,
  actionTarget,
  actionParams = {},
  executionMode = "interactive",
  sourceLabel,
  sourceId
}) {
  if (actionType === "connector_workflow") {
    return submitConnectorWorkflowTask({
      runtime,
      workflowId: actionTarget,
      input: actionParams.input ?? {},
      state: actionParams.state ?? {},
      userCommand: sourceLabel,
      executionMode
    });
  }

  if (actionType === "action_tool") {
    return executeActionTool({
      runtime,
      actionTarget,
      actionParams,
      executionMode,
      sourceLabel
    });
  }

  if (actionType === "task") {
    return executeScheduledTask({
      runtime,
      actionTarget,
      actionParams,
      executionMode,
      sourceLabel,
      sourceId
    });
  }

  return executeTaskTemplate({
    runtime,
    actionTarget,
    actionParams,
    executionMode,
    sourceLabel,
    sourceId
  });
}
