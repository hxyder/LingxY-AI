export function createCodeCliRegistry(adapters = []) {
  const registered = new Map(adapters.map((adapter) => [adapter.id, adapter]));

  return {
    register(adapter) {
      registered.set(adapter.id, adapter);
      return adapter;
    },
    list() {
      return [...registered.values()];
    },
    get(adapterId) {
      return registered.get(adapterId) ?? null;
    },
    async listStatus(context = {}) {
      return Promise.all(
        [...registered.values()].map(async (adapter) => {
          if (typeof adapter.getStatus === "function") {
            return adapter.getStatus(context);
          }
          return {
            id: adapter.id,
            displayName: adapter.displayName,
            executable: adapter.executable,
            supportsCheckpointResume: adapter.supportsCheckpointResume,
            available: typeof adapter.isAvailable === "function"
              ? await adapter.isAvailable(context)
              : true
          };
        })
      );
    },
    async getStatus(adapterId, context = {}) {
      const adapter = registered.get(adapterId);
      if (!adapter) {
        return null;
      }
      if (typeof adapter.getStatus === "function") {
        return adapter.getStatus(context);
      }
      return {
        id: adapter.id,
        displayName: adapter.displayName,
        executable: adapter.executable,
        supportsCheckpointResume: adapter.supportsCheckpointResume,
        available: typeof adapter.isAvailable === "function"
          ? await adapter.isAvailable(context)
          : true
      };
    }
  };
}
