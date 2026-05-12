import { existsSync } from "node:fs";
import {
  deriveSkillRegistryId,
  listSkillDirectories,
  readSkillDescriptor,
  resolveSkillRootPath
} from "./discovery.mjs";

export function createConfiguredSkillRegistry(config = {}) {
  const rootPath = resolveSkillRootPath(config.rootPath ?? config.path);
  const id = config.id ?? deriveSkillRegistryId(rootPath, { source: config.source ?? "runtime_config" });

  return {
    id,
    displayName: config.displayName ?? config.name ?? id,
    rootPath,
    source: config.source ?? "runtime_config",
    async isAvailable() {
      return Boolean(config.enabled !== false && rootPath && existsSync(rootPath));
    },
    async listSkills() {
      if (config.enabled === false) {
        return [];
      }
      return listSkillDirectories(rootPath)
        .map((skillDir) => readSkillDescriptor(skillDir, id))
        .filter(Boolean);
    }
  };
}

export const BUILTIN_SKILL_REGISTRIES = Object.freeze([
  createConfiguredSkillRegistry({
    id: "local-codex-skills",
    displayName: "Local Codex Skills",
    rootPath: "%CODEX_HOME%/skills",
    source: "builtin"
  })
]);
