import { existsSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function resolveSkillRootPath(templatePath) {
  if (!templatePath) {
    return templatePath;
  }
  return templatePath
    .replaceAll("%CODEX_HOME%", process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"))
    .replaceAll("%USERPROFILE%", os.homedir())
    .replace(/^~(?=$|[\\/])/, os.homedir());
}

export function readSkillDescription(markdown) {
  const lines = markdown.split(/\r?\n/);
  const frontMatterDescription = lines
    .map((line) => line.match(/^\s*description\s*:\s*(.+)\s*$/i)?.[1])
    .find(Boolean);
  if (frontMatterDescription) {
    return frontMatterDescription.replace(/^["']|["']$/g, "");
  }

  return lines
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#") && !line.startsWith("---"))
    ?? "";
}

export function readSkillDescriptor(skillDir, registryId) {
  const entryPath = path.join(skillDir, "SKILL.md");
  if (!existsSync(entryPath)) {
    return null;
  }
  const markdown = readFileSync(entryPath, "utf8");
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const id = path.basename(skillDir);
  return {
    id,
    displayName: heading ?? id,
    description: readSkillDescription(markdown),
    entryPath,
    tags: [registryId]
  };
}

export function listSkillDirectories(rootPath) {
  if (!rootPath || !existsSync(rootPath)) {
    return [];
  }

  if (existsSync(path.join(rootPath, "SKILL.md"))) {
    return [rootPath];
  }

  const directories = [];
  for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const childPath = path.join(rootPath, entry.name);
    if (existsSync(path.join(childPath, "SKILL.md"))) {
      directories.push(childPath);
      continue;
    }
    if (entry.name === ".system") {
      for (const systemEntry of readdirSync(childPath, { withFileTypes: true })) {
        if (systemEntry.isDirectory()) {
          const systemChildPath = path.join(childPath, systemEntry.name);
          if (existsSync(path.join(systemChildPath, "SKILL.md"))) {
            directories.push(systemChildPath);
          }
        }
      }
    }
  }
  return directories;
}
