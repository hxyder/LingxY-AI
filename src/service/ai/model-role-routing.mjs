import { detectProviderFamily, sanitizeProviderConfig } from "../../shared/provider-catalog.mjs";
import {
  isProviderConfiguredForUse,
  providerConfigurationReason
} from "../../shared/provider-configuration.mjs";

export const MODEL_ROLE_ROUTING_VERSION = 1;

export const MODEL_ROLES = Object.freeze(["planner", "executor", "reviewer"]);

export const MODEL_ROLE_DEFAULTS = Object.freeze({
  planner: Object.freeze({
    label: "Planner",
    taskType: "planner",
    fallbackTaskTypes: Object.freeze(["planner", "router", "chat"])
  }),
  executor: Object.freeze({
    label: "Executor",
    taskType: "chat",
    fallbackTaskTypes: Object.freeze(["chat"])
  }),
  reviewer: Object.freeze({
    label: "Reviewer",
    taskType: "reviewer",
    fallbackTaskTypes: Object.freeze(["reviewer", "summary", "chat"])
  })
});

function asString(value) {
  return `${value ?? ""}`.trim();
}

function configuredProvidersFromConfig(config = {}) {
  return Array.isArray(config.ai?.customProviders)
    ? config.ai.customProviders.map((provider) => sanitizeProviderConfig(provider))
    : [];
}

function normalizeRoleRoute(role, rawRoute = null) {
  if (!rawRoute || typeof rawRoute !== "object") return null;
  const providerId = asString(rawRoute.providerId ?? rawRoute.provider_id);
  const taskType = asString(rawRoute.taskType ?? rawRoute.task_type) || MODEL_ROLE_DEFAULTS[role]?.taskType || role;
  const model = asString(rawRoute.model);
  const mode = asString(rawRoute.mode);
  const reasoningEffort = asString(rawRoute.reasoningEffort ?? rawRoute.reasoning_effort);
  const source = asString(rawRoute.source);
  return {
    role,
    enabled: rawRoute.enabled !== false,
    taskType,
    providerId: providerId || null,
    model: model || null,
    mode: mode || null,
    reasoningEffort: reasoningEffort || null,
    source: source || "model_roles"
  };
}

export function normalizeModelRoleRoutes(config = {}) {
  const source = config.ai?.modelRoles ?? config.ai?.modelRoleRouting ?? {};
  const routes = {};
  for (const role of MODEL_ROLES) {
    routes[role] = normalizeRoleRoute(role, source?.[role]);
  }
  return routes;
}

function firstFallbackTaskRoute(role, taskRouting = {}) {
  const defaults = MODEL_ROLE_DEFAULTS[role] ?? {};
  for (const taskType of defaults.fallbackTaskTypes ?? [defaults.taskType ?? role]) {
    const taskRoute = taskRouting?.[taskType];
    if (taskRoute?.providerId) {
      return normalizeRoleRoute(role, {
        ...taskRoute,
        taskType,
        source: "task_routing_fallback"
      });
    }
  }
  return normalizeRoleRoute(role, {
    taskType: defaults.taskType ?? role,
    source: "default_runtime_fallback"
  });
}

function mergeProviderState(configProvider = {}, runtimeProvider = null) {
  const merged = {
    ...configProvider,
    ...(runtimeProvider ?? {}),
    id: asString(runtimeProvider?.id ?? configProvider.id),
    name: runtimeProvider?.displayName ?? runtimeProvider?.name ?? configProvider.name
  };
  return sanitizeProviderConfig(merged);
}

function buildProviderIndex({ config = {}, providers = [] } = {}) {
  const configProviders = configuredProvidersFromConfig(config);
  const runtimeProviders = Array.isArray(providers) ? providers : [];
  const runtimeById = new Map(runtimeProviders.map((provider) => [asString(provider.id), provider]));
  const providerIds = new Set([
    ...configProviders.map((provider) => asString(provider.id)),
    ...runtimeProviders.map((provider) => asString(provider.id))
  ].filter(Boolean));
  return new Map([...providerIds].map((providerId) => {
    const configProvider = configProviders.find((provider) => asString(provider.id) === providerId) ?? {};
    return [providerId, mergeProviderState(configProvider, runtimeById.get(providerId) ?? null)];
  }));
}

function statusForRoleRoute(route = {}, provider = null) {
  if (route.enabled === false) return "disabled";
  if (!route.providerId) return "fallback";
  if (!provider) return "missing_provider";
  if (!isProviderConfiguredForUse(provider)) return "misconfigured";
  if (provider.available === false) return "unavailable";
  if (provider.available === true) return "ready";
  return "configured";
}

function providerDescriptor(provider = null) {
  if (!provider) return null;
  return {
    providerId: asString(provider.id) || null,
    providerName: asString(provider.displayName ?? provider.name ?? provider.label ?? provider.id) || null,
    providerKind: asString(provider.kind) || null,
    providerFamily: detectProviderFamily(provider),
    configured: isProviderConfiguredForUse(provider),
    available: provider.available === true,
    configurationReason: isProviderConfiguredForUse(provider) ? "" : providerConfigurationReason(provider)
  };
}

export function buildModelRoleRoutingSummary({
  config = {},
  providers = null
} = {}) {
  const roleRoutes = normalizeModelRoleRoutes(config);
  const providerIndex = buildProviderIndex({ config, providers });
  const taskRouting = config.ai?.taskRouting ?? {};
  const roles = MODEL_ROLES.map((role) => {
    const explicitRoute = roleRoutes[role];
    const route = explicitRoute ?? firstFallbackTaskRoute(role, taskRouting);
    const provider = route.providerId ? providerIndex.get(route.providerId) ?? null : null;
    const status = statusForRoleRoute(route, provider);
    const providerInfo = providerDescriptor(provider);
    return {
      role,
      label: MODEL_ROLE_DEFAULTS[role]?.label ?? role,
      status,
      configured: status === "ready" || status === "configured",
      ready: status === "ready",
      measurable: true,
      route: {
        taskType: route.taskType,
        providerId: route.providerId,
        model: route.model,
        mode: route.mode,
        reasoningEffort: route.reasoningEffort,
        source: route.source,
        explicit: Boolean(explicitRoute)
      },
      provider: providerInfo,
      issue: status === "misconfigured"
        ? providerInfo?.configurationReason ?? "provider_misconfigured"
        : status === "missing_provider"
          ? "provider_not_found"
          : status === "unavailable"
            ? "provider_unavailable"
            : null
    };
  });
  const counts = roles.reduce((acc, role) => {
    acc.roles += 1;
    acc.byStatus[role.status] = (acc.byStatus[role.status] ?? 0) + 1;
    if (role.route.explicit) acc.explicit += 1;
    if (role.ready) acc.ready += 1;
    if (role.configured) acc.configured += 1;
    return acc;
  }, { roles: 0, explicit: 0, ready: 0, configured: 0, byStatus: {} });

  return {
    schemaVersion: MODEL_ROLE_ROUTING_VERSION,
    roles,
    counts,
    measurementKeys: roles.map((role) => `model_role.${role.role}`)
  };
}

export function resolveModelRoleRoute(role, {
  config = {},
  providers = null
} = {}) {
  return buildModelRoleRoutingSummary({ config, providers })
    .roles.find((entry) => entry.role === role) ?? null;
}
