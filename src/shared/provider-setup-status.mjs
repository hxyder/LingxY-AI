import { BUILTIN_API_TEMPLATES, detectProviderFamily } from "./provider-catalog.mjs";
import {
  isProviderConfiguredForUse,
  providerConfigurationReason
} from "./provider-configuration.mjs";
import { t } from "./i18n/index.mjs";

export const PROVIDER_SETUP_STATUS_VERSION = 1;

const SETUP_STATUSES = Object.freeze({
  READY: "ready",
  RECOVERABLE: "recoverable",
  ACTION_NEEDED: "action_needed"
});

function normalizeId(value) {
  return `${value ?? ""}`.trim();
}

function displayNameForProvider(provider = {}, locale = "en-US") {
  return normalizeId(provider.displayName)
    || normalizeId(provider.name)
    || normalizeId(provider.label)
    || normalizeId(provider.id)
    || t(locale, "providerSetup.providerFallbackName");
}

function configuredProvidersFromConfig(config = {}) {
  return Array.isArray(config.ai?.customProviders)
    ? config.ai.customProviders
    : [];
}

function codeCliAdaptersFromConfig(config = {}) {
  return Array.isArray(config.ai?.codeCli?.adapters)
    ? config.ai.codeCli.adapters
    : [];
}

function mergeProviderState(configProvider = {}, runtimeProvider = null) {
  return {
    ...configProvider,
    ...(runtimeProvider ?? {}),
    id: normalizeId(runtimeProvider?.id ?? configProvider.id),
    name: runtimeProvider?.displayName ?? runtimeProvider?.name ?? configProvider.name
  };
}

function hasReadyProvider(provider = {}) {
  return provider.available === true && provider.configured === true;
}

function hasReadyCli(adapter = {}) {
  return adapter.available === true && (adapter.configured === true || Boolean(normalizeId(adapter.command)));
}

function hasConfiguredCli(adapter = {}) {
  return adapter.configured === true || Boolean(normalizeId(adapter.command));
}

function providerSetupAction(type, fields = {}) {
  return {
    type,
    panelId: "providerSettingsPanel",
    ...fields
  };
}

function issue(fields) {
  return {
    severity: "action_needed",
    action: providerSetupAction("open_provider_settings"),
    ...fields
  };
}

function buildTemplate(template = {}, locale = "en-US") {
  const requiresApiKey = template.kind !== "ollama";
  return {
    id: template.id,
    label: template.label,
    kind: template.kind,
    baseUrl: template.baseUrl,
    defaultModel: template.defaultModel,
    providerFamily: detectProviderFamily(template),
    requiresApiKey,
    // Secret-free contract: setup status never echoes secret value fields.
    // Locale strings may mention API keys, but the returned status only carries recovery hints.
    authHint: template.kind === "ollama"
      ? t(locale, "providerSetup.ollamaAuthHint")
      : t(locale, "providerSetup.apiKeyAuthHint"),
    action: providerSetupAction("add_provider_from_template", { templateId: template.id })
  };
}

export function buildProviderSetupStatus({
  config = {},
  providers = null,
  codeCliAdapters = null,
  locale = "en-US"
} = {}) {
  const configProviders = configuredProvidersFromConfig(config);
  const runtimeProviders = Array.isArray(providers) ? providers : [];
  const runtimeById = new Map(runtimeProviders.map((provider) => [normalizeId(provider.id), provider]));
  const providerIds = new Set([
    ...configProviders.map((provider) => normalizeId(provider.id)),
    ...runtimeProviders.map((provider) => normalizeId(provider.id))
  ].filter(Boolean));
  const mergedProviders = [...providerIds].map((providerId) => {
    const configProvider = configProviders.find((provider) => normalizeId(provider.id) === providerId) ?? {};
    return mergeProviderState(configProvider, runtimeById.get(providerId) ?? null);
  });

  const configCliAdapters = codeCliAdaptersFromConfig(config);
  const runtimeCliAdapters = Array.isArray(codeCliAdapters) ? codeCliAdapters : [];
  const cliIds = new Set([
    ...configCliAdapters.map((adapter) => normalizeId(adapter.id)),
    ...runtimeCliAdapters.map((adapter) => normalizeId(adapter.id))
  ].filter(Boolean));
  const mergedCliAdapters = [...cliIds].map((adapterId) => {
    const configAdapter = configCliAdapters.find((adapter) => normalizeId(adapter.id) === adapterId) ?? {};
    const runtimeAdapter = runtimeCliAdapters.find((adapter) => normalizeId(adapter.id) === adapterId) ?? {};
    return {
      ...configAdapter,
      ...runtimeAdapter,
      id: adapterId
    };
  });

  const issues = [];
  for (const provider of mergedProviders) {
    const providerId = normalizeId(provider.id);
    if (!providerId) continue;
    const configured = isProviderConfiguredForUse(provider);
    if (!configured) {
      const reason = providerConfigurationReason(provider);
      issues.push(issue({
        id: `provider:${providerId}:${reason}`,
        kind: "provider_config",
        providerId,
        providerFamily: detectProviderFamily(provider),
        title: t(locale, "providerSetup.providerNeedsSetup", {
          providerName: displayNameForProvider(provider, locale)
        }),
        detail: reason === "api_key_missing"
          ? t(locale, "providerSetup.apiKeyMissingDetail")
          : reason === "command_missing"
            ? t(locale, "providerSetup.commandMissingDetail")
            : t(locale, "providerSetup.reviewProviderDetail"),
        recovery: reason,
        action: providerSetupAction("edit_provider", { providerId })
      }));
      continue;
    }
    if (provider.available === false) {
      issues.push(issue({
        id: `provider:${providerId}:unavailable`,
        kind: "provider_runtime",
        providerId,
        providerFamily: detectProviderFamily(provider),
        severity: "recoverable",
        title: t(locale, "providerSetup.providerConfiguredUnavailable", {
          providerName: displayNameForProvider(provider, locale)
        }),
        detail: normalizeId(provider.detail) || t(locale, "providerSetup.runtimeUnavailableDetail"),
        recovery: "runtime_unavailable",
        action: providerSetupAction("test_provider", { providerId })
      }));
    }
  }

  for (const adapter of mergedCliAdapters) {
    const adapterId = normalizeId(adapter.id);
    if (!adapterId) continue;
    if (!hasConfiguredCli(adapter)) {
      issues.push(issue({
        id: `code-cli:${adapterId}:command_missing`,
        kind: "code_cli_config",
        providerId: adapterId,
        title: t(locale, "providerSetup.codeCliNeedsCommand", {
          providerName: displayNameForProvider(adapter, locale)
        }),
        detail: t(locale, "providerSetup.cliCommandMissingDetail"),
        recovery: "command_missing",
        action: providerSetupAction("edit_code_cli", { providerId: adapterId })
      }));
      continue;
    }
    if (adapter.available === false) {
      issues.push(issue({
        id: `code-cli:${adapterId}:unavailable`,
        kind: "code_cli_runtime",
        providerId: adapterId,
        severity: "recoverable",
        title: t(locale, "providerSetup.codeCliUnavailable", {
          providerName: displayNameForProvider(adapter, locale)
        }),
        detail: normalizeId(adapter.detail) || t(locale, "providerSetup.cliUnavailableDetail"),
        recovery: "runtime_unavailable",
        action: providerSetupAction("test_code_cli", { providerId: adapterId })
      }));
    }
  }

  const readyProviders = mergedProviders.filter(hasReadyProvider);
  const configuredProviders = mergedProviders.filter((provider) => isProviderConfiguredForUse(provider));
  const readyCliAdapters = mergedCliAdapters.filter(hasReadyCli);
  const configuredCliAdapters = mergedCliAdapters.filter(hasConfiguredCli);
  const hasUsableRuntime = readyProviders.length > 0 || readyCliAdapters.length > 0;
  const hasConfiguredRuntime = configuredProviders.length > 0 || configuredCliAdapters.length > 0;
  const status = hasUsableRuntime
    ? SETUP_STATUSES.READY
    : hasConfiguredRuntime || issues.length > 0
      ? SETUP_STATUSES.RECOVERABLE
      : SETUP_STATUSES.ACTION_NEEDED;

  return {
    schemaVersion: PROVIDER_SETUP_STATUS_VERSION,
    status,
    hasUsableRuntime,
    hasConfiguredRuntime,
    primaryIssue: issues.find((entry) => entry.severity === "action_needed") ?? issues[0] ?? null,
    nextAction: status === SETUP_STATUSES.READY
      ? providerSetupAction("open_model_routing", { panelId: "routingSettingsPanel" })
      : providerSetupAction(mergedProviders.length || mergedCliAdapters.length ? "recover_provider_setup" : "add_provider"),
    counts: {
      providers: mergedProviders.length,
      configuredProviders: configuredProviders.length,
      readyProviders: readyProviders.length,
      codeCliAdapters: mergedCliAdapters.length,
      configuredCliAdapters: configuredCliAdapters.length,
      readyCliAdapters: readyCliAdapters.length,
      issues: issues.length
    },
    issues,
    recommendedProviders: BUILTIN_API_TEMPLATES.map((template) => buildTemplate(template, locale))
  };
}
