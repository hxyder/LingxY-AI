import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  listSkillDirectories,
  readSkillDescriptor,
  validateSkillDescriptorMarkdown
} from "../../src/service/ai/skills/discovery.mjs";
import { createConfiguredSkillRegistry } from "../../src/service/ai/skills/builtin.mjs";
import { removeTempDirWithRetry } from "./helpers/temp-dir.mjs";

test("skill descriptor validation keeps broken skills visible", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "uca-skill-validation-"));
  try {
    const brokenDir = path.join(root, "broken-skill");
    await mkdir(brokenDir, { recursive: true });
    await writeFile(path.join(brokenDir, "SKILL.md"), "", "utf8");

    const directories = listSkillDirectories(root);
    assert.deepEqual(directories, [brokenDir]);

    const descriptor = readSkillDescriptor(brokenDir, "scratch");
    assert.equal(descriptor.id, "broken-skill");
    assert.equal(descriptor.valid, false);
    assert.ok(descriptor.errors.some((error) => error.field === "heading"));
    assert.ok(descriptor.errors.some((error) => error.field === "description"));
  } finally {
    await removeTempDirWithRetry(root);
  }
});

test("skill registry reflects edited skill files on the next list call", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "uca-skill-refresh-"));
  try {
    const skillDir = path.join(root, "editable");
    const entryPath = path.join(skillDir, "SKILL.md");
    await mkdir(skillDir, { recursive: true });
    await writeFile(entryPath, "# Editable\n\nFirst description.", "utf8");

    const registry = createConfiguredSkillRegistry({
      id: "scratch",
      rootPath: root
    });
    assert.equal((await registry.listSkills())[0].description, "First description.");

    await writeFile(entryPath, "# Editable\n\nSecond description.", "utf8");
    assert.equal((await registry.listSkills())[0].description, "Second description.");
  } finally {
    await removeTempDirWithRetry(root);
  }
});

test("skill descriptor validator accepts heading plus frontmatter description", () => {
  const validation = validateSkillDescriptorMarkdown([
    "---",
    "description: \"Useful workflow helper\"",
    "---",
    "# Workflow Helper"
  ].join("\n"));
  assert.equal(validation.ok, true);
  assert.equal(validation.heading, "Workflow Helper");
  assert.equal(validation.description, "Useful workflow helper");
});
