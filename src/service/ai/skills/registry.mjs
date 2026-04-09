export function createSkillRegistry(adapters = []) {
  const registered = new Map(adapters.map((adapter) => [adapter.id, adapter]));

  return {
    register(adapter) {
      registered.set(adapter.id, adapter);
      return adapter;
    },
    list() {
      return [...registered.values()];
    }
  };
}
