import { detectProviderFamily } from "../../../shared/provider-catalog.mjs";

export const PROVIDER_ONBOARDING_VERSION = 1;

const SAFE_LOCAL_MCP_IDS = Object.freeze(["mcp-filesystem", "mcp-memory"]);
const SUGGESTION_STATUSES = new Set(["pending", "dismissed", "completed"]);

function normalizeId(value) {
  return `${value ?? ""}`.trim();
}

function hasProviderCredential(provider = {}) {
  if (provider.kind === "code_cli") return Boolean(normalizeId(provider.command));
  if (provider.kind === "ollama") return Boolean(normalizeId(provider.baseUrl));
  return Boolean(normalizeId(provider.apiKey) || normalizeId(provider.apiKeyRef));
}

function builtinToggleEnabled(config = {}, serverId) {
  const entry = config.ai?.mcp?.builtinToggles?.[serverId];
  return entry?.enabled !== false;
}

function hasSkillRegistry(config = {}) {
  return Array.isArray(config.ai?.skills?.registries)
    && config.ai.skills.registries.length > 0;
}

function mcpEnvConfigured(config = {}, serverId, envName, env = process.env) {
  const override = config.ai?.mcp?.envOverrides?.[serverId]?.[envName];
  return Boolean(normalizeId(override) || normalizeId(env?.[envName]));
}

function suggestionId(providerId, kind, key) {
  return `provider:${providerId}:${kind}:${key}`;
}

function baseSuggestion(provider, kind, key, fields) {
  const providerId = normalizeId(provider.id);
  const providerFamily = detectProviderFamily(provider);
  return {
    id: suggestionId(providerId, kind, key),
    schemaVersion: PROVIDER_ONBOARDING_VERSION,
    scope: "provider",
    providerId,
    providerKind: provider.kind ?? "unknown",
    providerFamily,
    kind,
    status: "pending",
    ...fields
  };
}

export function providerLooksConfigured(provider = {}) {
  return Boolean(normalizeId(provider.id) && normalizeId(provider.kind) && hasProviderCredential(provider));
}

export function buildProviderOnboardingSuggestions(provider = {}, { config = {}, env = process.env } = {}) {
  if (!providerLooksConfigured(provider)) return [];

  const suggestions = [];
  const providerKind = provider.kind ?? "";

  for (const serverId of SAFE_LOCAL_MCP_IDS) {
    if (!builtinToggleEnabled(config, serverId)) {
      suggestions.push(baseSuggestion(provider, "mcp", `enable-${serverId}`, {
        priority: "recommended",
        title: serverId === "mcp-filesystem" ? "Enable local file tools" : "Enable memory tools",
        reason: serverId === "mcp-filesystem"
          ? "A configured AI provider can use the built-in filesystem MCP to inspect local project files through the existing approval and policy layers."
          : "A configured AI provider can use the built-in memory MCP for reusable workspace notes without adding another external service.",
        action: {
          type: "enable_builtin_mcp",
          serverId,
          method: "PATCH",
          path: `/ai/mcp/${encodeURIComponent(serverId)}/toggle`,
          body: { enabled: true }
        }
      }));
    }
  }

  suggestions.push(baseSuggestion(provider, "skills", "review-skill-library", {
    priority: hasSkillRegistry(config) ? "optional" : "recommended",
    title: hasSkillRegistry(config) ? "Review editable skills" : "Create or connect editable skills",
    reason: hasSkillRegistry(config)
      ? "Skills are loaded from disk on each registry read, so edits can immediately improve recurring workflows."
      : "Skills give the assistant durable, editable instructions for repeatable work without adding more prompt text to every task.",
    action: {
      type: "open_skills_library",
      path: "/ai/skills"
    }
  }));

  suggestions.push(baseSuggestion(provider, "mcp", "web-research", {
    priority: mcpEnvConfigured(config, "mcp-brave-search", "BRAVE_API_KEY", env) ? "recommended" : "optional",
    title: "Add a web research MCP",
    reason: mcpEnvConfigured(config, "mcp-brave-search", "BRAVE_API_KEY", env)
      ? "A Brave Search key is already available; enabling the MCP gives tool-using providers a structured search surface."
      : "For live research, connect a search MCP or keep using the built-in web search tools depending on your privacy and reliability needs.",
    action: {
      type: "configure_builtin_mcp",
      serverId: "mcp-brave-search",
      path: "/ai/mcp/mcp-brave-search/config",
      requiredEnv: ["BRAVE_API_KEY"]
    }
  }));

  suggestions.push(baseSuggestion(provider, "mcp", "browser-automation", {
    priority: "optional",
    title: "Enable browser automation when needed",
    reason: "Browser automation should stay explicit: it is useful for login-bound or interactive sites, but it has more side effects than plain search.",
    action: {
      type: "enable_builtin_mcp",
      serverId: "mcp-puppeteer",
      method: "PATCH",
      path: "/ai/mcp/mcp-puppeteer/toggle",
      body: { enabled: true }
    }
  }));

  if (providerKind === "code_cli") {
    suggestions.push(baseSuggestion(provider, "mcp", "code-cli-mcp-config", {
      priority: Array.isArray(provider.mcpConfigFiles) && provider.mcpConfigFiles.length > 0 ? "optional" : "recommended",
      title: "Link MCP config files for this CLI",
      reason: "Code CLI providers often need their own MCP config file list; linking it lets the same workspace tools work in CLI-backed conversations.",
      action: {
        type: "configure_provider_mcp_files",
        providerId: normalizeId(provider.id)
      }
    }));
  }

  return suggestions;
}

export function mergeProviderOnboardingSuggestions(onboarding = {}, suggestions = [], { now = new Date().toISOString() } = {}) {
  const existing = Array.isArray(onboarding.pendingSuggestions) ? onboarding.pendingSuggestions : [];
  const archived = Array.isArray(onboarding.archivedSuggestions) ? onboarding.archivedSuggestions : [];
  const byId = new Map([...existing, ...archived].map((suggestion) => [suggestion.id, suggestion]));

  for (const suggestion of suggestions) {
    if (!suggestion?.id) continue;
    const previous = byId.get(suggestion.id);
    if (previous?.status && previous.status !== "pending") {
      byId.set(suggestion.id, {
        ...previous,
        lastSuggestedAt: now
      });
      continue;
    }
    byId.set(suggestion.id, {
      ...previous,
      ...suggestion,
      status: "pending",
      createdAt: previous?.createdAt ?? now,
      updatedAt: now
    });
  }

  return {
    ...onboarding,
    schemaVersion: PROVIDER_ONBOARDING_VERSION,
    pendingSuggestions: [...byId.values()]
      .filter((suggestion) => suggestion?.status === "pending")
      .sort((a, b) => `${a.id}`.localeCompare(`${b.id}`)),
    archivedSuggestions: [...byId.values()]
      .filter((suggestion) => suggestion?.status && suggestion.status !== "pending")
      .sort((a, b) => `${a.id}`.localeCompare(`${b.id}`))
  };
}

export function removeProviderOnboardingSuggestions(onboarding = {}, providerId = "") {
  const normalizedProviderId = normalizeId(providerId);
  return {
    ...onboarding,
    schemaVersion: PROVIDER_ONBOARDING_VERSION,
    pendingSuggestions: (onboarding.pendingSuggestions ?? [])
      .filter((suggestion) => suggestion?.providerId !== normalizedProviderId),
    archivedSuggestions: (onboarding.archivedSuggestions ?? [])
      .filter((suggestion) => suggestion?.providerId !== normalizedProviderId)
  };
}

export function updateProviderOnboardingSuggestionStatus(
  onboarding = {},
  suggestionId = "",
  status = "dismissed",
  { now = new Date().toISOString() } = {}
) {
  const id = normalizeId(suggestionId);
  const nextStatus = SUGGESTION_STATUSES.has(status) ? status : "";
  if (!id || !nextStatus) {
    return {
      ok: false,
      error: !id ? "suggestion_id_required" : "suggestion_status_invalid",
      onboarding: {
        ...onboarding,
        pendingSuggestions: onboarding.pendingSuggestions ?? [],
        archivedSuggestions: onboarding.archivedSuggestions ?? []
      },
      suggestion: null
    };
  }

  const pending = Array.isArray(onboarding.pendingSuggestions) ? onboarding.pendingSuggestions : [];
  const archived = Array.isArray(onboarding.archivedSuggestions) ? onboarding.archivedSuggestions : [];
  const existing = [...pending, ...archived].find((suggestion) => suggestion?.id === id) ?? null;
  if (!existing) {
    return {
      ok: false,
      error: "suggestion_not_found",
      onboarding: {
        ...onboarding,
        pendingSuggestions: pending,
        archivedSuggestions: archived
      },
      suggestion: null
    };
  }

  const suggestion = {
    ...existing,
    status: nextStatus,
    updatedAt: now,
    ...(nextStatus === "dismissed" ? { dismissedAt: now } : {}),
    ...(nextStatus === "completed" ? { completedAt: now } : {})
  };

  const otherPending = pending.filter((entry) => entry?.id !== id);
  const otherArchived = archived.filter((entry) => entry?.id !== id);
  const nextOnboarding = {
    ...onboarding,
    schemaVersion: PROVIDER_ONBOARDING_VERSION,
    pendingSuggestions: nextStatus === "pending"
      ? [...otherPending, suggestion].sort((a, b) => `${a.id}`.localeCompare(`${b.id}`))
      : otherPending.sort((a, b) => `${a.id}`.localeCompare(`${b.id}`)),
    archivedSuggestions: nextStatus === "pending"
      ? otherArchived.sort((a, b) => `${a.id}`.localeCompare(`${b.id}`))
      : [...otherArchived, suggestion].sort((a, b) => `${a.id}`.localeCompare(`${b.id}`))
  };

  return {
    ok: true,
    onboarding: nextOnboarding,
    suggestion
  };
}
