import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  deriveSkillRegistryId,
  listSkillDirectories,
  readSkillDescriptor,
  validateSkillDescriptorMarkdown
} from "../../src/service/capabilities/skills/discovery.mjs";
import { createConfiguredSkillRegistry } from "../../src/service/capabilities/skills/builtin.mjs";
import { createSkillRegistry, skillStateKey } from "../../src/service/capabilities/skills/registry.mjs";
import { buildAIIntegrationRegistries } from "../../src/service/ai/integrations/runtime.mjs";
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

test("legacy GitHub-installed skill registries without id are still discoverable", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "uca-skill-legacy-registry-"));
  try {
    const skillDir = path.join(root, "external", "owner--repo--skills--docx", "skills", "docx");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), "# DOCX Skill\n\ndescription: edits docx files\n", "utf8");

    const registryId = deriveSkillRegistryId(skillDir, { source: "github_install" });
    const platform = buildAIIntegrationRegistries({
      config: {
        ai: {
          skills: {
            registries: [{
              rootPath: skillDir,
              source: "github_install"
            }]
          }
        }
      },
      paths: null
    });
    const statuses = await platform.skillRegistries.listStatus({});
    const skills = await platform.skillRegistries.listSkills({});

    assert.ok(statuses.some((entry) =>
      entry.id === registryId
      && entry.skillCount === 1
      && entry.localOnly === true
      && entry.thirdParty === true
    ));
    assert.ok(skills.some((skill) =>
      skill.registry === registryId
      && skill.id === "docx"
      && skill.displayName === "DOCX Skill"
      && skill.localOnly === true
      && skill.thirdParty === true
    ));
  } finally {
    await removeTempDirWithRetry(root);
  }
});

test("skill aggregation keeps only the first duplicate skill id", async () => {
  const registry = createSkillRegistry([
    {
      id: "builtin",
      async listSkills() {
        return [{
          id: "docx",
          displayName: "Built-in DOCX",
          description: "first workflow"
        }];
      }
    },
    {
      id: "external",
      async listSkills() {
        return [{
          id: "docx",
          displayName: "External DOCX",
          description: "second workflow"
        }];
      }
    }
  ]);

  const skills = await registry.listSkills({});
  assert.equal(skills.length, 1);
  assert.equal(skills[0].registry, "builtin");
  assert.equal(skills[0].displayName, "Built-in DOCX");

  const visible = await registry.listSkills({ includeInactive: true });
  assert.equal(visible.length, 2);
  assert.equal(visible[0].active, true);
  assert.equal(visible[1].active, false);
  assert.equal(visible[1].inactiveReason, "duplicate_skill_id");
});

test("skill aggregation can stop one duplicate and activate another by skill key", async () => {
  const registry = createSkillRegistry([
    {
      id: "builtin",
      async listSkills() {
        return [{ id: "docx", displayName: "Built-in DOCX" }];
      }
    },
    {
      id: "external",
      async listSkills() {
        return [{ id: "docx", displayName: "External DOCX" }];
      }
    }
  ]);

  const skills = await registry.listSkills({
    includeInactive: true,
    config: {
      ai: {
        skills: {
          disabledSkillKeys: [skillStateKey("builtin", "docx")]
        }
      }
    }
  });
  assert.equal(skills.length, 2);
  assert.equal(skills[0].registry, "builtin");
  assert.equal(skills[0].active, false);
  assert.equal(skills[0].inactiveReason, "disabled_by_user");
  assert.equal(skills[1].registry, "external");
  assert.equal(skills[1].active, true);
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
