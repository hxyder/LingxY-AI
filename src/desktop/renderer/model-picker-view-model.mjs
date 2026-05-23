import {
  isProviderConfiguredForUse,
  providerConfigurationReason
} from "../../shared/provider-configuration.mjs";

export function isModelPickerProviderConfigured(provider = {}) {
  return isProviderConfiguredForUse(provider);
}

export function modelPickerProviderSetupReason(provider = {}) {
  const reason = providerConfigurationReason(provider);
  if (reason === "provider_not_found") return "Add a provider before choosing a conversation model.";
  if (reason === "command_missing") return "Add the CLI command for this provider.";
  if (reason === "api_key_missing") return "Add an API key or saved secret for this provider.";
  return "";
}

export function configuredModelPickerProviders(providers = []) {
  return providers.filter(isModelPickerProviderConfigured);
}

export function selectModelPickerProviderId(providers = [], selectedProviderId = null) {
  const entries = providers.filter((provider) => provider?.id);
  if (!entries.length) return null;
  if (selectedProviderId && entries.some((provider) => provider.id === selectedProviderId)) {
    return selectedProviderId;
  }
  return entries.find(isModelPickerProviderConfigured)?.id ?? entries[0]?.id ?? null;
}

export function buildModelPickerProviderItems(providers = [], selectedProviderId = null) {
  const selectedId = selectModelPickerProviderId(providers, selectedProviderId);
  return providers
    .filter((provider) => provider?.id)
    .map((provider) => {
      const configured = isModelPickerProviderConfigured(provider);
      return {
        id: provider.id,
        label: provider.name ?? provider.id,
        kind: provider.kind ?? "provider",
        provider,
        configured,
        selected: provider.id === selectedId,
        statusLabel: configured ? "Ready" : "Setup required",
        setupReason: configured ? "" : modelPickerProviderSetupReason(provider)
      };
    });
}
