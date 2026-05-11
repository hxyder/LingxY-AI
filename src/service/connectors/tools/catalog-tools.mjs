import { createActionResult } from "../../capabilities/registry/types.mjs";
import { createConnectorCatalog } from "../core/catalog.mjs";
import { runConnectorWorkflow } from "../core/workflow-dispatcher.mjs";

function getCatalog(ctx = {}) {
  return ctx.runtime?.connectorCatalog ?? createConnectorCatalog();
}

function compactSearchResults(results = {}) {
  return {
    providers: results.providers ?? [],
    tools: results.tools ?? [],
    workflows: results.workflows ?? []
  };
}

export const CONNECTOR_CATALOG_SEARCH_TOOL = {
  id: "connector_catalog_search",
  name: "Connector Catalog Search",
  description: "Search provider connector contracts, workflows, and MCP-compatible tool summaries without loading every schema into context.",
  parameters: {
    type: "object",
    required: [],
    properties: {
      query: { type: "string" },
      provider: { type: "string" },
      service: { type: "string" },
      capability: { type: "string" },
      intent: { type: "string" }
    }
  },
  risk_level: "low",
  required_capabilities: [],
  requires_confirmation: false,
  async execute(args = {}, ctx = {}) {
    const catalog = getCatalog(ctx);
    const results = compactSearchResults(catalog.search(args.query ?? "", {
      provider: args.provider,
      service: args.service,
      capability: args.capability,
      intent: args.intent
    }));
    const count = results.providers.length + results.tools.length + results.workflows.length;
    return createActionResult({
      success: true,
      observation: `Connector catalog search returned ${count} result(s).`,
      metadata: {
        tool_id: "connector_catalog_search",
        ...results
      }
    });
  }
};

export const CONNECTOR_CATALOG_GET_TOOL = {
  id: "connector_catalog_get",
  name: "Connector Catalog Get",
  description: "Read one full connector tool or workflow contract by id after connector_catalog_search finds it.",
  parameters: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string" },
      kind: { type: "string", enum: ["tool", "workflow"] }
    }
  },
  risk_level: "low",
  required_capabilities: [],
  requires_confirmation: false,
  async execute(args = {}, ctx = {}) {
    const id = String(args.id ?? "").trim();
    if (!id) {
      return createActionResult({
        success: false,
        observation: "id required",
        metadata: { tool_id: "connector_catalog_get" }
      });
    }
    const catalog = getCatalog(ctx);
    const item = args.kind === "workflow"
      ? catalog.getWorkflow(id)
      : args.kind === "tool"
        ? catalog.getTool(id)
        : catalog.getTool(id) ?? catalog.getWorkflow(id);
    if (!item) {
      return createActionResult({
        success: false,
        observation: `No connector catalog entry found for ${id}.`,
        metadata: { tool_id: "connector_catalog_get", id }
      });
    }
    return createActionResult({
      success: true,
      observation: `Loaded connector catalog entry ${id}.`,
      metadata: {
        tool_id: "connector_catalog_get",
        id,
        entry: item
      }
    });
  }
};

export const CONNECTOR_WORKFLOW_RUN_TOOL = {
  id: "connector_workflow_run",
  name: "Connector Workflow Run",
  description: "Run a provider-neutral connector workflow by id. The workflow handles timeline events, confirmation, and output validation.",
  parameters: {
    type: "object",
    required: ["workflowId"],
    properties: {
      workflowId: { type: "string" },
      input: { type: "object" },
      state: { type: "object" }
    }
  },
  risk_level: "medium",
  required_capabilities: [],
  requires_confirmation: false,
  async execute(args = {}, ctx = {}) {
    const runtime = ctx.runtime;
    if (!runtime) {
      return createActionResult({
        success: false,
        observation: "connector runtime missing",
        metadata: { tool_id: "connector_workflow_run" }
      });
    }

    const workflowId = String(args.workflowId ?? args.id ?? "").trim();
    if (!workflowId) {
      return createActionResult({
        success: false,
        observation: "workflowId required",
        metadata: { tool_id: "connector_workflow_run" }
      });
    }

    const result = await runConnectorWorkflow({
      runtime,
      workflowId,
      input: args.input ?? {},
      state: args.state ?? {},
      task: ctx.task ?? null,
      emitTaskEvent: runtime.emitTaskEvent
    });

    if (result.status === "waiting_external_decision") {
      return createActionResult({
        success: true,
        observation: "Waiting for user confirmation.",
        metadata: {
          tool_id: "connector_workflow_run",
          connector_status: "waiting_external_decision",
          workflow_id: workflowId,
          approval: result.approval,
          outputs: result.outputs,
          timeline: result.timeline
        }
      });
    }

    if (result.status !== "success") {
      return createActionResult({
        success: false,
        observation: result.error ?? "Connector workflow failed.",
        metadata: {
          tool_id: "connector_workflow_run",
          connector_status: result.status,
          workflow_id: workflowId,
          outputs: result.outputs,
          timeline: result.timeline,
          validation: result.validation
        }
      });
    }

    return createActionResult({
      success: true,
      observation: result.result?.observation ?? `${workflowId} completed.`,
      metadata: {
        tool_id: "connector_workflow_run",
        connector_status: "success",
        workflow_id: workflowId,
        outputs: result.outputs,
        timeline: result.timeline
      }
    });
  }
};
