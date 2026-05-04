import {
  buildProviderOnboardingSuggestions,
  mergeProviderOnboardingSuggestions
} from "./provider-suggestions.mjs";

function normalizeId(value) {
  return `${value ?? ""}`.trim();
}

function configuredProvidersFromConfig(config = {}) {
  return Array.isArray(config.ai?.customProviders)
    ? config.ai.customProviders
    : [];
}

function providerForOverride(providers = [], override = null) {
  const providerId = normalizeId(override?.providerId ?? override?.provider_id);
  if (!providerId) return null;
  return providers.find((provider) => normalizeId(provider.id) === providerId) ?? null;
}

function stampSuggestionContext(suggestion, { trigger = "capability_gap", conversationId = null } = {}) {
  return {
    ...suggestion,
    trigger,
    ...(conversationId ? { conversationId } : {})
  };
}

export function buildCapabilityGapSuggestions({
  config = {},
  provider = null,
  providers = null,
  conversationModelOverride = null,
  conversationId = null,
  env = process.env,
  trigger = null
} = {}) {
  const providerList = providers ?? configuredProvidersFromConfig(config);
  const selectedProviders = provider
    ? [provider]
    : conversationModelOverride
      ? [providerForOverride(providerList, conversationModelOverride)].filter(Boolean)
      : providerList;
  const resolvedTrigger = trigger
    ?? (conversationModelOverride ? "conversation_model_override" : "capability_gap");

  return selectedProviders.flatMap((entry) =>
    buildProviderOnboardingSuggestions(entry, { config, env })
      .map((suggestion) => stampSuggestionContext(suggestion, {
        trigger: resolvedTrigger,
        conversationId
      }))
  );
}

export function mergeCapabilityGapSuggestions(onboarding = {}, suggestions = [], options = {}) {
  return mergeProviderOnboardingSuggestions(onboarding, suggestions, options);
}
