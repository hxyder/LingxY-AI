/**
 * Internal MCP server: re-exports the connector catalog to any MCP-capable
 * client (Claude Desktop, Codex, MCP Inspector) via stdio.
 *
 * It does *not* replace the in-process catalog — the workflow dispatcher and
 * risk matrix still own execution. This layer only translates MCP JSON-RPC
 * into catalog calls.
 */

import { runConnectorWorkflow } from "../../../connectors/core/workflow-dispatcher.mjs";

function mcpToolNameForWorkflow(workflow) {
  const id = String(workflow.id ?? "").replace(/[^A-Za-z0-9]+/g, "_");
  return `workflow_${id}`;
}

function mcpToolNameForTool(tool) {
  return tool.mcpName ?? String(tool.id ?? "").replace(/[^A-Za-z0-9]+/g, "_");
}

function describeWorkflowForMcp(workflow) {
  return {
    name: mcpToolNameForWorkflow(workflow),
    title: workflow.name ?? workflow.id,
    description: workflow.description ?? `Connector workflow ${workflow.id}`,
    inputSchema: workflow.inputSchema ?? {
      type: "object",
      properties: {
        input: { type: "object", description: "Workflow inputs" },
        state: { type: "object", description: "Resume state; pass {} on first call" }
      }
    },
    annotations: {
      provider: workflow.provider,
      service: workflow.service,
      risk: workflow.risk ?? "medium",
      kind: "workflow"
    }
  };
}

function describeToolForMcp(tool) {
  return {
    name: mcpToolNameForTool(tool),
    title: tool.name,
    description: tool.description ?? `${tool.id} connector tool`,
    inputSchema: tool.inputSchema ?? { type: "object", properties: {}, required: [] },
    annotations: {
      provider: tool.provider,
      service: tool.service,
      risk: tool.risk ?? "medium",
      kind: "tool",
      requiresConfirmation: tool.requiresConfirmation === true
    }
  };
}

function asContentText(text) {
  return [{ type: "text", text: String(text) }];
}

function formatWorkflowOutputAsText(result, workflow) {
  const summary = [
    `workflow: ${workflow.id}`,
    `status: ${result.status}`,
    `outputs: ${JSON.stringify(result.outputs ?? {}, null, 2)}`
  ];
  if (result.approval?.approval_id) {
    summary.push(`approval_id: ${result.approval.approval_id}`);
  }
  if (result.error) {
    summary.push(`error: ${result.error}`);
  }
  return summary.join("\n");
}

function formatActionResultAsText(toolId, actionResult) {
  return [
    `tool: ${toolId}`,
    `success: ${Boolean(actionResult?.success)}`,
    `observation: ${actionResult?.observation ?? ""}`,
    actionResult?.metadata
      ? `metadata: ${JSON.stringify(actionResult.metadata, null, 2)}`
      : ""
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Create a registered MCP server backed by the given runtime. Callers are
 * responsible for connecting a transport (usually StdioServerTransport).
 *
 * @param {object} params
 * @param {object} params.runtime  runtime from createServiceBootstrap
 * @param {string[]} [params.providers]  optional filter limiting which
 *   providers are exposed (e.g. ["google"]). Empty means all.
 */
export async function createConnectorMcpServer({ runtime, providers = [] } = {}) {
  if (!runtime?.connectorCatalog) {
    throw new Error("runtime.connectorCatalog is required");
  }

  const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
  const {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    ListResourcesRequestSchema,
    ReadResourceRequestSchema
  } = await import("@modelcontextprotocol/sdk/types.js");

  const server = new Server(
    { name: "lingxy-connectors", version: "0.1.0" },
    { capabilities: { tools: {}, resources: {} } }
  );

  const providerFilter = new Set((providers ?? []).map((p) => String(p).toLowerCase()));
  const matchesProvider = (providerName) => {
    if (providerFilter.size === 0) return true;
    return providerFilter.has(String(providerName ?? "").toLowerCase());
  };

  function currentTools() {
    const catalog = runtime.connectorCatalog;
    const summaries = catalog.listTools().filter((tool) => matchesProvider(tool.provider));
    const workflows = catalog.listWorkflows().filter((workflow) => matchesProvider(workflow.provider));
    const toolEntries = summaries.map((summary) => {
      const full = catalog.getTool(summary.id);
      return describeToolForMcp(full ?? summary);
    });
    const workflowEntries = workflows.map((summary) => {
      const full = catalog.getWorkflow(summary.id);
      return describeWorkflowForMcp(full ?? summary);
    });
    return [...workflowEntries, ...toolEntries];
  }

  function currentResources() {
    return runtime.connectorCatalog.toMcpResources()
      .filter((resource) => matchesProvider(resource.provider));
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: currentTools()
  }));

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: currentResources().map(({ provider: _provider, ...rest }) => rest)
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    const match = currentResources().find((resource) => resource.uri === uri);
    if (!match) {
      throw new Error(`resource_not_found: ${uri}`);
    }
    const catalog = runtime.connectorCatalog;
    const body = uri.includes("/workflows/")
      ? catalog.getWorkflow(uri.split("/workflows/")[1]) ?? {}
      : { provider: match.provider, description: match.description, tools: catalog.listTools({ provider: match.provider }) };
    return {
      contents: [{
        uri,
        mimeType: "application/json",
        text: JSON.stringify(body, null, 2)
      }]
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    const catalog = runtime.connectorCatalog;

    // Workflow call — prefix workflow_
    if (typeof name === "string" && name.startsWith("workflow_")) {
      const workflow = catalog.listWorkflows().map((w) => catalog.getWorkflow(w.id))
        .filter((w) => matchesProvider(w?.provider))
        .find((w) => mcpToolNameForWorkflow(w) === name);
      if (!workflow) {
        return { isError: true, content: asContentText(`Unknown workflow: ${name}`) };
      }
      const result = await runConnectorWorkflow({
        runtime,
        workflowId: workflow.id,
        input: args.input ?? args,
        state: args.state ?? {}
      });
      if (result.status === "waiting_external_decision") {
        return {
          isError: false,
          content: asContentText(formatWorkflowOutputAsText(result, workflow)),
          structuredContent: {
            status: "waiting_external_decision",
            approval_id: result.approval?.approval_id ?? null,
            outputs: result.outputs ?? {}
          }
        };
      }
      return {
        isError: result.status !== "success",
        content: asContentText(formatWorkflowOutputAsText(result, workflow)),
        structuredContent: {
          status: result.status,
          outputs: result.outputs ?? {}
        }
      };
    }

    // Otherwise: direct tool call routed through the action tool registry.
    const allTools = catalog.listTools().filter((tool) => matchesProvider(tool.provider));
    const summary = allTools.find((tool) => mcpToolNameForTool(tool) === name);
    if (!summary) {
      return { isError: true, content: asContentText(`Unknown tool: ${name}`) };
    }
    const full = catalog.getTool(summary.id);
    const actionToolId = full?.execution?.actionTool;
    if (!actionToolId) {
      return {
        isError: true,
        content: asContentText(`Tool ${summary.id} has no executable action mapping.`)
      };
    }
    const actionTool = runtime.actionToolRegistry?.get?.(actionToolId);
    if (!actionTool) {
      return {
        isError: true,
        content: asContentText(`Action tool not registered: ${actionToolId}`)
      };
    }
    const actionResult = await runtime.actionToolRegistry.call(actionToolId, {
      ...(args ?? {}),
      ...(full.execution?.provider ? { provider: full.execution.provider } : {})
    }, { runtime });
    return {
      isError: actionResult.success === false,
      content: asContentText(formatActionResultAsText(summary.id, actionResult)),
      structuredContent: actionResult.metadata ?? {}
    };
  });

  return { server, currentTools, currentResources };
}
