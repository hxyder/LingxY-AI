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

function descriptorError(field, message) {
  return { field, message };
}

export function validateSkillDescriptorMarkdown(markdown = "") {
  const errors = [];
  const text = String(markdown ?? "");
  const heading = text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "";
  const description = readSkillDescription(text);
  if (!heading) {
    errors.push(descriptorError("heading", "SKILL.md should start with a level-1 heading, for example \"# My Skill\"."));
  }
  if (!description) {
    errors.push(descriptorError("description", "SKILL.md should include a short description or frontmatter description field."));
  }
  return {
    ok: errors.length === 0,
    errors,
    heading,
    description
  };
}

export function readSkillDescriptor(skillDir, registryId) {
  const entryPath = path.join(skillDir, "SKILL.md");
  const id = path.basename(skillDir);
  if (!existsSync(entryPath)) {
    return null;
  }
  let markdown = "";
  try {
    markdown = readFileSync(entryPath, "utf8");
  } catch (error) {
    return {
      id,
      displayName: id,
      description: "",
      entryPath,
      tags: [registryId],
      valid: false,
      errors: [descriptorError("entryPath", `Could not read SKILL.md: ${error.message}`)]
    };
  }
  const validation = validateSkillDescriptorMarkdown(markdown);
  return {
    id,
    displayName: validation.heading || id,
    description: validation.description,
    entryPath,
    tags: [registryId],
    valid: validation.ok,
    errors: validation.errors
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
