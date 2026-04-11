export function createSkillRegistry(adapters = []) {
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
          const skills = typeof adapter.listSkills === "function"
            ? await adapter.listSkills(context)
            : [];
          return {
            id: adapter.id,
            displayName: adapter.displayName ?? adapter.id,
            rootPath: adapter.rootPath,
            available: typeof adapter.isAvailable === "function"
              ? await adapter.isAvailable(context)
              : true,
            skillCount: skills.length,
            source: adapter.source ?? "runtime_config"
          };
        })
      );
    },
    async listSkills(context = {}) {
      const skills = [];
      for (const adapter of registered.values()) {
        if (typeof adapter.listSkills !== "function") {
          continue;
        }
        const nextSkills = await adapter.listSkills(context);
        for (const skill of nextSkills ?? []) {
          skills.push({
            registry: adapter.id,
            ...skill
          });
        }
      }
      return skills;
    }
  };
}
