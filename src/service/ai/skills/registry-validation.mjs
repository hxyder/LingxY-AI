import { existsSync } from "node:fs";
import { listSkillDirectories, resolveSkillRootPath } from "./discovery.mjs";

export function validateSkillRegistryDescriptor(input = {}) {
  const errors = [];
  const id = typeof input.id === "string" ? input.id.trim() : "";
  const rootPath = resolveSkillRootPath(input.rootPath);
  if (!id) {
    errors.push("id required");
  }
  if (!rootPath) {
    errors.push("rootPath required");
  } else if (!existsSync(rootPath)) {
    errors.push("rootPath does not exist");
  }

  const skillDirectories = errors.length === 0 ? listSkillDirectories(rootPath) : [];
  if (errors.length === 0 && skillDirectories.length === 0) {
    errors.push("no SKILL.md files found");
  }

  const registry = {
    id,
    displayName: input.displayName ?? input.name ?? id,
    rootPath,
    enabled: input.enabled !== false
  };

  return {
    ok: errors.length === 0,
    errors,
    registry,
    skillCount: skillDirectories.length
  };
}
