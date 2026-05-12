import { loadConnectorContractFiles } from "./contract-loader.mjs";
import { validateConnectorObject } from "./validators.mjs";

function asArray(value) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function summarizeTool(tool) {
  return {
    id: tool.id,
    name: tool.name,
    description: tool.description,
    provider: tool.provider,
    service: tool.service,
    capability: tool.capability,
    risk: tool.risk,
    requiresConfirmation: tool.requiresConfirmation === true,
    source: tool.source,
    mcpName: tool.mcpName ?? null
  };
}

function summarizeWorkflow(workflow) {
  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    provider: workflow.provider,
    service: workflow.service,
    intent: workflow.intent,
    risk: workflow.risk,
    triggerPatterns: workflow.triggerPatterns ?? [],
    stepCount: workflow.steps?.length ?? 0
  };
}

function normalizeProviderRecord(providerName, contracts, workflows) {
  const providerManifest = contracts.find((contract) => contract.kind === "connector");
  const tools = [];

  for (const contract of contracts) {
    for (const tool of asArray(contract.tools)) {
      tools.push({
        ...tool,
        provider: tool.provider ?? contract.provider ?? providerName,
        service: tool.service ?? contract.service ?? providerManifest?.service ?? providerName,
        source: tool.source ?? "internal_connector",
        sourcePath: contract.sourcePath
      });
    }
  }

  const normalizedWorkflows = [];
  for (const workflowFile of workflows) {
    for (const workflow of asArray(workflowFile.workflows ?? workflowFile.workflow ?? workflowFile)) {
      normalizedWorkflows.push({
        ...workflow,
        provider: workflow.provider ?? workflowFile.provider ?? providerName,
        service: workflow.service ?? workflowFile.service ?? providerManifest?.service ?? providerName,
        sourcePath: workflowFile.sourcePath
      });
    }
  }

  return {
    provider: providerName,
    displayName: providerManifest?.displayName ?? providerName,
    description: providerManifest?.description ?? "",
    accounts: providerManifest?.accounts ?? null,
    mcp: providerManifest?.mcp ?? null,
    services: providerManifest?.services ?? [],
    tools,
    workflows: normalizedWorkflows
  };
}

function matchesFilter(value, filter) {
  if (!filter) {
    return true;
  }
  return String(value ?? "").toLowerCase() === String(filter).toLowerCase();
}

function queryMatches(item, query = "") {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) {
    return true;
  }
  const haystack = [
    item.id,
    item.name,
    item.description,
    item.provider,
    item.service,
    item.capability,
    item.intent,
    ...(item.triggerPatterns ?? [])
  ].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(q);
}

export function createConnectorCatalog(options = {}) {
  let providerRecords = [];
  let toolsById = new Map();
  let workflowsById = new Map();
  const externalToolIds = new Set();

  function resolvePluginRoots() {
    if (typeof options.pluginRootsProvider === "function") {
      try {
        return options.pluginRootsProvider() ?? [];
      } catch {
        return [];
      }
    }
    return options.pluginRoots ?? [];
  }

  function reload() {
    const loaded = loadConnectorContractFiles({
      rootDir: options.rootDir,
      pluginRoots: resolvePluginRoots()
    });
    providerRecords = loaded.providers.map((provider) =>
      normalizeProviderRecord(provider.provider, provider.contracts, provider.workflows)
    );
    toolsById = new Map();
    workflowsById = new Map();
    externalToolIds.clear();

    for (const provider of providerRecords) {
      for (const tool of provider.tools) {
        if (tool.id) {
          toolsById.set(tool.id, tool);
        }
      }
      for (const workflow of provider.workflows) {
        if (workflow.id) {
          workflowsById.set(workflow.id, workflow);
        }
      }
    }

    return {
      providers: providerRecords.length,
      tools: toolsById.size,
      workflows: workflowsById.size
    };
  }

  reload();

  function registerExternalTool(entry) {
    if (!entry?.id) return null;
    const normalized = {
      ...entry,
      provider: entry.provider ?? "external",
      service: entry.service ?? entry.provider ?? "external",
      source: entry.source ?? "external_mcp"
    };
    toolsById.set(normalized.id, normalized);
    externalToolIds.add(normalized.id);
    return normalized;
  }

  return {
    reload,
    registerExternalTools(entries = []) {
      for (const entry of entries) {
        registerExternalTool(entry);
      }
      return externalToolIds.size;
    },
    clearExternalTools() {
      for (const id of externalToolIds) {
        toolsById.delete(id);
      }
      externalToolIds.clear();
    },
    listProviders() {
      return providerRecords.map((provider) => ({
        provider: provider.provider,
        displayName: provider.displayName,
        description: provider.description,
        services: provider.services,
        accounts: provider.accounts,
        mcp: provider.mcp,
        toolCount: provider.tools.length,
        workflowCount: provider.workflows.length
      }));
    },
    listTools(filter = {}) {
      return [...toolsById.values()]
        .filter((tool) => matchesFilter(tool.provider, filter.provider))
        .filter((tool) => matchesFilter(tool.service, filter.service))
        .filter((tool) => matchesFilter(tool.capability, filter.capability))
        .filter((tool) => matchesFilter(tool.risk, filter.risk))
        .filter((tool) => queryMatches(tool, filter.query))
        .map(summarizeTool);
    },
    getTool(toolId) {
      return toolsById.get(toolId) ?? null;
    },
    listWorkflows(filter = {}) {
      return [...workflowsById.values()]
        .filter((workflow) => matchesFilter(workflow.provider, filter.provider))
        .filter((workflow) => matchesFilter(workflow.service, filter.service))
        .filter((workflow) => matchesFilter(workflow.intent, filter.intent))
        .filter((workflow) => queryMatches(workflow, filter.query))
        .map(summarizeWorkflow);
    },
    getWorkflow(workflowId) {
      return workflowsById.get(workflowId) ?? null;
    },
    search(query = "", filter = {}) {
      return {
        providers: this.listProviders().filter((provider) => queryMatches(provider, query)),
        tools: this.listTools({ ...filter, query }),
        workflows: this.listWorkflows({ ...filter, query })
      };
    },
    validateOutput(toolId, output = {}) {
      const tool = toolsById.get(toolId);
      if (!tool) {
        return {
          ok: false,
          failures: [{ path: "toolId", kind: "known_tool", message: `Unknown connector tool: ${toolId}` }]
        };
      }
      return validateConnectorObject(output, tool.outputValidators ?? []);
    },
    toMcpResources() {
      return providerRecords.flatMap((provider) => [
        {
          uri: `connector://${provider.provider}/capabilities`,
          name: `${provider.displayName} capabilities`,
          mimeType: "application/json",
          provider: provider.provider,
          description: provider.description
        },
        ...provider.workflows.map((workflow) => ({
          uri: `connector://${provider.provider}/workflows/${workflow.id}`,
          name: workflow.name ?? workflow.id,
          mimeType: "application/json",
          provider: provider.provider,
          description: workflow.description ?? ""
        }))
      ]);
    },
    toMcpToolSummaries() {
      return [...toolsById.values()].map((tool) => ({
        name: tool.mcpName ?? tool.id.replace(/[.]/g, "_"),
        title: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema ?? { type: "object", properties: {}, required: [] },
        outputSchema: tool.outputSchema,
        annotations: {
          provider: tool.provider,
          service: tool.service,
          risk: tool.risk,
          requiresConfirmation: tool.requiresConfirmation === true
        }
      }));
    }
  };
}
