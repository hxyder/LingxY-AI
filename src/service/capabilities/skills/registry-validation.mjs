import { existsSync } from "node:fs";
import { listSkillDirectories, resolveSkillRootPath } from "./discovery.mjs";

function validationError(field, message) {
  return { field, message };
}

export function validateSkillRegistryDescriptor(input = {}) {
  const errors = [];
  const id = typeof input.id === "string" ? input.id.trim() : "";
  const rootPath = resolveSkillRootPath(input.rootPath);
  if (!id) {
    errors.push(validationError("id", "Registry id is required, for example \"my-skills\"."));
  }
  if (!rootPath) {
    errors.push(validationError("rootPath", "Root path is required and should point to a folder containing SKILL.md files."));
  } else if (!existsSync(rootPath)) {
    errors.push(validationError("rootPath", `Path does not exist on disk: ${rootPath}`));
  }

  const skillDirectories = errors.length === 0 ? listSkillDirectories(rootPath) : [];
  if (errors.length === 0 && skillDirectories.length === 0) {
    errors.push(validationError("rootPath", "No SKILL.md files were found at this path. Choose a folder containing SKILL.md or skill subfolders."));
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
