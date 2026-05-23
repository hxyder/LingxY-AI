export function createExecutorRegistry(executors = []) {
  const registered = new Map(executors.map((executor) => [executor.id, executor]));

  return {
    register(executor) {
      registered.set(executor.id, executor);
      return executor;
    },
    get(executorId) {
      return registered.get(executorId) ?? null;
    },
    list() {
      return [...registered.values()];
    },
    pick({ preferredId = null, privacyLevel = "local_only" } = {}) {
      if (preferredId && registered.has(preferredId)) {
        return registered.get(preferredId);
      }

      if (privacyLevel === "local_only") {
        return registered.get("fast")
          ?? registered.get("multi_modal")
          ?? [...registered.values()][0]
          ?? null;
      }

      return [...registered.values()][0] ?? null;
    }
  };
}
