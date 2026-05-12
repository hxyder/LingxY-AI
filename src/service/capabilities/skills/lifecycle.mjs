import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { readSkillDescriptor, validateSkillDescriptorMarkdown } from "./discovery.mjs";

const DEFAULT_HISTORY_LIMIT = 30;
const MAX_HISTORY_LIMIT = 200;

function expandLocalPath(value) {
  if (!value) return null;
  return `${value}`
    .replaceAll("%CODEX_HOME%", process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"))
    .replaceAll("%USERPROFILE%", os.homedir())
    .replace(/^~(?=$|[\\/])/, os.homedir());
}

function isPathInside(candidatePath, rootPath) {
  const candidate = path.resolve(candidatePath).toLowerCase();
  const root = path.resolve(rootPath).toLowerCase();
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function configuredSkillRoots(runtime = {}) {
  const config = runtime.configStore?.load?.() ?? {};
  return [
    runtime.paths?.skillsDir,
    path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"), "skills"),
    ...(config.ai?.skills?.registries ?? []).map((registry) => expandLocalPath(registry.rootPath ?? registry.path))
  ].filter(Boolean);
}

export function resolveEditableSkillEntryPath(runtime = {}, entryPath = "") {
  if (!entryPath || path.basename(entryPath) !== "SKILL.md") return null;
  const resolved = path.resolve(entryPath);
  return configuredSkillRoots(runtime).some((root) => isPathInside(resolved, root)) ? resolved : null;
}

export function resolveDeletableSkillEntryPath(runtime = {}, entryPath = "") {
  if (!entryPath || path.basename(entryPath) !== "SKILL.md") return null;
  const rootPath = runtime.paths?.skillsDir;
  if (!rootPath) return null;
  const resolved = path.resolve(entryPath);
  const root = path.resolve(rootPath);
  const skillDir = path.dirname(resolved);
  const deletedRoot = path.join(root, ".deleted");
  if (!isPathInside(resolved, root)) return null;
  if (sameResolvedPath(skillDir, root)) return null;
  if (isPathInside(skillDir, deletedRoot)) return null;
  return resolved;
}

export function slugifySkillId(value = "") {
  const slug = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "skill";
}

function skillTitle(value = "", fallback = "New Skill") {
  return String(value ?? "").trim() || fallback;
}

export function createSkillMarkdown({
  name = "New Skill",
  description = "Describe when this skill should be used.",
  instructions = []
} = {}) {
  const title = skillTitle(name);
  const desc = String(description ?? "").trim() || "Describe when this skill should be used.";
  const instructionLines = Array.isArray(instructions) && instructions.length > 0
    ? instructions.map((line) => `- ${String(line ?? "").trim()}`).filter((line) => line !== "- ")
    : [
        "- Define the inputs this skill expects.",
        "- Describe the workflow the assistant should follow.",
        "- List any validation or handoff steps before finishing."
      ];
  return [
    `# ${title}`,
    "",
    `description: ${desc}`,
    "",
    "## When To Use",
    "- Use this skill for repeatable work that should not be copied into every user prompt.",
    "",
    "## Instructions",
    ...instructionLines,
    ""
  ].join("\n");
}

async function uniqueSkillDir(rootPath, requestedId) {
  const baseId = slugifySkillId(requestedId);
  let candidate = baseId;
  for (let index = 2; index < 200; index += 1) {
    const dir = path.join(rootPath, candidate);
    if (!isPathInside(dir, rootPath)) throw new Error("skill_path_not_allowed");
    if (!existsSync(dir)) return { id: candidate, dir };
    candidate = `${baseId}-${index}`;
  }
  throw new Error("could_not_allocate_skill_id");
}

function defaultSkillRoot(runtime = {}) {
  return runtime.paths?.skillsDir ?? configuredSkillRoots(runtime)[0] ?? null;
}

export async function createEditableSkill(runtime = {}, {
  id = "",
  name = "New Skill",
  description = "",
  markdown = ""
} = {}) {
  const rootPath = defaultSkillRoot(runtime);
  if (!rootPath) throw new Error("skillsDir_not_configured");
  await mkdir(rootPath, { recursive: true });
  const { id: skillId, dir } = await uniqueSkillDir(rootPath, id || name);
  await mkdir(dir, { recursive: true });
  const entryPath = path.join(dir, "SKILL.md");
  const nextMarkdown = String(markdown ?? "").trim()
    ? String(markdown)
    : createSkillMarkdown({ name, description });
  await writeFile(entryPath, nextMarkdown, "utf8");
  return {
    ok: true,
    id: skillId,
    entryPath,
    markdown: nextMarkdown,
    validation: validateSkillDescriptorMarkdown(nextMarkdown)
  };
}

function replaceFirstHeading(markdown = "", name = "") {
  const title = skillTitle(name, "");
  if (!title) return markdown;
  const text = String(markdown ?? "");
  if (/^#\s+.+$/m.test(text)) return text.replace(/^#\s+.+$/m, `# ${title}`);
  return `# ${title}\n\n${text}`;
}

export async function duplicateEditableSkill(runtime = {}, {
  entryPath = "",
  id = "",
  name = ""
} = {}) {
  const sourceEntryPath = resolveEditableSkillEntryPath(runtime, entryPath);
  if (!sourceEntryPath) throw new Error("skill_path_not_allowed");
  const sourceDirName = path.basename(path.dirname(sourceEntryPath));
  const sourceMarkdown = await readFile(sourceEntryPath, "utf8");
  const copyName = skillTitle(name, `${sourceDirName} Copy`);
  const rootPath = defaultSkillRoot(runtime);
  if (!rootPath) throw new Error("skillsDir_not_configured");
  await mkdir(rootPath, { recursive: true });
  const { id: skillId, dir } = await uniqueSkillDir(rootPath, id || `${sourceDirName}-copy`);
  await mkdir(dir, { recursive: true });
  const markdown = replaceFirstHeading(sourceMarkdown, copyName);
  const nextEntryPath = path.join(dir, "SKILL.md");
  await writeFile(nextEntryPath, markdown, "utf8");
  return {
    ok: true,
    id: skillId,
    entryPath: nextEntryPath,
    markdown,
    validation: validateSkillDescriptorMarkdown(markdown),
    sourceEntryPath
  };
}

export async function deleteEditableSkill(runtime = {}, {
  entryPath = ""
} = {}) {
  const resolved = resolveDeletableSkillEntryPath(runtime, entryPath);
  if (!resolved) throw new Error("skill_path_not_allowed");
  if (!existsSync(resolved)) throw new Error("skill_not_found");
  const rootPath = path.resolve(runtime.paths.skillsDir);
  const skillDir = path.dirname(resolved);
  const deletedRoot = path.join(rootPath, ".deleted");
  await mkdir(deletedRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const deletedDir = path.join(deletedRoot, `${path.basename(skillDir)}-${stamp}-${crypto.randomUUID().slice(0, 8)}`);
  await rename(skillDir, deletedDir);
  return {
    ok: true,
    entryPath: resolved,
    deletedPath: deletedDir,
    recoverable: true
  };
}

function historyDirForEntry(entryPath) {
  return path.join(path.dirname(entryPath), ".history");
}

function historyIdFromFilename(filename = "") {
  return path.basename(filename).replace(/\.md$/i, "");
}

function skillHistoryLimit(runtime = {}) {
  const config = runtime.configStore?.load?.() ?? {};
  const raw = runtime.skillHistoryLimit ?? config.ai?.skills?.historyLimit;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_HISTORY_LIMIT;
  return Math.min(Math.max(1, Math.floor(value)), MAX_HISTORY_LIMIT);
}

export async function listSkillHistory(runtime = {}, entryPath = "") {
  const resolved = resolveEditableSkillEntryPath(runtime, entryPath);
  if (!resolved) throw new Error("skill_path_not_allowed");
  const historyDir = historyDirForEntry(resolved);
  if (!existsSync(historyDir)) return { ok: true, entryPath: resolved, history: [] };
  const entries = await readdir(historyDir, { withFileTypes: true });
  const history = entries
    .filter((entry) => entry.isFile() && /^backup-.+\.md$/i.test(entry.name))
    .map((entry) => ({
      id: historyIdFromFilename(entry.name),
      path: path.join(historyDir, entry.name)
    }))
    .sort((a, b) => b.id.localeCompare(a.id));
  return { ok: true, entryPath: resolved, history };
}

async function pruneSkillHistory(runtime = {}, entryPath = "") {
  const limit = skillHistoryLimit(runtime);
  const history = await listSkillHistory(runtime, entryPath);
  const stale = history.history.slice(limit);
  await Promise.all(stale.map((entry) => rm(entry.path, { force: true })));
  return {
    limit,
    removed: stale.map((entry) => entry.id),
    remaining: Math.min(history.history.length, limit)
  };
}

export async function backupSkillMarkdown(runtime = {}, entryPath = "") {
  const resolved = resolveEditableSkillEntryPath(runtime, entryPath);
  if (!resolved) throw new Error("skill_path_not_allowed");
  if (!existsSync(resolved)) return null;
  const markdown = await readFile(resolved, "utf8");
  const historyDir = historyDirForEntry(resolved);
  await mkdir(historyDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const id = `backup-${stamp}-${crypto.randomUUID().slice(0, 8)}`;
  const backupPath = path.join(historyDir, `${id}.md`);
  await writeFile(backupPath, markdown, "utf8");
  const retention = await pruneSkillHistory(runtime, resolved);
  return { id, path: backupPath, retention };
}

export async function writeSkillMarkdownWithBackup(runtime = {}, {
  entryPath = "",
  markdown = ""
} = {}) {
  const resolved = resolveEditableSkillEntryPath(runtime, entryPath);
  if (!resolved) throw new Error("skill_path_not_allowed");
  const current = existsSync(resolved) ? await readFile(resolved, "utf8") : "";
  const nextMarkdown = String(markdown ?? "");
  const backup = current !== nextMarkdown ? await backupSkillMarkdown(runtime, resolved) : null;
  await writeFile(resolved, nextMarkdown, "utf8");
  return {
    ok: true,
    entryPath: resolved,
    backup,
    validation: validateSkillDescriptorMarkdown(nextMarkdown)
  };
}

export async function rollbackSkillMarkdown(runtime = {}, {
  entryPath = "",
  historyId = ""
} = {}) {
  const resolved = resolveEditableSkillEntryPath(runtime, entryPath);
  if (!resolved) throw new Error("skill_path_not_allowed");
  const history = await listSkillHistory(runtime, resolved);
  const selected = historyId
    ? history.history.find((entry) => entry.id === historyId)
    : history.history[0];
  if (!selected) throw new Error("skill_history_not_found");
  const markdown = await readFile(selected.path, "utf8");
  const backup = await backupSkillMarkdown(runtime, resolved);
  await writeFile(resolved, markdown, "utf8");
  return {
    ok: true,
    entryPath: resolved,
    restoredHistoryId: selected.id,
    backup,
    markdown,
    validation: validateSkillDescriptorMarkdown(markdown)
  };
}

function sameResolvedPath(a = "", b = "") {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

async function findDiscoveredSkill(runtime = {}, resolvedEntryPath = "") {
  if (typeof runtime.platform?.skillRegistries?.listSkills !== "function") {
    return {
      checked: false,
      discovered: null,
      reason: "skill_registry_unavailable"
    };
  }
  const config = runtime.configStore?.load?.() ?? {};
  const skills = await runtime.platform.skillRegistries.listSkills({ runtime, config });
  const matched = (skills ?? []).find((skill) =>
    skill?.entryPath && sameResolvedPath(skill.entryPath, resolvedEntryPath)
  ) ?? null;
  return {
    checked: true,
    discovered: Boolean(matched),
    registry: matched?.registry ?? matched?.tags?.[0] ?? null,
    skill: matched
      ? {
          id: matched.id ?? null,
          displayName: matched.displayName ?? matched.name ?? matched.id ?? null,
          description: matched.description ?? "",
          valid: matched.valid !== false
        }
      : null
  };
}

export async function testEditableSkill(runtime = {}, {
  entryPath = "",
  markdown = undefined
} = {}) {
  const resolved = resolveEditableSkillEntryPath(runtime, entryPath);
  if (!resolved) throw new Error("skill_path_not_allowed");
  const diskMarkdown = existsSync(resolved) ? await readFile(resolved, "utf8") : "";
  const candidateMarkdown = markdown === undefined ? diskMarkdown : String(markdown ?? "");
  const validation = validateSkillDescriptorMarkdown(candidateMarkdown);
  const descriptor = readSkillDescriptor(path.dirname(resolved), "editable-skill-test");
  const saved = candidateMarkdown === diskMarkdown;
  const discovery = await findDiscoveredSkill(runtime, resolved);
  const checks = [
    {
      id: "descriptor_valid",
      ok: validation.ok,
      label: validation.ok ? "Descriptor is valid." : "Descriptor needs heading/description fixes."
    },
    {
      id: "saved_to_disk",
      ok: saved,
      label: saved ? "Editor content matches the saved SKILL.md." : "Editor has unsaved changes."
    },
    {
      id: "runtime_discovery",
      ok: discovery.checked ? discovery.discovered : null,
      label: discovery.checked
        ? (discovery.discovered ? "Runtime can discover this skill." : "Runtime did not discover this skill.")
        : "Runtime discovery was not available in this context."
    }
  ];
  const ok = validation.ok && saved && (discovery.checked ? discovery.discovered : true);
  return {
    ok,
    entryPath: resolved,
    validation,
    saved,
    discovery,
    descriptor: {
      id: descriptor?.id ?? path.basename(path.dirname(resolved)),
      displayName: validation.heading || descriptor?.displayName || path.basename(path.dirname(resolved)),
      description: validation.description || descriptor?.description || "",
      valid: validation.ok,
      errors: validation.errors
    },
    checks
  };
}
