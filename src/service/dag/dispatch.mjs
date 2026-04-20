/**
 * Dispatch — Layer 4 bridge for DAG nodes.
 *
 * createNodeDispatcher({runtime}) returns a function(node, params, ctx)
 * that routes each node kind to its concrete invocation target:
 *   mcp_tool / action_tool → runtime.actionToolRegistry
 *   workflow               → connector workflow dispatcher
 *   skill                  → (Phase 6) skill runtime; Phase 2 stubs with
 *                            a clear "not implemented" error
 *   agent_loop             → nested context-submission with
 *                            skipPlanLayer:true so the child task's full
 *                            agent-loop runs without re-entering the
 *                            planner
 *
 * The result returned from each dispatch becomes `results[node.id]` in the
 * executor — placeholders in downstream nodes can address into it.
 */

export function createNodeDispatcher({ runtime }) {
  return async function dispatchNode(node, params, context) {
    if (!node || typeof node.kind !== "string") {
      throw new Error(`dispatchNode: missing node.kind`);
    }

    if (node.kind === "action_tool" || node.kind === "mcp_tool") {
      if (!runtime?.actionToolRegistry) {
        throw new Error(`action tool registry missing from runtime`);
      }
      const toolContext = { ...(runtime.toolContext ?? {}), runtime, task: context?.task ?? null };
      const result = await runtime.actionToolRegistry.call(node.tool, params, toolContext);
      if (result?.success === false) {
        throw new Error(result?.observation ?? `${node.tool} returned success=false`);
      }
      return {
        tool_id: node.tool,
        observation: result?.observation ?? "",
        metadata: result?.metadata ?? {}
      };
    }

    if (node.kind === "workflow") {
      const { runConnectorWorkflow } = await import("../connectors/core/workflow-dispatcher.mjs");
      const result = await runConnectorWorkflow({
        runtime,
        workflowId: node.workflowId,
        input: params ?? {},
        state: params?.state ?? {},
        task: context?.task ?? null,
        emitTaskEvent: runtime?.emitTaskEvent
      });
      if (result.status === "waiting_external_decision") {
        // Returning here lets downstream nodes see the pending approval
        // metadata; execution pauses in the workflow dispatcher's side.
        return {
          connector_status: "waiting_external_decision",
          workflow_id: node.workflowId,
          approval_id: result.approval?.approval_id ?? null,
          outputs: result.outputs ?? {}
        };
      }
      if (result.status !== "success") {
        throw new Error(result.error ?? `workflow ${node.workflowId} failed`);
      }
      return {
        connector_status: "success",
        workflow_id: node.workflowId,
        outputs: result.outputs ?? {},
        result: result.result
      };
    }

    if (node.kind === "agent_loop") {
      const { submitContextTask } = await import("../core/context-submission.mjs");
      const submission = await submitContextTask({
        runtime,
        userCommand: params?.userCommand ?? "",
        contextPacket: {
          schema_version: "1.0",
          source_type: "dag_agent_node",
          source_app: "lingxy.dag",
          capture_mode: "nested",
          security_level: "internal",
          redaction_applied: false,
          text: params?.userCommand ?? "",
          file_paths: params?.file_paths ?? [],
          image_paths: params?.image_paths ?? [],
          captured_at: new Date().toISOString()
        },
        executionMode: "interactive",
        executorOverride: "tool_using",
        parentTaskId: context?.parentTaskId ?? null,
        skipPlanLayer: true
      });
      const events = submission?.taskEvents ?? runtime?.store?.getTaskEvents?.(submission?.task?.task_id) ?? [];
      const success = events.find((event) => event.event_type === "success");
      const inline = events.find((event) => event.event_type === "inline_result");
      const finalText = success?.payload?.text ?? inline?.payload?.text ?? "";
      return {
        task_id: submission?.task?.task_id ?? null,
        text: finalText,
        status: submission?.task?.status ?? "unknown"
      };
    }

    if (node.kind === "skill") {
      throw new Error(`skill kind not yet implemented (Phase 6); requested skill=${node.skill}`);
    }

    throw new Error(`unknown node kind: ${node.kind}`);
  };
}
