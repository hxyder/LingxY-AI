function asString(value) {
  return `${value ?? ""}`.trim();
}

export function isProviderConfiguredForUse(provider = {}) {
  if (!provider?.id) return false;
  if (provider.kind === "code_cli") return Boolean(asString(provider.command));
  if (provider.kind === "ollama") return true;
  return Boolean(
    asString(provider.apiKey)
    || asString(provider.apiKeyRef)
    || provider.apiKeyConfigured === true
  );
}

export function providerConfigurationReason(provider = {}) {
  if (!provider?.id) return "provider_not_found";
  if (provider.kind === "code_cli") return "command_missing";
  if (provider.kind === "ollama") return "";
  return "api_key_missing";
}
