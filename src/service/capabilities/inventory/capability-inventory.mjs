import { buildModelRoleRoutingSummary } from "../../ai/model-role-routing.mjs";
import { listMcpDrafts } from "../mcp/drafts.mjs";
import { buildMarketplaceTrustPreview } from "../marketplace/trust-model.mjs";

export const CAPABILITY_INVENTORY_SCHEMA_VERSION = "capability-inventory.v1";

export const CAPABILITY_INVENTORY_GROUPS = Object.freeze([
  {
    id: "built_in_tools",
    title: "Built-in tools",
    owner: "src/service/action_tools/tools/index.mjs",
    targetLayer: "service/capabilities/tools"
  },
  {
    id: "skills",
    title: "Skills",
    owner: "src/service/capabilities/skills",
    targetLayer: "service/capabilities/skills"
  },
  {
    id: "mcp_servers",
    title: "MCP servers",
    owner: "src/service/capabilities/mcp",
    targetLayer: "service/capabilities/mcp"
  },
  {
    id: "connector_plugins",
    title: "Connector plugins",
    owner: "src/service/capabilities/connectors",
    targetLayer: "service/capabilities/connectors"
  },
  {
    id: "connector_tools",
    title: "Connector tools",
    owner: "src/service/capabilities/connectors/tools",
    targetLayer: "service/capabilities/connectors/tools"
  },
  {
    id: "providers_model_roles",
    title: "Providers and model roles",
    owner: "src/service/capabilities/providers",
    targetLayer: "service/capabilities/providers"
  },
  {
    id: "user_created_drafts",
    title: "User-created drafts",
    owner: "src/service/capabilities/tools/capability-creator-tools.mjs",
    targetLayer: "service/capabilities"
  }
]);

const GROUP_BY_ID = new Map(CAPABILITY_INVENTORY_GROUPS.map((group) => [group.id, group]));

function asString(value, fallback = "") {
  const text = `${value ?? ""}`.trim();
  return text || fallback;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function enabledState(entry = {}) {
  if (entry.enabled === false || entry.active === false || entry.status === "disabled") return "disabled";
  if (entry.status === "archived" || entry.archived === true) return "disabled";
  if (entry.status === "broken" || entry.status === "error") return "error";
  return "enabled";
}

function archiveState(entry = {}) {
  if (entry.archived === true || entry.status === "archived") return "archived";
  if (entry.status === "deleted" || entry.deleted === true) return "deleted";
  if (entry.status === "draft" || entry.kind === "draft") return "recoverable";
  return "active";
}

function policyState(entry = {}, fallback = "allowed") {
  if (entry.governance?.allowed === false) return "blocked";
  if (entry.requires_confirmation === true || entry.requiresConfirmation === true) return "approval_required";
  if (entry.risk_level === "high" || entry.risk === "high") return "guarded";
  if (entry.validation?.ok === false || entry.status === "broken") return "needs_review";
  return fallback;
}

function trustState(entry = {}, kind = "capability") {
  const preview = entry.trustPreview ?? buildMarketplaceTrustPreview(entry, { kind });
  return {
    preview,
    trust: preview.trust ?? null,
    state: preview.trust?.trustState ?? "unknown",
    requiredReview: preview.requiredUserReview === true || preview.trust?.userActionRequired === true,
    warnings: array(preview.warnings)
  };
}

function makeEntry(groupId, entry = {}, options = {}) {
  const group = GROUP_BY_ID.get(groupId);
  if (!group) throw new Error(`unknown_capability_inventory_group:${groupId}`);
  const kind = options.kind ?? entry.kind ?? groupId;
  const trust = options.trust ?? trustState(entry, kind);
  const id = asString(options.id ?? entry.id ?? entry.role ?? entry.name ?? entry.displayName);
  return {
    schemaVersion: CAPABILITY_INVENTORY_SCHEMA_VERSION,
    id,
    group: groupId,
    kind,
    title: asString(options.title ?? entry.displayName ?? entry.title ?? entry.name ?? entry.role ?? id, id),
    description: asString(options.description ?? entry.description ?? entry.purpose),
    owner: options.owner ?? group.owner,
    targetLayer: options.targetLayer ?? group.targetLayer,
    source: asString(options.source ?? entry.source ?? entry.provider ?? entry.registrySource ?? "runtime_config"),
    enabledState: options.enabledState ?? enabledState(entry),
    trustState: options.trustState ?? trust.state,
    policyState: options.policyState ?? policyState(entry),
    archiveState: options.archiveState ?? archiveState(entry),
    requiredReview: options.requiredReview ?? trust.requiredReview,
    warnings: array(options.warnings ?? trust.warnings),
    metadata: options.metadata ?? {},
    management: options.management ?? {},
    trustPreview: trust.preview ?? null
  };
}

function summarizeTool(tool = {}) {
  return makeEntry("built_in_tools", tool, {
    kind: "built_in_tool",
    source: "builtin",
    owner: "src/service/action_tools/tools/index.mjs",
    targetLayer: "service/capabilities/tools",
    policyState: policyState(tool),
    metadata: {
      risk_level: tool.risk_level ?? null,
      required_capabilities: array(tool.required_capabilities),
      policy_group: tool.policy_group ?? null,
      requires_confirmation: tool.requires_confirmation === true
    }
  });
}

function summarizeSkill(skill = {}) {
  return makeEntry("skills", skill, {
    kind: "skill",
    owner: "src/service/capabilities/skills",
    enabledState: skill.active === false || skill.enabled === false ? "disabled" : "enabled",
    policyState: skill.validation?.ok === false ? "needs_review" : "allowed",
    metadata: {
      registryId: skill.registryId ?? skill.registry_id ?? null,
      path: skill.path ?? skill.entryPath ?? null,
      localOnly: skill.localOnly === true
    }
  });
}

function summarizeMcpServer(server = {}) {
  return makeEntry("mcp_servers", server, {
    kind: "mcp_server",
    owner: "src/service/capabilities/mcp",
    enabledState: server.enabled === false ? "disabled" : enabledState(server),
    policyState: server.missingConfig || server.validation?.ok === false ? "needs_review" : "allowed",
    metadata: {
      transport: server.transport ?? null,
      command: server.command ?? null,
      url: server.url ?? null,
      missingConfig: server.missingConfig ?? null
    },
    management: {
      toggleRoute: server.id ? `/ai/mcp/${encodeURIComponent(server.id)}/toggle` : null,
      configRoute: server.id ? `/ai/mcp/${encodeURIComponent(server.id)}/config` : null
    }
  });
}

function summarizePlugin(plugin = {}) {
  return makeEntry("connector_plugins", plugin, {
    kind: "connector_plugin",
    owner: "src/service/capabilities/connectors/core/plugin-registry.mjs",
    metadata: {
      provider: plugin.provider ?? null,
      version: plugin.version ?? null,
      directory: plugin.directory ?? null,
      mcpServers: array(plugin.mcpServers).map((server) => server.id ?? server)
    },
    management: {
      pluginId: plugin.id ?? null,
      toggleRoute: plugin.id ? `/plugins/${encodeURIComponent(plugin.id)}/enabled` : null,
      archiveRoute: plugin.id && plugin.source !== "builtin" ? `/plugins/${encodeURIComponent(plugin.id)}` : null
    }
  });
}

function summarizeConnectorTool(tool = {}) {
  return makeEntry("connector_tools", tool, {
    kind: "connector_tool",
    owner: "src/service/capabilities/connectors/tools",
    source: tool.source ?? tool.provider ?? "connector_catalog",
    policyState: policyState({
      risk: tool.risk,
      requiresConfirmation: tool.requiresConfirmation
    }),
    metadata: {
      provider: tool.provider ?? null,
      service: tool.service ?? null,
      capability: tool.capability ?? null,
      risk: tool.risk ?? null,
      requiresConfirmation: tool.requiresConfirmation === true
    }
  });
}

function summarizeProvider(provider = {}) {
  return makeEntry("providers_model_roles", provider, {
    kind: "provider",
    owner: "src/service/capabilities/providers",
    enabledState: provider.available === false || provider.configured === false ? "disabled" : "enabled",
    policyState: provider.configured === false ? "needs_setup" : "allowed",
    metadata: {
      kind: provider.kind ?? null,
      configured: provider.configured ?? null,
      available: provider.available ?? null,
      defaultModel: provider.defaultModel ?? provider.model ?? null,
      reason: provider.reason ?? null
    }
  });
}

function summarizeCodeCliAdapter(adapter = {}) {
  return makeEntry("providers_model_roles", adapter, {
    kind: "code_cli_adapter",
    owner: "src/service/capabilities/code_cli",
    enabledState: adapter.available === false || adapter.enabled === false ? "disabled" : "enabled",
    policyState: adapter.available === false ? "needs_setup" : "allowed",
    metadata: {
      command: adapter.command ?? null,
      configured: adapter.configured ?? null,
      available: adapter.available ?? null,
      version: adapter.version ?? null
    }
  });
}

function summarizeModelRole(role = {}) {
  return makeEntry("providers_model_roles", role, {
    id: `model_role:${role.role}`,
    title: `Model role: ${role.role}`,
    kind: "model_role",
    owner: "src/service/ai/model-role-routing.mjs",
    enabledState: role.enabled === false ? "disabled" : "enabled",
    policyState: role.status === "ready" ? "allowed" : role.status === "disabled" ? "disabled" : "needs_setup",
    archiveState: "active",
    source: role.source ?? "model_roles",
    metadata: {
      role: role.role,
      status: role.status ?? null,
      providerId: role.providerId ?? null,
      model: role.model ?? null,
      taskType: role.taskType ?? null,
      fallbackTaskTypes: array(role.fallbackTaskTypes)
    }
  });
}

function summarizeDraft(draft = {}) {
  return makeEntry("user_created_drafts", draft, {
    kind: "capability_draft",
    source: "local_draft",
    enabledState: "disabled",
    policyState: draft.validation?.ok === true ? "awaiting_activation" : "needs_review",
    archiveState: "recoverable",
    metadata: {
      file: draft.file ?? null,
      kind: draft.kind ?? "mcp",
      saved_at: draft.saved_at ?? null,
      validation: draft.validation ?? null,
      descriptor: draft.descriptor ?? null
    },
    management: {
      importRoute: "/config/mcp/drafts/import"
    }
  });
}

export function buildCapabilityInventory(input = {}) {
  const entries = [
    ...array(input.actionTools).map(summarizeTool),
    ...array(input.skills).map(summarizeSkill),
    ...array(input.mcpServers).map(summarizeMcpServer),
    ...array(input.plugins).map(summarizePlugin),
    ...array(input.connectorTools).map(summarizeConnectorTool),
    ...array(input.providers).map(summarizeProvider),
    ...array(input.codeCliAdapters).map(summarizeCodeCliAdapter),
    ...array(input.modelRoles).map(summarizeModelRole),
    ...array(input.drafts).map(summarizeDraft)
  ].filter((entry) => entry.id);

  const groups = CAPABILITY_INVENTORY_GROUPS.map((group) => {
    const groupEntries = entries.filter((entry) => entry.group === group.id);
    return {
      ...group,
      count: groupEntries.length,
      enabled: groupEntries.filter((entry) => entry.enabledState === "enabled").length,
      needsReview: groupEntries.filter((entry) => entry.requiredReview || entry.policyState === "needs_review" || entry.policyState === "needs_setup").length,
      archived: groupEntries.filter((entry) => entry.archiveState !== "active").length
    };
  });

  return {
    schemaVersion: CAPABILITY_INVENTORY_SCHEMA_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    groups,
    entries,
    summary: {
      groups: groups.length,
      entries: entries.length,
      enabled: entries.filter((entry) => entry.enabledState === "enabled").length,
      needsReview: entries.filter((entry) => entry.requiredReview || entry.policyState === "needs_review" || entry.policyState === "needs_setup").length,
      archived: entries.filter((entry) => entry.archiveState !== "active").length
    }
  };
}

export async function buildRuntimeCapabilityInventory(runtime = {}) {
  const config = runtime.configStore?.load?.() ?? {};
  const providers = await runtime.platform?.aiProviders?.listStatus?.({ runtime, config }) ?? [];
  const codeCliAdapters = await runtime.platform?.codeCliAdapters?.listStatus?.({ runtime, config }) ?? [];
  const mcpServers = await runtime.platform?.mcpServers?.listStatus?.({
    runtime,
    config,
    secretStore: runtime.secretStore ?? null,
    processEnv: process.env
  }) ?? [];
  const skills = await runtime.platform?.skillRegistries?.listSkills?.({
    runtime,
    config,
    includeInactive: true
  }) ?? [];
  const plugins = runtime.pluginRegistry?.list?.() ?? [];
  const connectorTools = runtime.connectorCatalog?.listTools?.() ?? [];
  const drafts = await listMcpDrafts(runtime);
  const modelRoleSummary = buildModelRoleRoutingSummary({ config, providers });

  return buildCapabilityInventory({
    actionTools: runtime.actionToolRegistry?.list?.() ?? [],
    skills,
    mcpServers,
    plugins,
    connectorTools,
    providers,
    codeCliAdapters,
    modelRoles: modelRoleSummary.roles ?? [],
    drafts
  });
}
