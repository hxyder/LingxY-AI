export function createAIProviderRegistry(providers = []) {
  const registered = new Map(providers.map((provider) => [provider.id, provider]));

  return {
    register(provider) {
      registered.set(provider.id, provider);
      return provider;
    },
    list() {
      return [...registered.values()];
    },
    get(providerId) {
      return registered.get(providerId) ?? null;
    }
  };
}
