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
    async listStatus(context = {}) {
      return Promise.all(
        [...registered.values()].map(async (provider) => {
          if (typeof provider.getStatus === "function") {
            return provider.getStatus(context);
          }
          return {
            id: provider.id,
            displayName: provider.displayName,
            kind: provider.kind,
            capabilities: provider.capabilities,
            configured: typeof provider.isConfigured === "function"
              ? await provider.isConfigured(context)
              : false
          };
        })
      );
    },
    get(providerId) {
      return registered.get(providerId) ?? null;
    },
    async getStatus(providerId, context = {}) {
      const provider = registered.get(providerId);
      if (!provider) {
        return null;
      }
      if (typeof provider.getStatus === "function") {
        return provider.getStatus(context);
      }
      return {
        id: provider.id,
        displayName: provider.displayName,
        kind: provider.kind,
        capabilities: provider.capabilities,
        configured: typeof provider.isConfigured === "function"
          ? await provider.isConfigured(context)
          : false
      };
    }
  };
}
