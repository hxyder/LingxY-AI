import { createActionResult } from "../../action_tools/types.mjs";
import { evaluateToolRisk } from "../../action_tools/risk_matrix.mjs";
import {
  applySideEffectContractToWorkflowInput,
  policyGroupsForConnectorWorkflow
} from "../../core/policy/side-effect-contracts.mjs";

function nowMs() {
  return Date.now();
}

function asArray(value) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function isApproved(state = {}) {
  return state.confirmation?.approved === true || state.confirmationApproved === true;
}

function isCompleted(state = {}, stepId) {
  return Array.isArray(state.completedStepIds) && state.completedStepIds.includes(stepId);
}

function addCompleted(state = {}, stepId) {
  return {
    ...state,
    completedStepIds: [...new Set([...(state.completedStepIds ?? []), stepId])]
  };
}

function readPath(target, expression = "") {
  return String(expression)
    .split(".")
    .filter(Boolean)
    .reduce((cursor, part) => cursor?.[part], target);
}

function requirementMet(memory, expression = "") {
  const value = readPath(memory, expression);
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return value !== null && value !== undefined && value !== false;
}

function conditionMet(condition, memory) {
  if (!condition) {
    return true;
  }
  if (condition === "confirmation.approved") {
    return memory.confirmation?.approved === true;
  }
  if (condition.startsWith("exists:")) {
    return requirementMet(memory, condition.slice("exists:".length));
  }
  return false;
}

function buildPreviewText({ workflow, input = {}, outputs = {} }) {
  const target = input.to ? `To: ${asArray(input.to).join(", ")}\n` : "";
  const subject = input.subject ? `Subject: ${input.subject}\n` : "";
  const title = input.title ? `Title: ${input.title}\n` : "";
  const time = input.startTime || input.endTime ? `Time: ${input.startTime ?? ""}${input.endTime ? ` - ${input.endTime}` : ""}\n` : "";
  const body = input.body ? `\n${input.body}` : "";
  const outputKeys = Object.keys(outputs);
  const outputNote = outputKeys.length ? `\nPrepared outputs: ${outputKeys.join(", ")}` : "";
  return `${workflow.name ?? workflow.id}\n${target}${subject}${title}${time}${body}${outputNote}`.trim();
}

function summarizeInput(input = {}) {
  if (input.to) {
    return `to ${asArray(input.to).join(", ")}`;
  }
  if (input.title) {
    return String(input.title);
  }
  if (input.query) {
    return String(input.query);
  }
  if (input.localPath) {
    return String(input.localPath);
  }
  return "ready";
}

function createLocalPreview(tool, input = {}) {
  const to = asArray(input.to);
  const cc = asArray(input.cc);
  const bcc = asArray(input.bcc);
  const subject = String(input.subject ?? "").trim();
  const body = String(input.body ?? "").trim();
  const lines = [
    to.length ? `To: ${to.join(", ")}` : null,
    cc.length ? `Cc: ${cc.join(", ")}` : null,
    bcc.length ? `Bcc: ${bcc.join(", ")}` : null,
    subject ? `Subject: ${subject}` : null,
    "",
    body
  ].filter((line) => line !== null);
  return {
    draft_preview: lines.join("\n"),
    subject,
    body,
    to,
    cc,
    bcc,
    pending_confirmation: true,
    tool_id: tool.id
  };
}

function normalizeActionOutput(toolId, result = {}) {
  return {
    success: result.success === true,
    sent: result.success === true,
    observation: result.observation ?? "",
    ...(result.metadata ?? {}),
    tool_id: toolId
  };
}

function resolveScheduledWorkflowAuthorization({ workflowId, task }) {
  const metadata = task?.context_packet?.selection_metadata ?? {};
  if (metadata.scheduled_task_fire !== true) {
    return { authorized: false };
  }
  const authorization = metadata.side_effect_authorization;
  if (authorization?.kind !== "scheduled_fire" || authorization.decision !== "preauthorized") {
    return { authorized: false };
  }
  const authorizedGroups = new Set(authorization.groups ?? []);
  const contractGroups = new Set(Object.keys(metadata.side_effect_contract?.groups ?? {}));
  const workflowGroups = policyGroupsForConnectorWorkflow(workflowId);
  const group = workflowGroups.find((candidate) =>
    authorizedGroups.has(candidate) && contractGroups.has(candidate)
  );
  if (!group) {
    return { authorized: false };
  }
  return {
    authorized: true,
    group,
    source: authorization.source ?? "schedule_definition",
    schedule_id: authorization.schedule_id ?? null
  };
}

function createTimelineEvent({ type, workflow, step, tool = null, status, durationMs = null, summary = "" }) {
  return {
    type,
    workflow_id: workflow.id,
    workflow_name: workflow.name,
    step_id: step?.id ?? null,
    step_type: step?.type ?? (step?.tool ? "tool" : null),
    provider: workflow.provider,
    service: workflow.service,
    tool_id: tool?.id ?? step?.tool ?? null,
    label: tool?.timeline?.label ?? tool?.name ?? step?.id ?? workflow.name,
    status,
    durationMs,
    summary,
    payloadPolicy: tool?.timeline?.payloadPolicy ?? workflow.timeline?.payloadPolicy ?? "summary_only"
  };
}

function emit(emitTaskEvent, eventType, payload) {
  if (typeof emitTaskEvent === "function") {
    emitTaskEvent(eventType, payload);
  }
}

async function executeConnectorTool({ runtime, workflow, step, tool, input, task, emitTaskEvent }) {
  const startedAt = nowMs();
  emit(emitTaskEvent, "tool_call_proposed", {
    tool_id: tool.id,
    label: tool.timeline?.label ?? tool.name,
    workflow_id: workflow.id,
    step_id: step.id,
    provider: workflow.provider,
    service: workflow.service,
    summary: summarizeInput(input)
  });

  if (tool.execution?.kind === "local_preview") {
    const output = createLocalPreview(tool, input);
    const validation = runtime.connectorCatalog.validateOutput(tool.id, output);
    emit(emitTaskEvent, "tool_call_completed", {
      tool_id: tool.id,
      label: tool.timeline?.label ?? tool.name,
      workflow_id: workflow.id,
      step_id: step.id,
      provider: workflow.provider,
      service: workflow.service,
      success: validation.ok,
      durationMs: nowMs() - startedAt,
      summary: validation.ok ? "Preview prepared." : "Preview validation failed.",
      validation
    });
    return {
      status: validation.ok ? "success" : "failed",
      output,
      validation
    };
  }

  if (tool.execution?.kind === "external_mcp") {
    if (tool.requiresConfirmation && !isApproved(input.__workflowState ?? {})) {
      return {
        status: "confirmation_required",
        tool,
        args: input,
        risk: { risk_level: tool.risk ?? "medium", requires_confirmation: true }
      };
    }
    const serverId = tool.execution.serverId;
    const mcpServer = runtime.mcpRegistry?.get?.(serverId);
    if (!mcpServer) {
      return { status: "failed", error: `External MCP server not registered: ${serverId}` };
    }
    try {
      const { getMcpClient } = await import("../../ai/mcp/client-bridge.mjs");
      const client = runtime.__mcpClientOverride?.(serverId) ?? await getMcpClient(mcpServer);
      if (!client) {
        return { status: "failed", error: `External MCP client unavailable for server: ${serverId}` };
      }
      const callArgs = { ...input };
      delete callArgs.__workflowState;
      const response = await client.callTool({
        name: tool.execution.toolName,
        arguments: callArgs
      });
      const text = (response.content ?? [])
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      const success = response.isError !== true;
      const output = {
        sent: success,
        success,
        observation: text || (success ? "MCP tool completed." : "MCP tool returned an error."),
        metadata: { mcp_server: serverId, mcp_tool: tool.execution.toolName }
      };
      const validation = runtime.connectorCatalog.validateOutput(tool.id, output);
      emit(emitTaskEvent, "tool_call_completed", {
        tool_id: tool.id,
        label: tool.timeline?.label ?? tool.name,
        workflow_id: workflow.id,
        step_id: step.id,
        provider: workflow.provider,
        service: workflow.service,
        success: success && validation.ok,
        durationMs: nowMs() - startedAt,
        summary: success ? (text.slice(0, 120) || "MCP tool completed.") : "MCP tool failed.",
        validation
      });
      return {
        status: success && validation.ok ? "success" : "failed",
        output,
        validation
      };
    } catch (error) {
      return { status: "failed", error: `External MCP call failed: ${error.message}` };
    }
  }

  const actionToolId = tool.execution?.actionTool;
  if (!actionToolId) {
    return {
      status: "failed",
      error: `Connector tool ${tool.id} has no executable action mapping.`
    };
  }

  const actionTool = runtime.actionToolRegistry?.get?.(actionToolId);
  if (!actionTool) {
    return {
      status: "failed",
      error: `Mapped action tool not found: ${actionToolId}`
    };
  }

  const args = {
    ...input,
    ...(tool.execution?.provider ? { provider: tool.execution.provider } : {})
  };
  const toolContext = {
    ...(runtime.toolContext ?? {}),
    runtime,
    task
  };
  const risk = evaluateToolRisk(actionTool, args, toolContext);
  if (risk.requires_confirmation && !isApproved(input.__workflowState ?? {})) {
    return {
      status: "confirmation_required",
      tool,
      args,
      risk
    };
  }

  const result = await runtime.actionToolRegistry.call(actionToolId, args, toolContext);
  const output = normalizeActionOutput(tool.id, result);
  const validation = runtime.connectorCatalog.validateOutput(tool.id, output);
  const success = result.success === true && validation.ok;
  emit(emitTaskEvent, "tool_call_completed", {
    tool_id: tool.id,
    action_tool_id: actionToolId,
    label: tool.timeline?.label ?? tool.name,
    workflow_id: workflow.id,
    step_id: step.id,
    provider: workflow.provider,
    service: workflow.service,
    success,
    durationMs: nowMs() - startedAt,
    summary: result.observation ?? (success ? "Completed." : "Failed."),
    validation
  });
  // On failure, surface the connector's actual error text so the
  // workflow runner can propagate something more useful than the
  // generic "Connector workflow tool failed." fallback. Validation
  // failures get a structured prefix; tool-layer failures get the
  // raw observation (which already includes the API error message).
  const failureError = !success
    ? (result.success !== true
      ? (result.observation
        || result.metadata?.message
        || result.metadata?.errorCode
        || result.metadata?.connector_status
        || `${tool.id} 调用失败。`)
      : (validation.ok === false
        ? `${tool.id} 输出校验失败：${(validation.failures ?? []).map((f) => f.path ?? f.message ?? f).join("; ") || "missing required fields"}`
        : `${tool.id} 调用失败。`))
    : null;
  return {
    status: success ? "success" : "failed",
    output,
    actionResult: result,
    validation,
    error: failureError
  };
}

function createWorkflowApproval({ runtime, workflow, step, input, state, outputs, task }) {
  const approval = runtime.pendingApprovals.create({
    sourceType: "connector_workflow",
    sourceId: task?.task_id ? `${task.task_id}:${workflow.id}:${step.id}` : `${workflow.id}:${step.id}`,
    proposedAction: "connector_workflow",
    proposedTarget: workflow.id,
    proposedParams: {
      input,
      state: {
        ...state,
        outputs,
        confirmation: { approved: true }
      }
    },
    previewText: buildPreviewText({ workflow, input, outputs }),
    metadata: {
      workflow_id: workflow.id,
      step_id: step.id,
      provider: workflow.provider,
      service: workflow.service,
      task_id: task?.task_id ?? null
    }
  });
  return approval;
}

export async function runConnectorWorkflow({
  runtime,
  workflowId,
  input = {},
  state = {},
  task = null,
  emitTaskEvent = null
} = {}) {
  const catalog = runtime?.connectorCatalog;
  if (!catalog) {
    throw new Error("connector catalog unavailable");
  }
  const workflow = catalog.getWorkflow(workflowId);
  if (!workflow) {
    throw new Error(`Unknown connector workflow: ${workflowId}`);
  }
  if (!isApproved(state)) {
    input = applySideEffectContractToWorkflowInput(workflowId, input, { task, runtime });
  }
  const outputs = {
    ...(state.outputs ?? {})
  };
  const scheduledAuthorization = resolveScheduledWorkflowAuthorization({ workflowId, task });
  let nextState = {
    ...state,
    confirmation: state.confirmation
      ?? (state.confirmationApproved ? { approved: true } : undefined)
      ?? (scheduledAuthorization.authorized
        ? {
            approved: true,
            source: scheduledAuthorization.source,
            group: scheduledAuthorization.group
          }
        : undefined)
  };
  const timeline = [];

  emit(emitTaskEvent, "step_started", {
    step: "connector_workflow",
    workflow_id: workflow.id,
    provider: workflow.provider,
    service: workflow.service
  });
  if (scheduledAuthorization.authorized && !isApproved(state)) {
    emit(emitTaskEvent, "side_effect_authorization_applied", {
      workflow_id: workflow.id,
      group: scheduledAuthorization.group,
      source: scheduledAuthorization.source,
      schedule_id: scheduledAuthorization.schedule_id
    });
  }

  for (const step of workflow.steps ?? []) {
    if (!step?.id || isCompleted(nextState, step.id)) {
      continue;
    }

    const memory = {
      input,
      outputs,
      confirmation: nextState.confirmation ?? {},
      ...outputs
    };

    if (!conditionMet(step.condition, memory)) {
      continue;
    }

    const missing = (step.requires ?? []).filter((requirement) => !requirementMet(memory, requirement));
    if (missing.length > 0) {
      return {
        status: "failed",
        workflow,
        outputs,
        timeline,
        error: `Workflow step ${step.id} missing required output: ${missing.join(", ")}`
      };
    }

    const startedAt = nowMs();
    emit(emitTaskEvent, "step_started", {
      step: step.id,
      workflow_id: workflow.id,
      provider: workflow.provider,
      service: workflow.service,
      step_type: step.type ?? (step.tool ? "tool" : "unknown")
    });

    if (step.type === "user.confirm") {
      if (isApproved(nextState)) {
        nextState = addCompleted(nextState, step.id);
        continue;
      }
      const approval = createWorkflowApproval({
        runtime,
        workflow,
        step,
        input,
        state: addCompleted(nextState, step.id),
        outputs,
        task
      });
      const event = createTimelineEvent({
        type: "user.confirm",
        workflow,
        step,
        status: "pending",
        durationMs: nowMs() - startedAt,
        summary: "Waiting for user confirmation."
      });
      timeline.push(event);
      emit(emitTaskEvent, "pending_approval_created", {
        approval_id: approval.approval_id,
        workflow_id: workflow.id,
        provider: workflow.provider,
        service: workflow.service,
        step_id: step.id,
        summary: event.summary
      });
      return {
        status: "waiting_external_decision",
        workflow,
        outputs,
        timeline,
        approval
      };
    }

    if (step.type === "preview") {
      outputs[step.output ?? step.id] = {
        ...input,
        pending_confirmation: true
      };
      nextState = addCompleted(nextState, step.id);
      timeline.push(createTimelineEvent({
        type: "preview",
        workflow,
        step,
        status: "completed",
        durationMs: nowMs() - startedAt,
        summary: "Preview prepared."
      }));
      continue;
    }

    if (step.tool) {
      const tool = catalog.getTool(step.tool);
      if (!tool) {
        return {
          status: "failed",
          workflow,
          outputs,
          timeline,
          error: `Workflow tool not found: ${step.tool}`
        };
      }

      const executionInput = {
        ...input,
        __workflowState: nextState
      };
      const result = await executeConnectorTool({
        runtime,
        workflow,
        step,
        tool,
        input: executionInput,
        task,
        emitTaskEvent
      });

      if (result.status === "confirmation_required") {
        const approval = createWorkflowApproval({
          runtime,
          workflow,
          step,
          input,
          state: nextState,
          outputs,
          task
        });
        return {
          status: "waiting_external_decision",
          workflow,
          outputs,
          timeline,
          approval
        };
      }

      if (result.status !== "success") {
        return {
          status: "failed",
          workflow,
          outputs,
          timeline,
          error: result.error ?? "Connector workflow tool failed.",
          validation: result.validation
        };
      }

      outputs[step.output ?? step.id] = result.output;
      nextState = addCompleted(nextState, step.id);
      timeline.push(createTimelineEvent({
        type: "tool_call",
        workflow,
        step,
        tool,
        status: "completed",
        durationMs: nowMs() - startedAt,
        summary: result.actionResult?.observation ?? "Completed."
      }));
      continue;
    }

    return {
      status: "failed",
      workflow,
      outputs,
      timeline,
      error: `Unsupported workflow step: ${step.id}`
    };
  }

  emit(emitTaskEvent, "step_finished", {
    step: "connector_workflow",
    workflow_id: workflow.id,
    provider: workflow.provider,
    service: workflow.service
  });

  return {
    status: "success",
    workflow,
    outputs,
    timeline,
    result: createActionResult({
      success: true,
      observation: `${workflow.name ?? workflow.id} completed.`,
      metadata: {
        workflow_id: workflow.id,
        provider: workflow.provider,
        service: workflow.service,
        outputs,
        timeline
      }
    })
  };
}
