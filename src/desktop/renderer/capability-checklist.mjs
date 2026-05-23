import {
  describeMcpMissingConfig,
  isMcpMissingConfig
} from "./mcp-missing-config.mjs";

const BUILTIN_MCP_LABELS = Object.freeze({
  "mcp-filesystem": "Local file tools",
  "mcp-memory": "Memory tools",
  "mcp-brave-search": "Web research MCP",
  "mcp-puppeteer": "Browser automation"
});

function normalizeId(value) {
  return `${value ?? ""}`.trim();
}

function pendingSuggestions(workspace = {}) {
  return Array.isArray(workspace.onboarding?.pendingSuggestions)
    ? workspace.onboarding.pendingSuggestions.filter((suggestion) => suggestion?.status === "pending")
    : [];
}

function isProviderReady(provider = {}) {
  return provider.available === true && provider.configured === true;
}

function isProviderConfigured(provider = {}) {
  return provider.configured === true || Boolean(provider.apiKeyConfigured || provider.apiKeyRef || provider.command);
}

function isMcpReady(server = {}) {
  if (!server) return false;
  if (server.enabled === false) return false;
  if (server.available === false) return false;
  const status = normalizeId(server.status ?? server.health ?? "").toLowerCase();
  return !["disabled", "missing", "error", "unavailable"].includes(status);
}

function mcpById(workspace = {}, serverId = "") {
  return (workspace.mcpServers ?? []).find((server) => normalizeId(server.id) === serverId) ?? null;
}

function missingConfigDetail(server) {
  const { summary } = describeMcpMissingConfig(server);
  return summary
    ? `Configuration missing: ${summary}.`
    : "Configuration missing — open Configure to provide the required value.";
}

function evaluateMcpItem({ server, suggestion, fallback, readyDetail, pendingDetail }) {
  if (isMcpReady(server)) {
    return { status: "ready", detail: readyDetail };
  }
  if (server && isMcpMissingConfig(server)) {
    return { status: "action_needed", detail: missingConfigDetail(server) };
  }
  return {
    status: statusFromSuggestion(suggestion, fallback),
    detail: pendingDetail
  };
}

function findSuggestion(workspace = {}, predicate) {
  return pendingSuggestions(workspace).find(predicate) ?? null;
}

function suggestionForAction(workspace = {}, actionType, key = "") {
  return findSuggestion(workspace, (suggestion) => {
    const action = suggestion.action ?? {};
    if (action.type !== actionType) return false;
    if (!key) return true;
    return normalizeId(action.serverId) === key
      || normalizeId(suggestion.id).includes(key)
      || normalizeId(suggestion.kind) === key;
  });
}

function statusFromSuggestion(suggestion = null, fallback = "optional") {
  if (!suggestion) return fallback;
  return suggestion.priority === "recommended" ? "recommended" : "optional";
}

function actionFromSuggestion(suggestion = null) {
  return suggestion?.id ? { type: "suggestion", suggestionId: suggestion.id } : null;
}

function settingsAction(panelId) {
  return { type: "settings_panel", panelId };
}

function connectorAction(serverId) {
  return { type: "connector_mcp", serverId };
}

function item(fields) {
  return {
    status: "optional",
    priority: 50,
    action: null,
    ...fields
  };
}

export function buildCapabilityChecklist({ workspace = {}, serviceBaseUrl = "" } = {}) {
  const providers = Array.isArray(workspace.providers) ? workspace.providers : [];
  const cliAdapters = Array.isArray(workspace.codeCliAdapters) ? workspace.codeCliAdapters : [];
  const providerSetup = workspace.providerSetup ?? null;
  const readyProviders = providers.filter(isProviderReady);
  const configuredProviders = providers.filter(isProviderConfigured);
  const readyCliAdapters = cliAdapters.filter((adapter) => adapter.available === true);
  const hasReadyModelRuntime = readyProviders.length > 0 || readyCliAdapters.length > 0;
  const providerSetupStatus = providerSetup?.status ?? null;
  const providerSetupIssue = providerSetup?.primaryIssue ?? null;
  const skillCount = (workspace.skills ?? []).length;
  const registryCount = (workspace.skillRegistries ?? []).length;

  const filesystemSuggestion = suggestionForAction(workspace, "enable_builtin_mcp", "mcp-filesystem");
  const memorySuggestion = suggestionForAction(workspace, "enable_builtin_mcp", "mcp-memory");
  const webSuggestion = findSuggestion(workspace, (suggestion) =>
    normalizeId(suggestion.id).includes("web-research")
      || normalizeId(suggestion.action?.serverId) === "mcp-brave-search"
  );
  const browserSuggestion = suggestionForAction(workspace, "enable_builtin_mcp", "mcp-puppeteer");
  const skillsSuggestion = suggestionForAction(workspace, "open_skills_library");
  const cliMcpSuggestion = suggestionForAction(workspace, "configure_provider_mcp_files");

  const filesystemServer = mcpById(workspace, "mcp-filesystem");
  const memoryServer = mcpById(workspace, "mcp-memory");
  const webServer = mcpById(workspace, "mcp-brave-search");
  const browserServer = mcpById(workspace, "mcp-puppeteer");

  const filesystemState = evaluateMcpItem({
    server: filesystemServer,
    suggestion: filesystemSuggestion,
    fallback: hasReadyModelRuntime ? "recommended" : "optional",
    readyDetail: "Local file access is available through the policy and approval layer.",
    pendingDetail: "Enable when the assistant should inspect local project files through managed tools."
  });
  const memoryState = evaluateMcpItem({
    server: memoryServer,
    suggestion: memorySuggestion,
    fallback: "optional",
    readyDetail: "Reusable workspace memory is available.",
    pendingDetail: "Optional durable memory can be enabled when a workflow needs it."
  });
  const webState = evaluateMcpItem({
    server: webServer,
    suggestion: webSuggestion,
    fallback: "optional",
    readyDetail: "Structured web research MCP is configured.",
    pendingDetail: "Built-in search can still work; add a search MCP for provider-managed research."
  });
  const browserState = evaluateMcpItem({
    server: browserServer,
    suggestion: browserSuggestion,
    fallback: "optional",
    readyDetail: "Browser automation is available for interactive web tasks.",
    pendingDetail: "Keep explicit; enable only when login-bound or interactive sites require it."
  });

  const checklist = [
    item({
      id: "ai-provider",
      title: "AI provider",
      status: hasReadyModelRuntime
        ? "ready"
        : providerSetupStatus === "recoverable" || configuredProviders.length > 0
          ? "recommended"
          : "action_needed",
      priority: hasReadyModelRuntime ? 10 : 1,
      detail: hasReadyModelRuntime
        ? `${readyProviders.length + readyCliAdapters.length} ready model runtime${readyProviders.length + readyCliAdapters.length === 1 ? "" : "s"}`
        : providerSetupIssue?.detail
          ? providerSetupIssue.detail
          : providerSetupStatus === "recoverable" || configuredProviders.length > 0
            ? "Provider saved, but runtime availability still needs checking."
          : "Add an API provider or Code CLI before expecting model-backed work.",
      action: settingsAction("providerSettingsPanel")
    }),
    item({
      id: "model-routing",
      title: "Model selection",
      status: hasReadyModelRuntime ? "ready" : "action_needed",
      priority: hasReadyModelRuntime ? 20 : 2,
      detail: hasReadyModelRuntime
        ? "Conversation model picker and task routing can use configured providers."
        : "Model switching opens provider setup until at least one model runtime is configured.",
      action: settingsAction("routingSettingsPanel")
    }),
    item({
      id: "local-files",
      title: BUILTIN_MCP_LABELS["mcp-filesystem"],
      status: filesystemState.status,
      priority: 30,
      detail: filesystemState.detail,
      action: actionFromSuggestion(filesystemSuggestion) ?? connectorAction("mcp-filesystem")
    }),
    item({
      id: "skills",
      title: "Editable skills",
      status: skillCount > 0 || registryCount > 0 ? "ready" : statusFromSuggestion(skillsSuggestion, "recommended"),
      priority: 35,
      detail: skillCount > 0
        ? `${skillCount} discovered skill${skillCount === 1 ? "" : "s"}`
        : registryCount > 0
          ? `${registryCount} skill registr${registryCount === 1 ? "y" : "ies"} configured`
          : "Create or connect durable instructions for repeatable workflows.",
      action: actionFromSuggestion(skillsSuggestion) ?? settingsAction("skillsSettingsPanel")
    }),
    item({
      id: "memory",
      title: BUILTIN_MCP_LABELS["mcp-memory"],
      status: memoryState.status,
      priority: 45,
      detail: memoryState.detail,
      action: actionFromSuggestion(memorySuggestion) ?? connectorAction("mcp-memory")
    }),
    item({
      id: "web-research",
      title: BUILTIN_MCP_LABELS["mcp-brave-search"],
      status: webState.status,
      priority: 50,
      detail: webState.detail,
      action: actionFromSuggestion(webSuggestion) ?? connectorAction("mcp-brave-search")
    }),
    item({
      id: "browser-automation",
      title: BUILTIN_MCP_LABELS["mcp-puppeteer"],
      status: browserState.status,
      priority: 60,
      detail: browserState.detail,
      action: actionFromSuggestion(browserSuggestion) ?? connectorAction("mcp-puppeteer")
    }),
    item({
      id: "cli-mcp-files",
      title: "CLI MCP config",
      status: cliMcpSuggestion ? statusFromSuggestion(cliMcpSuggestion, "recommended") : readyCliAdapters.length > 0 ? "optional" : "disabled",
      priority: 70,
      detail: cliMcpSuggestion
        ? "A Code CLI provider can link its own MCP config files."
        : readyCliAdapters.length > 0
          ? "Optional for CLI-backed conversations that should share workspace tools."
          : "Available after adding a Code CLI provider.",
      action: actionFromSuggestion(cliMcpSuggestion) ?? settingsAction("codeCliSettingsPanel")
    }),
    item({
      id: "approval-policy",
      title: "Side-effect approvals",
      status: workspace.security ? "ready" : "recommended",
      priority: 80,
      detail: workspace.security
        ? "Approval and audit state is loaded for local actions."
        : "Review before enabling more auto-execution.",
      action: settingsAction("privacySettingsPanel")
    })
  ];

  return checklist
    .map((entry) => ({
      ...entry,
      serviceBaseUrl
    }))
    .sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title));
}

export function capabilityChecklistSummary(items = []) {
  const counts = { action_needed: 0, recommended: 0, optional: 0, ready: 0, disabled: 0 };
  for (const entry of items) {
    if (Object.prototype.hasOwnProperty.call(counts, entry.status)) counts[entry.status] += 1;
  }
  return counts;
}
