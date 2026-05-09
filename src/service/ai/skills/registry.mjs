export function skillStateKey(registryId = "", skillId = "") {
  const registry = String(registryId ?? "").trim();
  const skill = String(skillId ?? "").trim();
  return registry && skill ? `${registry}:${skill}` : "";
}

function disabledSkillKeysFromContext(context = {}) {
  const config = context.config ?? context.runtime?.configStore?.load?.() ?? {};
  const values = Array.isArray(config.ai?.skills?.disabledSkillKeys)
    ? config.ai.skills.disabledSkillKeys
    : [];
  return new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean));
}

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
          const source = adapter.source ?? "runtime_config";
          const thirdParty = source === "github_install";
          return {
            id: adapter.id,
            displayName: adapter.displayName ?? adapter.id,
            rootPath: adapter.rootPath,
            available: typeof adapter.isAvailable === "function"
              ? await adapter.isAvailable(context)
              : true,
            skillCount: skills.length,
            source,
            localOnly: thirdParty,
            thirdParty
          };
        })
      );
    },
    async listSkills(context = {}) {
      const skills = [];
      const seen = new Map();
      const includeInactive = context.includeInactive === true;
      const disabledKeys = disabledSkillKeysFromContext(context);
      for (const adapter of registered.values()) {
        if (typeof adapter.listSkills !== "function") {
          continue;
        }
        const nextSkills = await adapter.listSkills(context);
        const source = adapter.source ?? "runtime_config";
        const thirdParty = source === "github_install";
        for (const skill of nextSkills ?? []) {
          const key = String(skill?.id ?? skill?.entryPath ?? "").trim().toLowerCase();
          const stateKey = skillStateKey(adapter.id, skill?.id);
          if (stateKey && disabledKeys.has(stateKey)) {
            if (includeInactive) {
              skills.push({
                registry: adapter.id,
                ...skill,
                registrySource: source,
                localOnly: thirdParty,
                thirdParty,
                skillStateKey: stateKey,
                active: false,
                inactiveReason: "disabled_by_user"
              });
            }
            continue;
          }
          if (key && seen.has(key)) {
            if (includeInactive) {
              skills.push({
                registry: adapter.id,
                ...skill,
                registrySource: source,
                localOnly: thirdParty,
                thirdParty,
                skillStateKey: stateKey,
                active: false,
                inactiveReason: "duplicate_skill_id",
                duplicateOf: seen.get(key)
              });
            }
            continue;
          }
          if (key) {
            seen.set(key, {
              registry: adapter.id,
              id: skill?.id ?? null,
              displayName: skill?.displayName ?? skill?.name ?? skill?.id ?? null
            });
          }
          skills.push({
            registry: adapter.id,
            ...skill,
            registrySource: source,
            localOnly: thirdParty,
            thirdParty,
            skillStateKey: stateKey,
            active: true
          });
        }
      }
      return skills;
    }
  };
}
