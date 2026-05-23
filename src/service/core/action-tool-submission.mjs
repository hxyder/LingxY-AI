import crypto from "node:crypto";
import { routeIntent } from "./router/intent-router.mjs";
import { createActionToolRegistry } from "../capabilities/registry/registry.mjs";
import { BUILTIN_ACTION_TOOLS } from "../action_tools/tools/index.mjs";
import {
  createTaskRecord,
  emitTaskEvent,
  ensureRuntimeServices,
  markTaskFailed,
  markTaskSucceeded,
  submitTaskWithConversation,
  updateTask
} from "./task-runtime.mjs";
import { runToolAgentLoop } from "../executors/tool_using/agent-loop.mjs";
import { createArtifactStore } from "../store/artifact-store.mjs";
import {
  artifactEventFieldsForToolResult,
  artifactRegistrationOptionsForPath,
  rememberArtifactMetadataFromToolEvent
} from "./artifact-action-contract.mjs";
import { shouldPromptForToolApproval } from "../../shared/permission-mode-model.mjs";

function persistArtifacts(runtime, taskId, artifactPaths, { metadataByPath = null, payload = null } = {}) {
  if (!artifactPaths?.length) return;
  const artifactStore = runtime.artifactStore ?? createArtifactStore();
  for (const filePath of artifactPaths) {
    if (!filePath) continue;
    const record = artifactStore.registerArtifact(
      taskId,
      filePath,
      null,
      artifactRegistrationOptionsForPath(filePath, { metadataByPath, payload })
    );
    runtime.store.appendArtifact(record);
  }
}

function buildActionContextPacket({
  userCommand,
  sourceApp = "uca.console",
  captureMode = "manual",
  selectionMetadata = null,
  filePaths = []
}) {
  const normalizedFilePaths = Array.isArray(filePaths)
    ? filePaths.filter((value) => typeof value === "string" && value.trim())
    : [];
  return {
    schema_version: "1.0",
    context_id: `ctx_${crypto.randomUUID()}`,
    trace_id: `trace_${crypto.randomUUID()}`,
    source_type: normalizedFilePaths.length > 0 ? "launchable_file" : "clipboard",
    source_app: sourceApp,
    capture_mode: captureMode,
    security_level: "internal",
    redaction_applied: false,
    text: userCommand,
    ...(normalizedFilePaths.length > 0 ? { file_paths: normalizedFilePaths } : {}),
    ...(selectionMetadata && typeof selectionMetadata === "object"
      ? { selection_metadata: selectionMetadata }
      : {}),
    captured_at: new Date().toISOString()
  };
}

function createFastPathApproval({ runtime, task, toolId, args, risk }) {
  const approval = runtime.pendingApprovals.create({
    sourceType: "agent_tool_call",
    sourceId: task.task_id,
    proposedAction: "action_tool",
    proposedTarget: toolId,
    proposedParams: args ?? {},
    previewText: `Pending tool ${toolId}`,
    metadata: {
      task_id: task.task_id,
      tool_id: toolId,
      risk_level: risk?.risk_level ?? "high",
      reason: risk?.reason ?? "requires_confirmation",
      fast_path: true
    }
  });
  emitTaskEvent({
    runtime,
    taskId: task.task_id,
    eventType: "pending_approval_created",
    payload: {
      approval_id: approval.approval_id,
      tool_id: toolId
    }
  });
  updateTask(runtime, task, {
    status: "partial_success",
    sub_status: "waiting_external_decision",
    retryable: true
  }, true);
  markTaskSucceeded(runtime, task);
  return approval;
}

function summarizeSubmissionBoundaryBlock(boundary) {
  const tools = Array.isArray(boundary?.blocked_tools)
    ? boundary.blocked_tools.map((tool) => tool.tool_id).filter(Boolean)
    : [];
  const toolText = tools.length > 0 ? `tool "${tools.join(", ")}"` : "the requested tool";
  return `Submission blocked by policy: ${toolText} needs user permission under the current task contract.`;
}

export async function submitActionToolTask({
  userCommand,
  executionMode = "interactive",
  sourceApp = "uca.console",
  captureMode = "manual",
  parentTaskId = null,
  conversationId = null,
  conversationTitle = null,
  conversationMetadata = null,
  clientMessageId = null,
  projectId = null,
  retryCount = 0,
  bypassDedupe = false,
  runtime,
  // UCA-066: Tier 0 fast-path — skip the tool-agent loop entirely,
  // call the tool directly and return immediately (< 200ms).
  fastPathTool = null,
  fastPathArgs = null,
  filePaths = [],
  selectionMetadata = null,
  background = false
}) {
  ensureRuntimeServices(runtime);
  const contextPacket = buildActionContextPacket({
    userCommand,
    sourceApp,
    captureMode,
    selectionMetadata,
    filePaths
  });
  const route = routeIntent(userCommand);
  const { task } = submitTaskWithConversation({
    route,
    contextPacket,
    userCommand,
    executionMode,
    parentTaskId,
    conversationId,
    conversationTitle,
    conversationMetadata,
    clientMessageId,
    projectId,
    retryCount,
    bypassDedupe,
    executorOverride: "tool_using",
    submissionKind: "action_tool",
    boundaryContext: fastPathTool ? { requestedToolIds: [fastPathTool] } : null,
    runtime
  });
  if (task.submission_boundary?.blocking) {
    const finalText = summarizeSubmissionBoundaryBlock(task.submission_boundary);
    markTaskFailed(runtime, task, {
      code: "submission_boundary_blocked",
      message: finalText
    });
    return {
      task,
      taskEvents: runtime.store.getTaskEvents(task.task_id),
      artifacts: [],
      blocked: true,
      final_text: finalText
    };
  }
  const enqueued = runtime.queue.enqueue(task);
  if (!enqueued.accepted) {
    updateTask(runtime, task, {
      status: "partial_success",
      sub_status: "deduped_recent_submission"
    }, true);
    emitTaskEvent({
      runtime,
      taskId: task.task_id,
      eventType: "partial_success",
      payload: {
        deduped_task_id: enqueued.dedupedTaskId ?? null
      }
    });
    markTaskSucceeded(runtime, task);
    return {
      task,
      taskEvents: runtime.store.getTaskEvents(task.task_id),
      artifacts: []
    };
  }

  const artifactMetadataByPath = new Map();
  const emitExecutorEvent = (eventType, payload) => {
    if (eventType === "tool_call_completed") {
      rememberArtifactMetadataFromToolEvent(artifactMetadataByPath, payload ?? {});
    }
    emitTaskEvent({
      runtime,
      taskId: task.task_id,
      eventType,
      payload
    });
  };

  emitExecutorEvent("task_created", {
    source_type: contextPacket.source_type,
    executor: task.executor
  });

  const inspection = runtime.securityBroker.inspectContext(contextPacket, {
    taskId: task.task_id,
    trigger: "action_tool_submission"
  });
  if (!inspection.allowed) {
    markTaskFailed(runtime, task, {
      message: `Security broker blocked action tool task: ${inspection.reason}`
    });
    return {
      task,
      taskEvents: runtime.store.getTaskEvents(task.task_id),
      artifacts: []
    };
  }

  task.context_packet = inspection.contextPacket;
  runtime.store.updateTask(task.task_id, task);
  runtime.securityBroker.registerTaskRedactionMap(task.task_id, inspection.redactionMap);

  const execute = async () => {
    updateTask(runtime, task, {
      status: "running",
      sub_status: "tool_loop"
    }, true);
    runtime.queue.markRunning(task.task_id);

    try {
      // UCA-066: Tier 0 fast path — execute single deterministic tool directly,
      // completely bypassing the LLM planner loop. Latency target: < 200ms.
      // Applies to: launch_app, open_url, copy_to_clipboard, notify, open_file.
      if (fastPathTool) {
        // UCA-077 P4-04.5: registry singleton — see agent-loop.mjs for the
        // same invariant. ensureRuntimeServices() at the top of submitActionToolTask
        // guarantees runtime.actionToolRegistry is set; if it is not, we want a
        // loud failure rather than a silent divergent instance.
        if (!runtime.actionToolRegistry) {
          throw new Error("runtime.actionToolRegistry is missing — submission layer should have called ensureRuntimeServices()");
        }
        const registry = runtime.actionToolRegistry;
        const toolContext = { ...(runtime.toolContext ?? {}), outputDir: runtime.toolOutputDir, runtime, task };
        const risk = registry.evaluate(fastPathTool, fastPathArgs ?? {}, toolContext);
        if (shouldPromptForToolApproval({ executionMode: task.execution_mode, risk })) {
          const approval = createFastPathApproval({
            runtime,
            task,
            toolId: fastPathTool,
            args: fastPathArgs ?? {},
            risk
          });
          return {
            task,
            taskEvents: runtime.store.getTaskEvents(task.task_id),
            pendingApproval: approval,
            fast_path: true,
            final_text: `工具 ${fastPathTool} 需要审批后执行。`
          };
        }
        const toolResult = await registry.call(fastPathTool, fastPathArgs ?? {}, toolContext);
        const toolCompletionPayload = {
          tool_id: fastPathTool,
          success: toolResult.success,
          error: toolResult.error ?? null,
          ...artifactEventFieldsForToolResult(fastPathTool, toolResult)
        };
        emitExecutorEvent("tool_call_completed", toolCompletionPayload);
        const finalText = toolResult.observation ?? (toolResult.success ? "完成。" : "操作失败。");
        if (!toolResult.success) {
          markTaskFailed(runtime, task, {
            code: toolResult.error ?? "action_tool_failed",
            message: finalText,
            tool_id: fastPathTool,
            observation: toolResult.observation,
            provider_id: toolResult.metadata?.provider_id ?? toolResult.provider_id,
            provider: toolResult.metadata?.provider ?? toolResult.provider
          });
          persistArtifacts(runtime, task.task_id, toolResult.artifact_paths, { payload: toolCompletionPayload });
          return {
            task,
            taskEvents: runtime.store.getTaskEvents(task.task_id),
            artifacts: toolResult.artifact_paths ?? [],
            fast_path: true,
            final_text: finalText
          };
        }
        updateTask(runtime, task, { status: "success", sub_status: "completed", progress: 1 }, true);
        markTaskSucceeded(runtime, task);
        persistArtifacts(runtime, task.task_id, toolResult.artifact_paths, { payload: toolCompletionPayload });
        return {
          task,
          taskEvents: runtime.store.getTaskEvents(task.task_id),
          artifacts: toolResult.artifact_paths ?? [],
          fast_path: true,
          final_text: finalText
        };
      }

      const loopResult = await runToolAgentLoop({
        task,
        runtime: {
          ...runtime,
          emitTaskEvent: emitExecutorEvent
        }
      });

      if (loopResult.status === "waiting_external_decision") {
        updateTask(runtime, task, {
          status: "partial_success",
          sub_status: "waiting_external_decision",
          retryable: true
        }, true);
        markTaskSucceeded(runtime, task);
        return {
          task,
          taskEvents: runtime.store.getTaskEvents(task.task_id),
          pendingApproval: loopResult.approval
        };
      }

      if (loopResult.status === "partial_success") {
        updateTask(runtime, task, {
          status: "partial_success",
          sub_status: "tool_loop_stopped"
        }, true);
        emitExecutorEvent("partial_success", {
          summary: loopResult.final_text
        });
        markTaskSucceeded(runtime, task);
        persistArtifacts(runtime, task.task_id, loopResult.artifacts, { metadataByPath: artifactMetadataByPath });
        return {
          task,
          taskEvents: runtime.store.getTaskEvents(task.task_id),
          artifacts: loopResult.artifacts ?? []
        };
      }

      if (loopResult.status !== "success") {
        markTaskFailed(runtime, task, {
          message: loopResult.error ?? "Tool loop failed.",
          tool_id: loopResult.failed_tool_id ?? loopResult.tool_id,
          provider_id: loopResult.provider_id,
          provider: loopResult.provider
        });
        return {
          task,
          taskEvents: runtime.store.getTaskEvents(task.task_id),
          artifacts: []
        };
      }

      updateTask(runtime, task, {
        status: "success",
        sub_status: "completed",
        progress: 1
      }, true);
      emitExecutorEvent("success", {
        summary: loopResult.final_text
      });
      markTaskSucceeded(runtime, task);
      persistArtifacts(runtime, task.task_id, loopResult.artifacts, { metadataByPath: artifactMetadataByPath });

      return {
        task,
        taskEvents: runtime.store.getTaskEvents(task.task_id),
        artifacts: loopResult.artifacts ?? []
      };
    } catch (error) {
      markTaskFailed(runtime, task, error);
      return {
        task,
        taskEvents: runtime.store.getTaskEvents(task.task_id),
        artifacts: []
      };
    }
  };

  if (background) {
    setTimeout(() => { void execute(); }, 0);
    return { task, taskEvents: runtime.store.getTaskEvents(task.task_id), artifacts: [], background: true };
  }

  return execute();
}
