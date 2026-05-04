export function isModelPickerProviderConfigured(provider = {}) {
  if (!provider?.id) return false;
  if (provider.kind === "code_cli") return Boolean(provider.command);
  if (provider.kind === "ollama") return true;
  return Boolean(provider.apiKey || provider.apiKeyRef || provider.apiKeyConfigured);
}

export function modelPickerProviderSetupReason(provider = {}) {
  if (!provider?.id) return "Add a provider before choosing a conversation model.";
  if (provider.kind === "code_cli") return "Add the CLI command for this provider.";
  if (provider.kind === "ollama") return "";
  return "Add an API key or saved secret for this provider.";
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
